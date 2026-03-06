"""
MODUL API: VYHODNOCOVÁNÍ (EVALUATE)
Tento modul obsluhuje vše, co se týká nahrávání souborů a jejich analýzy.
Zajišťuje komunikaci přes WebSockety pro real-time stav a spravuje asynchronní frontu.
"""

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends, WebSocket, WebSocketDisconnect
from typing import List
import json
import asyncio
import unicodedata
from sqlalchemy.orm import Session
from core.database import get_db, SessionLocal
from models.db_models import SystemPrompt, EvaluationCriteria, StudentEvaluation, Lecturer, Criterion, AppSettings, GoldenExample, Class
from api.auth import get_current_lecturer
import datetime

from services.doc_parser import extract_text
from services.llm_engine import evaluate_report, extract_identity
from services.security_scanner import scanner, SecurityException
from models.evaluation import EvaluationResponse, CriterionResult, BatchEvaluationResponse
from pydantic import BaseModel
from services.evaluation_queue import eval_queue

router = APIRouter(
    prefix="/evaluate",
    tags=["evaluation"]
)

@router.websocket("/ws")
async def websocket_eval_status(websocket: WebSocket):
    """
    WEBSOCKET ENDPOINT:
    Umožňuje prohlížeči udržovat "živé spojení". Backend přes něj posílá zprávy
    o tom, který student se právě začal vyhodnocovat nebo kdo už je hotový.
    """
    await eval_queue.connect(websocket)
    try:
        while True:
            # Udržujeme spojení živé, čekáme na případné zprávy od klienta (které zatím nepotřebujeme).
            await websocket.receive_text() # Udržujeme spojení živé
    except WebSocketDisconnect:
        # Odpojení z registru, pokud lektor zavře okno.
        eval_queue.disconnect(websocket)

# Pomocná schémata pro validaci vstupních a výstupních dat.
class FastScanResponseItem(BaseModel):
    filename: str
    id: int
    cleaned_name: str
    identita: dict

class FastScanResponse(BaseModel):
    results: List[FastScanResponseItem]

class GoldenExampleRequest(BaseModel):
    scenario_id: str
    source_text: str
    perfect_json: str

@router.post("/golden-example")
def save_golden_example(request: GoldenExampleRequest, db: Session = Depends(get_db), current_user: Lecturer = Depends(get_current_lecturer)):
    setting = db.query(AppSettings).filter(AppSettings.key == "ENABLE_RAG_MODULE").first()
    if not setting or setting.value != "true":
        raise HTTPException(status_code=400, detail="RAG Modul není povolen administrátorem.")

    new_example = GoldenExample(
        scenario_id=request.scenario_id,
        source_text=request.source_text,
        perfect_json=request.perfect_json,
        created_at=datetime.datetime.now().isoformat()
    )
    db.add(new_example)
    db.commit()
    return {"status": "success", "message": "Zlatý příklad byl uložen do RAG paměti."}

