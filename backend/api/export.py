from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response, PlainTextResponse
from sqlalchemy.orm import Session
import urllib.parse
import unicodedata
import traceback
import re
from core.database import get_db
from models.db_models import StudentEvaluation, Lecturer, ClassAnalysis, ExportHistory
from services.pdf_generator import generate_student_pdf, generate_class_excel, generate_class_report_pdf
from api.auth import get_current_lecturer, get_current_lecturer_export
from pydantic import BaseModel
from datetime import datetime
import pytz

router = APIRouter(
    prefix="/export",
    tags=["export"]
)

@router.get("/student/by-name/{student_name}/pdf", response_class=Response)
def export_student_pdf(
    student_name: str, 
    scenario_id: str = "Nespecifikováno",
    db: Session = Depends(get_db), 
    current_user: Lecturer = Depends(get_current_lecturer)
):
    """
    Vygeneruje a vrátí PDF hodnocení pro nejnovější záznam daného studenta.
    Očekává přesnou shodu jména.
    """
    try:
        # 1. Dekódování URL a normalizace (NFC pro čisté kódování české diakritiky)
        decoded_name = urllib.parse.unquote(student_name)
        normalized_name = unicodedata.normalize('NFC', decoded_name)
        
        print(f">>> EXPORT: Hledám vyhodnocení pro: '{normalized_name}'")
        # Výpis hex pro přesné určení Unicode neshod v logu
        # print(f">>> DEBUG HEX: {normalized_name.encode('utf-8').hex()}")
        
        # Bereme nejnovější evaluaci pro daného studenta
        evaluation = db.query(StudentEvaluation).filter(
            StudentEvaluation.student_name == normalized_name,
            StudentEvaluation.lecturer_id == current_user.id
        ).order_by(StudentEvaluation.id.desc()).first()
        
        if not evaluation:
            # Zkusíme ještě jednu šanci: vyhledat všechny a normalizovat v Pythonu (pomalejší, ale jistota)
            print(">>> EXPORT: Přímá shoda selhala, zkouším prohledat všechny záznamy s NFC normalizací...")
            all_evals = db.query(StudentEvaluation).filter(StudentEvaluation.lecturer_id == current_user.id).all()
            for ev in all_evals:
                if unicodedata.normalize('NFC', ev.student_name) == normalized_name:
                    evaluation = ev
                    break
            
            if not evaluation:
                raise HTTPException(status_code=404, detail=f"Hodnocení pro studenta '{normalized_name}' nebylo nalezeno.")
            
        pdf_bytes = generate_student_pdf(evaluation, current_user, db, scenario_id=scenario_id)
        
        # 2. Vytvoření bezpečného "slugu" pro název souboru
        slug = unicodedata.normalize('NFKD', normalized_name).encode('ascii', 'ignore').decode('ascii')
        slug = re.sub(r'[^a-zA-Z0-9_\-]', '_', slug).strip('_')
        # Snížení počtu po sobě jdoucích podtržítek
        slug = re.sub(r'_+', '_', slug)
        
        file_name = f'hodnoceni_{slug}.pdf'
        
        headers = {
            'Content-Disposition': f'attachment; filename="{file_name}"'
        }
        
        return Response(content=bytes(pdf_bytes), media_type="application/pdf", headers=headers)
        
    except HTTPException:
        raise
    except Exception as e:
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail="Chyba při generování PDF.")

@router.get("/class-report/{scenario_id}", response_class=Response)
def export_class_report_pdf(scenario_id: str, db: Session = Depends(get_db), current_user: Lecturer = Depends(get_current_lecturer_export)):
    """
    Vygeneruje a vrátí PDF globální analýzy třídy pro danou modelovou situaci.
    """
    import json
    try:
        # Dekódování URL
        decoded_id = urllib.parse.unquote(scenario_id)
        
        if not decoded_id or decoded_id == "null":
            raise HTTPException(status_code=400, detail="Neplatné ID scénáře.")
        
        # Extract from database cache
        cached_analysis = db.query(ClassAnalysis).filter(ClassAnalysis.scenario_id == decoded_id).first()
        if not cached_analysis:
            raise HTTPException(status_code=404, detail="Analýza pro toto téma zatím neexistuje. Obnovte a vygenerujte analýzu ve frontend aplikaci.")
            
        data = json.loads(cached_analysis.content_json)
        
        pdf_bytes = generate_class_report_pdf(data, decoded_id, current_user)
        
        # Slugify
        slug = unicodedata.normalize('NFKD', decoded_id).encode('ascii', 'ignore').decode('ascii')
        slug = re.sub(r'[^a-zA-Z0-9_\-]', '_', slug).strip('_')
        slug = re.sub(r'_+', '_', slug)
        
        file_name = f'analyza_tridy_{slug}.pdf'
        
        headers = {
            'Content-Disposition': f'attachment; filename="{file_name}"'
        }
        
        return Response(content=pdf_bytes, media_type="application/pdf", headers=headers)
        
    except HTTPException:
        raise
    except Exception as e:
        print("=== CHYBA PŘI EXPORTU ANALÝZY PDF ===")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail="Chyba při generování reportu PDF.")

