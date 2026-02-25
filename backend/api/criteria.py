from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Dict

from core.database import get_db
from models.db_models import SystemPrompt, EvaluationCriteria, Lecturer, Criterion
from services.llm_engine import chat_completion
from services.doc_parser import extract_text
from services.criteria_service import parse_criteria_markdown
from api.auth import get_current_lecturer

router = APIRouter(
    prefix="/criteria",
    tags=["criteria"]
)

# --- Pydantic Schemas ---

class Message(BaseModel):
    role: str # 'user' | 'assistant'
    content: str

class ChatRequest(BaseModel):
    messages: List[Message]
    scenario: str = "MS2" # Future-proofing

class ChatResponse(BaseModel):
    response: str
    
class SaveCriteriaRequest(BaseModel):
    scenario: str
    markdown_content: str

# --- Endpoints ---

@router.post("/chat", response_model=ChatResponse)
def handle_chat(request: ChatRequest, db: Session = Depends(get_db), current_user: Lecturer = Depends(get_current_lecturer)):
    """
    Handles a chat turn for Phase 1 Criteria generation.
    Retrieves the Phase 1 Super Prompt from DB and forwards the conversation to vLLM.
    """
    try:
        # Fetch Phase 1 Prompt
        prompt_record = db.query(SystemPrompt).filter(SystemPrompt.phase_name == "prompt1").first()
        if not prompt_record:
            raise HTTPException(status_code=500, detail="System default prompt for Phase 1 not found in database.")
            
        system_prompt = prompt_record.content
        temperature = prompt_record.temperature
        
        # Convert Pydantic messages to dict list
        messages_dict_list = [{"role": msg.role, "content": msg.content} for msg in request.messages]
        
        # Get Completion from LLM Engine
        response_text = chat_completion(
            messages=messages_dict_list,
            system_prompt=system_prompt,
            temperature=temperature,
            db=db
        )
        
        return {"response": response_text}
        
    except ValueError as ve:
        raise HTTPException(status_code=503, detail=str(ve))
    except Exception as e:
        print(f"Chat Endpoint Error: {e}")
        raise HTTPException(status_code=500, detail="Chyba serveru při zpracování chatu.")


@router.post("/extract-context")
async def extract_context(file: UploadFile = File(...), current_user: Lecturer = Depends(get_current_lecturer)):
    """
    Extracts text from an uploaded document (.docx, .rtf, .pdf) to be used as context in the criteria chat.
    """
    try:
        content_bytes = await file.read()
        extracted_text = extract_text(content_bytes, file.filename)
        return {"filename": file.filename, "text": extracted_text}
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        print(f"Extraction Error: {e}")
        raise HTTPException(status_code=500, detail="Nepodařilo se extrahovat text ze souboru.")


@router.get("/{scenario}")
def get_criteria(scenario: str, db: Session = Depends(get_db), current_user: Lecturer = Depends(get_current_lecturer)):
    """
    Retrieves the currently saved criteria for a specific scenario (e.g., 'MS2').
    """
    criteria_record = db.query(EvaluationCriteria).filter(
        EvaluationCriteria.scenario_name == scenario,
        EvaluationCriteria.lecturer_id == current_user.id
    ).first()
    if not criteria_record:
           return {"scenario": scenario, "markdown_content": "Kritéria zatím nebyla definována."}
    
    return {"scenario": scenario, "markdown_content": criteria_record.markdown_content}


@router.put("/save")
def save_criteria(request: SaveCriteriaRequest, db: Session = Depends(get_db), current_user: Lecturer = Depends(get_current_lecturer)):
    """
    Saves the final generated Markdown criteria to the database for future evaluation use.
    """
    criteria_record = db.query(EvaluationCriteria).filter(
        EvaluationCriteria.scenario_name == request.scenario,
        EvaluationCriteria.lecturer_id == current_user.id
    ).first()
    
    # 1. MARKDOWN SPLITTER: Rozsekáme a vyčistíme text od balastu
    parsed_items = parse_criteria_markdown(request.markdown_content)
    print(f">>> PARSER: Identifikováno {len(parsed_items)} samostatných kritérií z textu.")
    

    
    if criteria_record:
        criteria_record.markdown_content = request.markdown_content
        # Clear out old criteria for this scenario and lecturer before inserting new ones
        db.query(Criterion).filter(Criterion.evaluation_criteria_id == criteria_record.id).delete()
    else:
        criteria_record = EvaluationCriteria(
            scenario_name=request.scenario,
            markdown_content=request.markdown_content,
            lecturer_id=current_user.id
        )
        db.add(criteria_record)
        db.flush() # Flush to assign an ID to the new criteria_record
        
    for item in parsed_items:
        new_crit = Criterion(
            evaluation_criteria_id=criteria_record.id,
            nazev=item["nazev"],
            popis=item["popis"],
            body=item["body"]
        )
        db.add(new_crit)
        
    db.commit()
    return {"message": f"Kritéria pro {request.scenario} úspěšně uložena a rozparsována na {len(parsed_items)} částí.", "content": request.markdown_content}