@router.post("/fast-scan", response_model=FastScanResponse)
async def fast_scan_batch(
    files: List[UploadFile] = File(...), 
    scenario_id: str = Form(...),
    db: Session = Depends(get_db), 
    current_user: Lecturer = Depends(get_current_lecturer)
):
    """
    FAST-SCAN (RYCHLÝ NÁHLED):
    Tato funkce se spustí ihned po výběru souborů v PC.
    Cílem je rychle (během sekund) vyčíst jména studentů a založit je v databázi,
    aby lektor viděl seznam lidí dříve, než spustí plnou (pomalou) AI analýzu.
    """
    # Striktní omezení na 1 souběžný request k AI, abychom nepřetížili model (Rate Limit).
    semaphore = asyncio.Semaphore(1)
    results = []
    
    async def process_scan(file: UploadFile):
        """
        Pomocná funkce pro zpracování jednoho souboru v rámci Fast-Scanu.
        """
        student_name = unicodedata.normalize('NFC', file.filename)
        try:
            content_bytes = await file.read()
            # 1. Vytěžení textu
            extracted_text = await extract_text(content_bytes, file.filename)
            
            identita = {}
            if extracted_text.strip():
                try:
                    # 2. Bezpečnostní audit textu
                    scanner.scan_text(extracted_text)
                    async with semaphore:
                        # 3. AI analýza pouze začátku/konce dokumentu pro zjištění jména
                        identita = await extract_identity(
                            report_text=extracted_text,
                            db=db,
                            student_log_prefix=student_name
                        )
                        # Krátká pauza pro stabilitu LLM providera
                        await asyncio.sleep(0.5)
                except SecurityException as se:
                    print(f"[FAST-SCAN] Bezpečnostní varování: {se}")
            
            # 4. Formátování jména pro seznam (PŘÍJMENÍ Jméno)
            prijmeni = (identita.get('prijmeni') or "").strip().upper()
            jmeno = (identita.get('jmeno') or "").strip().capitalize()
            
            if prijmeni:
                cleaned_display_name = f"{prijmeni} {jmeno}".strip()
            else:
                # Pokud AI jméno nenašla, použijeme název souboru
                cleaned_display_name = file.filename.rsplit('.', 1)[0]
            
            # Ochrana proti selhání Foreign Key (class_id=1 nemusí být na prázdné nebo nové DB založena).
            default_class = db.query(Class).filter(Class.id == 1).first()
            if not default_class:
                db.add(Class(id=1, name="Základní kurz", created_by_id=current_user.id))
                try:
                    db.commit()
                except Exception:
                    db.rollback()

            # 5. Zápis do databáze (nebo aktualizace existujícího záznamu)
            new_eval = StudentEvaluation(
                student_name=student_name,
                cleaned_name=cleaned_display_name,
                class_id=1,
                scenario_name=scenario_id,
                source_text=extracted_text,
                source_filename=student_name,
                lecturer_id=current_user.id,
                student_identity=json.dumps(identita, ensure_ascii=False) if identita else "{}"
            )
            
            db.add(new_eval)
            db.commit()
            db.refresh(new_eval)
            
            return {
                "filename": file.filename,
                "id": new_eval.id,
                "cleaned_name": new_eval.cleaned_name,
                "identita": identita
            }
        except Exception as e:
            print(f"Chyba při zpracování souboru {student_name}: {e}")
            return None

    # Paralelní spuštění všech skenů
    tasks = [process_scan(f) for f in files]
    scan_results = await asyncio.gather(*tasks)
    
    # Odfiltrování případných neúspěšných pokusů a vrácení výsledku
    results = [r for r in scan_results if r]
    return FastScanResponse(results=results)

