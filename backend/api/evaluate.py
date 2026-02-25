from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends
from typing import List
import json
from sqlalchemy.orm import Session
from core.database import get_db
from models.db_models import SystemPrompt, EvaluationCriteria, StudentEvaluation, Lecturer, Criterion
from api.auth import get_current_lecturer

from services.doc_parser import extract_text
from services.llm_engine import evaluate_report
from models.evaluation import EvaluationResponse, CriterionResult, BatchEvaluationResponse

router = APIRouter(
    prefix="/evaluate",
    tags=["evaluation"]
)

@router.post("/batch", response_model=BatchEvaluationResponse)
async def evaluate_batch(
    files: List[UploadFile] = File(...), 
    scenario_id: str = Form(...),
    db: Session = Depends(get_db), 
    current_user: Lecturer = Depends(get_current_lecturer)
):
    """
    Endpoint to evaluate a batch of uploaded files.
    Extracts text and forwards it to the local vLLM server using DB configurations.
    Persists the final evaluation into the database.
    """
    results = []
    
    # 0. Fetch current Super-Prompt and Criteria from DB
    prompt_record = db.query(SystemPrompt).filter(SystemPrompt.phase_name == "prompt2").first()
    system_prompt_str = prompt_record.content if prompt_record else "Jsi evaluátor ÚZ."
    
    criteria_record = db.query(EvaluationCriteria).filter(
        EvaluationCriteria.scenario_name == scenario_id,
        EvaluationCriteria.lecturer_id == current_user.id
    ).first()
    
    if not criteria_record or not criteria_record.markdown_content.strip():
        raise HTTPException(
            status_code=404, 
            detail=f"Kritéria pro tuto situaci ({scenario_id}) nebyla nalezena."
        )
        
    # 2. VERIFIKACE NAČÍTÁNÍ: Sestavíme je do seznamu namísto jednoho stringu
    individual_criteria = db.query(Criterion).filter(
        Criterion.evaluation_criteria_id == criteria_record.id
    ).all()
    
    if not individual_criteria:
        raise HTTPException(
            status_code=404, 
            detail=f"Kritéria pro ({scenario_id}) nebyla správně rozparsována. Uložte je prosím znovu v Nastavení kritérií."
        )

    criteria_lines = []
    for i, crit in enumerate(individual_criteria, 1):
        crit_text = f"**{i}. Kritérium: {crit.nazev}**\n{crit.popis}\nBodů za splnění: {crit.body}"
        criteria_lines.append(crit_text)
        
    criteria_str = "\n\n".join(criteria_lines)
    
    # 3. LOGOVÁNÍ
    print(f">>> SUCCESS: Do promptu vloženo {len(individual_criteria)} samostatných kritérií pro scenario_id: {scenario_id}")
    
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
                lecturer_id=current_user.id,
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
