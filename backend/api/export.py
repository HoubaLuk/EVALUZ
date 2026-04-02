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
from api.auth import get_current_lecturer, get_current_lecturer_export, apply_data_isolation
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
        
        
        # Bereme nejnovější evaluaci pro daného studenta
        query = db.query(StudentEvaluation).filter(StudentEvaluation.student_name == normalized_name)
        evaluation = apply_data_isolation(query, StudentEvaluation, current_user, db).order_by(StudentEvaluation.id.desc()).first()
        
        if not evaluation:
            # Zkusíme ještě jednu šanci: vyhledat všechny a normalizovat v Pythonu (pomalejší, ale jistota)
            
            query = db.query(StudentEvaluation)
            all_evals = apply_data_isolation(query, StudentEvaluation, current_user, db).all()
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
def export_class_report_pdf(
    scenario_id: str,
    class_name: str = "",
    scenario_display_name: str = "",
    db: Session = Depends(get_db),
    current_user: Lecturer = Depends(get_current_lecturer_export)
):
    """
    Vygeneruje a vrátí PDF globální analýzy třídy pro danou modelovou situaci.
    """
    import json
    try:
        # Dekódování URL
        decoded_id = urllib.parse.unquote(scenario_id)
        
        if not decoded_id or decoded_id == "null":
            raise HTTPException(status_code=400, detail="Neplatné ID scénáře.")
        
        # Extract from database cache (filtered by role)
        query = db.query(ClassAnalysis).filter(ClassAnalysis.scenario_id == decoded_id)
        cached_analysis = apply_data_isolation(query, ClassAnalysis, current_user, db).first()
        if not cached_analysis:
            raise HTTPException(status_code=404, detail="Analýza pro toto téma zatím neexistuje. Obnovte a vygenerujte analýzu ve frontend aplikaci.")
            
        data = json.loads(cached_analysis.content_json)
        # Oprava double-encoded JSON (content_json může být string místo dict)
        if isinstance(data, str):
            data = json.loads(data)

        from models.db_models import ClassRoom, EvaluationCriteria, Criterion
        import re as _re_strip

        def _strip_markdown(text: str) -> str:
            """Odstraní markdown formátování z textu pro čistý výstup v PDF."""
            if not text:
                return text
            # Odstraní **tučné** a *kurzíva* markery
            text = _re_strip.sub(r'\*{1,3}([^*]+)\*{1,3}', r'\1', text)
            # Odstraní odrážky "* text" na začátku řádku
            text = _re_strip.sub(r'^\s*\*\s+', '', text, flags=_re_strip.MULTILINE)
            # Odstraní ###/##/# nadpisy
            text = _re_strip.sub(r'^#{1,6}\s+', '', text, flags=_re_strip.MULTILINE)
            return text.strip()

        # Fetch full criterion descriptions {nazev: popis} — popis očištěn od markdown
        criteria_descriptions = {}
        criteria_q = db.query(EvaluationCriteria).filter(EvaluationCriteria.scenario_name == decoded_id)
        criteria_record = apply_data_isolation(criteria_q, EvaluationCriteria, current_user, db).first()
        if criteria_record:
            for c in db.query(Criterion).filter(Criterion.evaluation_criteria_id == criteria_record.id).all():
                criteria_descriptions[c.nazev] = _strip_markdown(c.popis) or c.nazev

        # class_name: query param má nejvyšší prioritu (frontend posílá aktuální výběr)
        if not class_name:
            _eval_class_q = db.query(StudentEvaluation).filter(
                StudentEvaluation.scenario_name == decoded_id,
                StudentEvaluation.class_id != None
            )
            _eval_class = apply_data_isolation(_eval_class_q, StudentEvaluation, current_user, db).first()
            if _eval_class and _eval_class.class_id:
                _cr = db.query(ClassRoom).filter(ClassRoom.id == _eval_class.class_id).first()
                if _cr:
                    class_name = _cr.name
            if not class_name and cached_analysis.class_id:
                _cr2 = db.query(ClassRoom).filter(ClassRoom.id == cached_analysis.class_id).first()
                if _cr2:
                    class_name = _cr2.name

        # scenario_display_name: query param má nejvyšší prioritu
        scenario_display = scenario_display_name  # z query param
        if not scenario_display:
            _eval_q = db.query(StudentEvaluation).filter(
                StudentEvaluation.scenario_name == decoded_id,
                StudentEvaluation.scenario_display_name != None,
                StudentEvaluation.scenario_display_name != ""
            )
            _eval_sample = apply_data_isolation(_eval_q, StudentEvaluation, current_user, db).first()
            if _eval_sample and _eval_sample.scenario_display_name:
                scenario_display = _eval_sample.scenario_display_name

        # Fallback: parse markdown_content for first ## heading
        if not scenario_display and criteria_record and criteria_record.markdown_content:
            for _line in criteria_record.markdown_content.strip().split('\n'):
                _line = _line.strip()
                if _line.startswith('## '):
                    scenario_display = _line[3:].strip()
                    break
                elif _line.startswith('# '):
                    scenario_display = _line[2:].strip()
                    break

        # Last fallback: raw scenario ID
        if not scenario_display:
            scenario_display = decoded_id

        pdf_bytes = generate_class_report_pdf(
            data, decoded_id, current_user,
            scenario_display_name=scenario_display,
            class_name=class_name,
            criteria_descriptions=criteria_descriptions
        )
        
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
        
        query = db.query(StudentEvaluation).filter(StudentEvaluation.id == evaluation_id)
        evaluation = apply_data_isolation(query, StudentEvaluation, current_user, db).first()
        
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
def export_class_excel(
    class_id: int,
    scenario_id: str = None,
    class_name: str = "",
    scenario_display_name: str = "",
    db: Session = Depends(get_db),
    current_user: Lecturer = Depends(get_current_lecturer)
):
    """
    Vygeneruje a vrátí XLSX sešit výsledků celé třídy.
    """
    try:
        excel_bytes = generate_class_excel(class_id, db, current_user, scenario_id, class_name, scenario_display_name)
        
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