@router.post("/batch")
async def evaluate_batch(
    files: List[UploadFile] = File(None), 
    scenario_id: str = Form(...),
    student_ids: str = Form(None), # Comma separated IDs
    db: Session = Depends(get_db), 
    current_user: Lecturer = Depends(get_current_lecturer)
):
    """
    Endpoint na přijetí batchu souborů. Extrahuje obsahy do paměti a předá je do fronty na pozadí.
    Vrací 202 Accepted.
    """
    
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
    num_files = len(files) if files else 0
    print(f">>> [BATCH START] Zahajuji paralelní vyhodnocení pro {num_files} souborových studentů.")
    
    # 1. Načíst obsah nahraných souborů do paměti
    files_data = []
    if files:
        for file in files:
            content_bytes = await file.read()
            files_data.append({
                "filename": file.filename,
                "content": content_bytes,
                "record_id": None
            })

    # 2. Načíst obsah ze synchronizovaných záznamů (podle student_ids)
    if student_ids:
        try:
            id_list = [int(x.strip()) for x in student_ids.split(",") if x.strip()]
            records = db.query(StudentEvaluation).filter(
                StudentEvaluation.id.in_(id_list),
                StudentEvaluation.lecturer_id == current_user.id
            ).all()
            for rec in records:
                if rec.source_text:
                    files_data.append({
                        "filename": rec.student_name,
                        "content": None, # Signal to use source_text
                        "source_text": rec.source_text,
                        "record_id": rec.id
                    })
        except Exception as e:
            print(f">>> BATCH ERROR: Chyba při parsování student_ids: {e}")

    # Celkový počet studentů k vyhodnocení
    num_files = len(files) if files else 0
    num_db_records = len(id_list) if (student_ids and 'id_list' in locals()) else 0
    total_processing = num_files + num_db_records
    
    print(f">>> [BATCH START] Zahajuji paralelní vyhodnocení pro {total_processing} studentů.")

    # Zajištění rate limitingu a bezpečného zápisu pro dávkové zpracování na pozadí
    from asyncio import Semaphore, Lock
    evaluate_semaphore = Semaphore(1)
    evaluate_db_lock = Lock()

    # Asynchronní handler pro jeden soubor (bude spuštěn přes eval_queue.worker)
    async def process_single_file_bg(task_data: dict):
        file_data = task_data['file_data']
        system_prompt = task_data['system_prompt']
        criteria_markdown = task_data['criteria_markdown']
        current_user_id = task_data['lecturer_id']
        scen_id = task_data['scenario_id']
        
        student_name = unicodedata.normalize('NFC', file_data['filename'])
        
        # Otevření VLASTNÍ DB session, protože HTTP request už pravděpodobně skončil
        db_bg = SessionLocal()
        
        # Notifikace start
        await eval_queue.broadcast({
            "type": "EVAL_START",
            "student_name": student_name,
            "scenario_id": scen_id
        })
        
        try:
            if file_data.get('content'):
                extracted_text = await extract_text(file_data['content'], file_data['filename'])
            else:
                extracted_text = file_data.get('source_text', '')

            if not extracted_text.strip():
                raise ValueError("Dokument je prázdný nebo se nepodařilo přečíst text.")
                
            scanner.scan_text(extracted_text)
                
            async with evaluate_semaphore:
                # Upozornění frontendu na zahájení práce (z fronty -> do procesu)
                await eval_queue.broadcast({
                    "type": "EVAL_START",
                    "student_name": student_name,
                    "scenario_id": scen_id
                })
                
                llm_result_dict = await evaluate_report(
                    report_text=extracted_text,
                    criteria_markdown=criteria_markdown,
                    system_prompt=system_prompt,
                    db=db_bg,
                    scenario_id=scen_id,
                    student_log_prefix=student_name
                )
            
            async with evaluate_db_lock:
                identita = llm_result_dict.get('identita', {})
                
                existing_eval = db_bg.query(StudentEvaluation).filter(
                    StudentEvaluation.student_name == student_name,
                    StudentEvaluation.lecturer_id == current_user_id,
                    StudentEvaluation.scenario_name == scen_id
                ).order_by(StudentEvaluation.id.desc()).first()
                
                hodnost = identita.get('hodnost', '').strip()
                jmeno = identita.get('jmeno', '').strip()
                prijmeni = identita.get('prijmeni', '').strip()
                if prijmeni and jmeno:
                    cleaned_eval_name = f"{prijmeni.capitalize()} {jmeno.capitalize()}"
                elif prijmeni:
                    cleaned_eval_name = prijmeni.capitalize()
                else:
                    base_name = student_name.rsplit('.', 1)[0]
                    import re
                    clean_base = re.sub(r'(?i)\b(?:úz|uz|vtos|-)\b', '', base_name)
                    cleaned_eval_name = re.sub(r'\s+', ' ', clean_base).strip()
                
                if existing_eval:
                    existing_eval.json_result = json.dumps(llm_result_dict, ensure_ascii=False)
                    if existing_eval.student_identity and existing_eval.student_identity != "None" and identita and not "prijmeni" in json.loads(existing_eval.student_identity or "{}"):
                         existing_eval.student_identity = json.dumps(identita, ensure_ascii=False)
                         existing_eval.cleaned_name = cleaned_eval_name
                if not existing_eval:
                    # Pojistka pro asynchronní worker - třída ID 1 MUSÍ existovat.
                    if not db_bg.query(Class).filter(Class.id == 1).first():
                        db_bg.add(Class(id=1, name="Základní kurz", created_by_id=current_user_id))
                        try:
                            db_bg.commit()
                        except Exception:
                            db_bg.rollback()

                    eval_record = StudentEvaluation(
                        student_name=student_name,
                        class_id=1,
                        scenario_name=scen_id,
                        lecturer_id=current_user_id,
                        json_result=json.dumps(llm_result_dict, ensure_ascii=False),
                        cleaned_name=cleaned_eval_name,
                        student_identity=json.dumps(identita, ensure_ascii=False) if identita else "{}"
                    )
                    db_bg.add(eval_record)
                    
                db_bg.commit()
            
            await eval_queue.broadcast({
                "type": "EVAL_SUCCESS",
                "student_name": student_name,
                "scenario_id": scen_id
            })

        except SecurityException as se:
            await eval_queue.broadcast({
                "type": "EVAL_ERROR",
                "student_name": student_name,
                "error": str(se)
            })
        except Exception as e:
            await eval_queue.broadcast({
                "type": "EVAL_ERROR",
                "student_name": student_name,
                "error": str(e)
            })
        finally:
            db_bg.close()

    # Vytvoření úkolů do fronty
    for file_data in files_data:
        task = {
            "handler": process_single_file_bg,
            "file_data": file_data,
            "system_prompt": system_prompt_str,
            "criteria_markdown": criteria_str,
            "scenario_id": scenario_id,
            "lecturer_id": current_user.id
        }
        await eval_queue.add_task(task)

    # Vracíme pseudo-odpověď 202 - Accepted
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=202, content={"status": "accepted", "message": "Zpracování přidáno do fronty na pozadí."})

@router.delete("/batch")
async def cancel_batch_evaluation(current_user: Lecturer = Depends(get_current_lecturer)):
    """
    Vyčistí aktuální nevyřízenou frontu úloh v asynchronním workerovi.
    """
    await eval_queue.clear_queue()
    return {"status": "success", "message": "Zpracování zbývajících ÚZ bylo zastaveno."}
