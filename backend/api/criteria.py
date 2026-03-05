"""
MODUL API: SPRÁVA KRITÉRIÍ (CRITERIA)
Tento modul umožňuje lektorům vytvářet a ladit hodnotící kritéria.
Obsahuje integraci s AI asistentem pro Sokratovské dotazování (Phase 1).
"""

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

# --- Pydantic Schemas (Struktury pro validaci dat) ---

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

# --- Endpoints (Vstupní body API) ---

@router.post("/chat", response_model=ChatResponse)
async def handle_chat(request: ChatRequest, db: Session = Depends(get_db), current_user: Lecturer = Depends(get_current_lecturer)):
    """
    AI ASISTENT PRO KRITÉRIA (Phase 1):
    Bere historii konverzace, přidá k ní System Prompt (Sokratovské dotazování)
    a odešle ji do modelu. Vrací odpověď asistenta včetně případného návrhu kritérií.
    """
    try:
        # Načtení systémového nastavení pro Fázi 1.
        prompt_record = db.query(SystemPrompt).filter(SystemPrompt.phase_name == "prompt1").first()
        if not prompt_record:
            raise HTTPException(status_code=500, detail="Systémový prompt pro Fázi 1 nebyl v DB nalezen.")
            
        system_prompt = prompt_record.content
        temperature = prompt_record.temperature
        
        # Převod zpráv z Pydantic modelů na obyčejný seznam slovníků pro LLM engine.
        messages_dict_list = [{"role": msg.role, "content": msg.content} for msg in request.messages]
        
        # Volání LLM Enginu
        response_text = await chat_completion(
            messages=messages_dict_list,
            system_prompt=system_prompt,
            temperature=temperature,
            db=db,
            phase="phase1"
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
    VYTĚŽENÍ KONTEXTU ZE ZADÁNÍ:
    Lektor může nahrát existující metodiku (PDF/DOCX) a asistent si ji "přečte",
    aby měl kontext pro následné ladění kritérií v chatu.
    """
    try:
        content_bytes = await file.read()
        extracted_text = await extract_text(content_bytes, file.filename)
        return {"filename": file.filename, "text": extracted_text}
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        print(f"Extraction Error: {e}")
        raise HTTPException(status_code=500, detail="Nepodařilo se extrahovat text ze souboru.")


@router.get("/{scenario}")
def get_criteria(scenario: str, db: Session = Depends(get_db), current_user: Lecturer = Depends(get_current_lecturer)):
    """
    NAČTENÍ KRITÉRIÍ:
    Vrátí aktuálně uložený Markdown text kritérií pro daný scénář a lektora.
    """
    criteria_record = db.query(EvaluationCriteria).filter(
        EvaluationCriteria.scenario_name == scenario,
        EvaluationCriteria.lecturer_id == current_user.id
    ).first()
    if not criteria_record:
           return {"scenario": scenario, "markdown_content": "Kritéria zatím nebyla definována."}
    
    return {"scenario": scenario, "markdown_content": criteria_record.markdown_content}


@router.post("/save")
def save_criteria(request: SaveCriteriaRequest, db: Session = Depends(get_db), current_user: Lecturer = Depends(get_current_lecturer)):
    """
    ULOŽENÍ KRITÉRIÍ:
    Uloží surový Markdown a zároveň ho ROZPARSUJE na jednotlivé body (Criterion),
    aby s nimi mohl systém matematicky pracovat v analytice.
    """
    # 1. Uložit/Aktualizovat hlavní záznam (text pro editor)
    criteria_record = db.query(EvaluationCriteria).filter(
        EvaluationCriteria.scenario_name == request.scenario,
        EvaluationCriteria.lecturer_id == current_user.id
    ).first()
    
    if not criteria_record:
        criteria_record = EvaluationCriteria(
            scenario_name=request.scenario,
            lecturer_id=current_user.id
        )
        db.add(criteria_record)
    
    criteria_record.markdown_content = request.markdown_content
    db.commit()
    db.refresh(criteria_record)

    # 2. Rozparsovat na jednotlivá kritéria pro potřeby DB
    # Smažeme staré definice a nahradíme je novými podle aktuálního Markdownu.
    db.query(Criterion).filter(Criterion.evaluation_criteria_id == criteria_record.id).delete()
    
    parsed_items = parse_criteria_markdown(request.markdown_content)
    for item in parsed_items:
        new_crit = Criterion(
            evaluation_criteria_id=criteria_record.id,
            nazev=item["nazev"],
            popis=item["popis"],
            body=item["body"]
        )
        db.add(new_crit)
    
    db.commit()
    return {"status": "success", "message": f"Kritéria uložena a rozparsována na {len(parsed_items)} položek."}
