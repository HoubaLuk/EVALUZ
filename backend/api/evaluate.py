from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from typing import List
import json
from sqlalchemy.orm import Session
from core.database import get_db
from models.db_models import SystemPrompt, EvaluationCriteria, StudentEvaluation

from services.doc_parser import extract_text
from services.llm_engine import evaluate_report
from models.evaluation import EvaluationResponse, CriterionResult, BatchEvaluationResponse

router = APIRouter(
    prefix="/evaluate",
    tags=["evaluation"]
)

@router.post("/batch", response_model=BatchEvaluationResponse)
async def evaluate_batch(files: List[UploadFile] = File(...), db: Session = Depends(get_db)):
    """
    Endpoint to evaluate a batch of uploaded files.
    Extracts text and forwards it to the local vLLM server using DB configurations.
    Persists the final evaluation into the database.
    """
    results = []
    
    # 0. Fetch current Super-Prompt and Criteria from DB
    prompt_record = db.query(SystemPrompt).filter(SystemPrompt.phase_name == "prompt2").first()
    system_prompt_str = prompt_record.content if prompt_record else "Jsi evaluátor ÚZ."
    
    criteria_record = db.query(EvaluationCriteria).filter(EvaluationCriteria.scenario_name == "MS2").first()
    criteria_str = criteria_record.markdown_content if criteria_record else "Neznámá kritéria."
    
    for file in files:
        # Determine student name from filename (e.g. "Adámek.pdf" -> "stržm. Adámek")
        import os
        base_name = os.path.splitext(file.filename)[0]
        student_name = f"stržm. {base_name}" if '.' in file.filename else file.filename
        
        try:
            # 1. Extract text
            content_bytes = await file.read()
            extracted_text = extract_text(content_bytes, file.filename)
            
            # Simple check for empty documents
            if not extracted_text.strip():
                raise ValueError("Dokument je prázdný nebo se z něj nepodařilo přečíst text.")
                
            # 2. Call LLM Service passing the db session
            llm_result_dict = evaluate_report(
                report_text=extracted_text,
                criteria_markdown=criteria_str,
                system_prompt=system_prompt_str,
                db=db
            )
            
            # 3. Save to DB
            eval_record = StudentEvaluation(
                student_name=student_name,
                class_id=1, # Default class for now
                json_result=json.dumps(llm_result_dict, ensure_ascii=False)
            )
            db.add(eval_record)
            db.commit()
            
            # 4. Construct the EvaluationResponse
            criterion_results = []
            for item in llm_result_dict.get('vysledky', []):
                criterion_results.append(CriterionResult(
                    nazev=item.get('nazev', 'Neznámé kritérium'),
                    splneno=item.get('splneno', False),
                    body=item.get('body', 0),
                    oduvodneni=item.get('oduvodneni', 'Bez odůvodnění.'),
                    citace=item.get('citace', 'Chybí.')
                ))
            
            mock_result = EvaluationResponse(
                jmeno_studenta=student_name,
                vysledky=criterion_results,
                celkove_skore=llm_result_dict.get('celkove_skore', 0),
                zpetna_vazba=llm_result_dict.get('zpetna_vazba', 'Bez zpětné vazby.')
            )
            
            results.append(mock_result)
            
        except ValueError as ve:
            # Gracefully handle parser or JSON parse errors per student
            print(f"[{file.filename}] Validation Error: {ve}")
            results.append(EvaluationResponse(
                jmeno_studenta=student_name,
                vysledky=[],
                celkove_skore=0,
                zpetna_vazba=f"Chyba při zpracování: {ve}"
            ))
        except Exception as e:
            # Gracefully handle connection errors or vLLM crashes (e.g., ConnectionRefusedError)
            print(f"[{file.filename}] LLM Server Error: {e}")
             # We throw an HTTPException so the Frontend can catch the 503 and show a clear error
            raise HTTPException(
                status_code=503, 
                detail="VLLM server je nedostupný nebo neodpovídá správně (LLM backend error). Zkontrolujte URL a zda engine běží."
            )

    return BatchEvaluationResponse(results=results)
