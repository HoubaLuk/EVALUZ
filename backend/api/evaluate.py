from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends
from typing import List
import json
import asyncio
import unicodedata
from sqlalchemy.orm import Session
from core.database import get_db
from models.db_models import SystemPrompt, EvaluationCriteria, StudentEvaluation, Lecturer, Criterion
from api.auth import get_current_lecturer

from services.doc_parser import extract_text
from services.llm_engine import evaluate_report, extract_identity
from models.evaluation import EvaluationResponse, CriterionResult, BatchEvaluationResponse
from pydantic import BaseModel

router = APIRouter(
    prefix="/evaluate",
    tags=["evaluation"]
)

class FastScanResponseItem(BaseModel):
    filename: str
    id: int
    cleaned_name: str
    identita: dict

class FastScanResponse(BaseModel):
    results: List[FastScanResponseItem]

@router.post("/fast-scan", response_model=FastScanResponse)
async def fast_scan_batch(
    files: List[UploadFile] = File(...), 
    scenario_id: str = Form(...),
    db: Session = Depends(get_db), 
    current_user: Lecturer = Depends(get_current_lecturer)
):
    """
    Rychle vytěží z dokumentů pouze identitu a založí záznam 'pending' v databázi.
    """
    semaphore = asyncio.Semaphore(10)
    db_lock = asyncio.Lock()
    results = []
    
    async def process_scan(file: UploadFile):
        student_name = unicodedata.normalize('NFC', file.filename)
        try:
            content_bytes = await file.read()
            extracted_text = extract_text(content_bytes, file.filename)
            
            identita = {}
            if extracted_text.strip():
                async with semaphore:
                    identita = await extract_identity(
                        report_text=extracted_text,
                        db=db,
                        student_log_prefix=student_name
                    )
                    
            hodnost = identita.get('hodnost', '').strip()
            jmeno = identita.get('jmeno', '').strip()
            prijmeni = identita.get('prijmeni', '').strip()
            
            if not prijmeni or not jmeno:
                base_name = file.filename.rsplit('.', 1)[0]
                import re
                clean_base = re.sub(r'(?i)\b(úz|uz|vtos)\b', '', base_name)
                clean_base = re.sub(r'\s+', ' ', clean_base).strip()
                cleaned_display_name = clean_base
            else:
                prijmeni_upper = prijmeni.upper()
                cleaned_display_name = f"{prijmeni_upper} {jmeno}, {hodnost}".strip(", ")
                
            async with db_lock:
                # Check if it already exists to avoid duplicated files on re-upload
                existing_record = db.query(StudentEvaluation).filter(
                    StudentEvaluation.student_name == student_name,
                    StudentEvaluation.scenario_name == scenario_id,
                    StudentEvaluation.lecturer_id == current_user.id
                ).order_by(StudentEvaluation.id.desc()).first()
                
                if existing_record:
                    existing_record.cleaned_name = cleaned_display_name
                    existing_record.student_identity = json.dumps(identita, ensure_ascii=False) if identita else "{}"
                    db.commit()
                    db.refresh(existing_record)
                    record_id = existing_record.id
                else:
                    eval_record = StudentEvaluation(
                        student_name=student_name,
                        class_id=1,
                        scenario_name=scenario_id,
                        lecturer_id=current_user.id,
                        json_result="{}", # Prázdný výsledek = pending
                        cleaned_name=cleaned_display_name,
                        student_identity=json.dumps(identita, ensure_ascii=False) if identita else "{}"
                    )
                    db.add(eval_record)
                    db.commit()
                    db.refresh(eval_record)
                    record_id = eval_record.id
            
            return FastScanResponseItem(
                filename=file.filename,
                id=record_id,
                cleaned_name=cleaned_display_name,
                identita=identita
            )
        except Exception as e:
            print(f"Chyba ve fast-scan pro {student_name}: {e}")
            return None
            
    tasks = [process_scan(f) for f in files]
    completed = await asyncio.gather(*tasks)
    
    for c in completed:
        if c:
            results.append(c)
            
    return FastScanResponse(results=results)

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
    
    # 0. Fetch current Super-Prompt and    # Fetch phase 2 prompt
    prompt_record = db.query(SystemPrompt).filter(SystemPrompt.phase_name == "prompt2").first()
    db_system_prompt_str = prompt_record.content if prompt_record else "Vyhodnoť záznam podle zadaných kritérií. Vrať striktní JSON."
    
    # Přidání formátovacích pravidel pro textové výstupy (zpetna_vazba a oduvodneni) kvůli PDF kompatibilitě
    system_prompt_str = f"{db_system_prompt_str}\n\nDŮLEŽITÉ POKYNY K FORMÁTOVÁNÍ TEXTOVÝCH POLÍ:\n1. NIKDY nepoužívej Markdown tabulky (v PDF se rozpadají a přetékají okraje).\n2. Strukturu tvoř výhradně pomocí nadpisů třetí úrovně (### Nadpis), tučného písma (**text**) a standardních odrážek (- text)."
    
    criteria_record = db.query(EvaluationCriteria).filter(
        EvaluationCriteria.scenario_name == scenario_id,
        EvaluationCriteria.lecturer_id == current_user.id
    ).first()
    
    if not criteria_record or not criteria_record.markdown_content.strip():
        print(f">>> BATCH ERROR: Nebyla nalezena kritéria v tabulce 'EvaluationCriteria' pro scenario: '{scenario_id}', lecturer_id: {current_user.id}")
        raise HTTPException(
            status_code=404, 
            detail=f"Kritéria pro tuto situaci ({scenario_id}) nebyla nalezena."
        )
        
    # 2. VERIFIKACE NAČÍTÁNÍ: Sestavíme je do seznamu namísto jednoho stringu
    individual_criteria = db.query(Criterion).filter(
        Criterion.evaluation_criteria_id == criteria_record.id
    ).all()
    
    if not individual_criteria:
        print(f">>> BATCH ERROR: Nebyla nalezena jednotlivá rozparsovaná kritéria v tabulce 'Criterion' pro evaluation_criteria_id: {criteria_record.id}")
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
    print(f">>> [BATCH START] Zahajuji paralelní vyhodnocení pro {len(files)} studentů.")
    
    semaphore = asyncio.Semaphore(5)
    db_lock = asyncio.Lock()

    async def process_single_file(file: UploadFile, system_prompt: str, criteria_markdown: str, db_session: Session, current_user_obj: Lecturer, scenario_id: str) -> EvaluationResponse:
        import os
        student_name = unicodedata.normalize('NFC', file.filename)
        
        try:
            # 1. Extract text
            content_bytes = await file.read()
            extracted_text = extract_text(content_bytes, file.filename)
            
            if not extracted_text.strip():
                raise ValueError("Dokument je prázdný nebo se z něj nepodařilo přečíst text.")
                
            # 2. Call LLM Service under semaphore to limit concurrent openrouter load
            async with semaphore:
                print(f"[LOG - {student_name}] Zahajuji asynchronní inference LLM modelu...")
                llm_result_dict = await evaluate_report(
                    report_text=extracted_text,
                    criteria_markdown=criteria_markdown,
                    system_prompt=system_prompt,
                    db=db_session,
                    student_log_prefix=student_name
                )
                print(f"[LOG - {student_name}] Asynchronní vyhodnocení LLM dokončeno.")
            
            # 3. Process Identity and Save to DB under global lock
            async with db_lock:
                print(f"[LOG - {student_name}] Ukládám transakci do databáze...")
                
                identita = llm_result_dict.get('identita', {})
                # Nepřepisujeme identitu, pokud už byla manuálně upravená a JSON je None (vlastně JSON result se uloží a hotovo)
                
                existing_eval = db_session.query(StudentEvaluation).filter(
                    StudentEvaluation.student_name == student_name,
                    StudentEvaluation.lecturer_id == current_user_obj.id,
                    StudentEvaluation.scenario_name == scenario_id
                ).order_by(StudentEvaluation.id.desc()).first()
                
                # Získáme z LLM aktuální jméno (kdyby fast scan selhal ale heavy scan to našel)
                hodnost = identita.get('hodnost', '').strip()
                jmeno = identita.get('jmeno', '').strip()
                prijmeni = identita.get('prijmeni', '').strip()
                prijmeni_upper = prijmeni.upper() if prijmeni else ""
                cleaned_eval_name = f"{prijmeni_upper} {jmeno}, {hodnost}".strip(", ") if prijmeni else student_name
                
                if existing_eval:
                    existing_eval.json_result = json.dumps(llm_result_dict, ensure_ascii=False)
                    # Jestliže heavy engine vytěžil kvalitnější data (nebo fast-scan neměl nic) a nebylo manuálně potvrzeno (identita neni text None)
                    if existing_eval.student_identity and existing_eval.student_identity != "None" and identita and not "prijmeni" in json.loads(existing_eval.student_identity or "{}"):
                         existing_eval.student_identity = json.dumps(identita, ensure_ascii=False)
                         existing_eval.cleaned_name = cleaned_eval_name
                    cleaned_display_name = existing_eval.cleaned_name
                else:
                    eval_record = StudentEvaluation(
                        student_name=student_name,
                        class_id=1,
                        scenario_name=scenario_id,
                        lecturer_id=current_user_obj.id,
                        json_result=json.dumps(llm_result_dict, ensure_ascii=False),
                        cleaned_name=cleaned_eval_name,
                        student_identity=json.dumps(identita, ensure_ascii=False) if identita else "{}"
                    )
                    db_session.add(eval_record)
                    cleaned_display_name = cleaned_eval_name
                    
                db_session.commit()

            
            # 4. Construct response
            criterion_results = []
            for item in llm_result_dict.get('vysledky', []):
                criterion_results.append(CriterionResult(
                    nazev=item.get('nazev', 'Neznámé kritérium'),
                    splneno=item.get('splneno', False),
                    body=item.get('body', 0),
                    oduvodneni=item.get('oduvodneni', 'Bez odůvodnění.'),
                    citace=item.get('citace', 'Chybí.')
                ))
            
            return EvaluationResponse(
                jmeno_studenta=student_name,
                cleaned_name=cleaned_display_name,
                vysledky=criterion_results,
                celkove_skore=llm_result_dict.get('celkove_skore', 0),
                zpetna_vazba=llm_result_dict.get('zpetna_vazba', 'Bez zpětné vazby.'),
                identita=identita
            )

            
        except ValueError as ve:
            print(f"[LOG - {student_name}] Validation Error: {ve}")
            return EvaluationResponse(
                jmeno_studenta=student_name,
                vysledky=[],
                celkove_skore=0,
                zpetna_vazba=f"Chyba při zpracování: {ve}"
            )
        except Exception as e:
            print(f"[LOG - {student_name}] KRITICKÁ CHYBA: {e}")
            # Nikdy neraisujeme výjimku přímo v gather smyčce, jinak padne celý batch
            return EvaluationResponse(
                jmeno_studenta=student_name,
                vysledky=[],
                celkove_skore=0,
                zpetna_vazba=f"LLM Server chyba: {str(e)} - Zkuste vyhodnocení znovu."
            )

    # Vytvoření seznamu korutin pro asynchronní vyhodnocení všech dokumentů paralelně
    tasks = [process_single_file(file, system_prompt_str, criteria_str, db, current_user, scenario_id) for file in files]
    
    # Vyčkání na dokončení všech tasků (exceptions bubbling up directly to fastapi exception handlers)
    results = await asyncio.gather(*tasks)

    return BatchEvaluationResponse(results=list(results))