@router.get("/evaluation/{evaluation_id}/pdf", response_class=Response)
def export_evaluation_pdf(
    evaluation_id: int, 
    scenario_id: str = "Nespecifikováno",
    db: Session = Depends(get_db), 
    current_user: Lecturer = Depends(get_current_lecturer)
):
    """
    Vygeneruje a vrátí PDF hodnocení pro konkrétní záznam podle ID.
    Nejspolehlivější metoda exportu.
    """
    try:
        print(f">>> EXPORT: Hledám vyhodnocení pro: {evaluation_id}")
        
        evaluation = db.query(StudentEvaluation).filter(
            StudentEvaluation.id == evaluation_id,
            StudentEvaluation.lecturer_id == current_user.id
        ).first()
        
        if not evaluation:
            raise HTTPException(status_code=404, detail=f"Hodnocení s ID {evaluation_id} nebylo nalezeno.")
            
        pdf_bytes = generate_student_pdf(evaluation, current_user, db, scenario_id=scenario_id)
        
        slug = unicodedata.normalize('NFKD', evaluation.student_name).encode('ascii', 'ignore').decode('ascii')
        slug = re.sub(r'[^a-zA-Z0-9_\-]', '_', slug).strip('_')
        slug = re.sub(r'_+', '_', slug)
        
        file_name = f'hodnoceni_{slug}.pdf'
        
        headers = {
            'Content-Disposition': f'attachment; filename="{file_name}"'
        }
        
        return Response(content=bytes(pdf_bytes), media_type="application/pdf", headers=headers)
        
    except HTTPException:
        raise
    except Exception as e:
        print("=== CHYBA PŘI EXPORTU PDF ===")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail="Chyba při generování PDF.")

@router.get("/class/{class_id}/excel", response_class=Response)
def export_class_excel(class_id: int, db: Session = Depends(get_db), current_user: Lecturer = Depends(get_current_lecturer)):
    """
    Vygeneruje a vrátí XLSX sešit výsledků celé třídy.
    """
    try:
        excel_bytes = generate_class_excel(class_id, db, current_user.id)
        
        headers = {
            'Content-Disposition': f'attachment; filename="vysledky_trida_{class_id}.xlsx"'
        }
        
        return Response(content=excel_bytes, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers=headers)
        
    except Exception as e:
        print(f"Error generating Excel: {e}")
        raise HTTPException(status_code=500, detail="Chyba při generování Excel souboru.")


# --- Export History Endpoints ---

class ExportHistoryCreate(BaseModel):
    scenario_name: str
    type: str # 'PDF Report Třídy', 'Excel', 'PDF Hodnocení'...
    download_url: str

@router.post("/history")
def save_export_history(history_entry: ExportHistoryCreate, db: Session = Depends(get_db), current_user: Lecturer = Depends(get_current_lecturer)):
    """
    Uloží nově proběhlý export do databáze (zavoláno z frontendu po úspěšném stažení nebo před otevřením).
    """
    prague_tz = pytz.timezone('Europe/Prague')
    current_time = datetime.now(prague_tz).strftime('%Y-%m-%d %H:%M:%S')

    new_history = ExportHistory(
        user_id=current_user.id,
        scenario_name=history_entry.scenario_name,
        type=history_entry.type,
        download_url=history_entry.download_url,
        created_at=current_time
    )

    db.add(new_history)
    db.commit()
    db.refresh(new_history)

    return {"status": "success", "id": new_history.id}

@router.get("/history")
def get_export_history(db: Session = Depends(get_db), current_user: Lecturer = Depends(get_current_lecturer)):
    """
    Vrátí 5 posledních exportů aktuálního uživatele.
    """
    history = db.query(ExportHistory).filter(
        ExportHistory.user_id == current_user.id
    ).order_by(ExportHistory.id.desc()).limit(5).all()

    return history
