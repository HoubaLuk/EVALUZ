from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response, PlainTextResponse
from sqlalchemy.orm import Session
import urllib.parse
import unicodedata
import traceback
import re
from core.database import get_db
from models.db_models import StudentEvaluation, Lecturer
from services.pdf_generator import generate_student_pdf, generate_class_csv
from api.auth import get_current_lecturer

router = APIRouter(
    prefix="/export",
    tags=["export"]
)

@router.get("/student/by-name/{student_name}/pdf", response_class=Response)
def export_student_pdf(student_name: str, db: Session = Depends(get_db), current_user: Lecturer = Depends(get_current_lecturer)):
    """
    Vygeneruje a vrátí PDF hodnocení pro nejnovější záznam daného studenta.
    Očekává přesnou shodu jména.
    """
    try:
        # 1. Dekódování URL a normalizace (NFC pro čisté kódování české diakritiky)
        decoded_name = urllib.parse.unquote(student_name)
        normalized_name = unicodedata.normalize('NFC', decoded_name)
        
        # Bereme nejnovější evaluaci pro daného studenta (např. po novém nahrátí)
        evaluation = db.query(StudentEvaluation).filter(
            StudentEvaluation.student_name == normalized_name,
            StudentEvaluation.lecturer_id == current_user.id
        ).order_by(StudentEvaluation.id.desc()).first()
        
        if not evaluation:
            raise HTTPException(status_code=404, detail=f"Hodnocení pro studenta '{normalized_name}' nebylo nalezeno.")
            
        pdf_bytes = generate_student_pdf(evaluation, current_user)
        
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
        print("=== CHYBA PŘI EXPORTU PDF ===")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail="Chyba při generování PDF.")

@router.get("/class/{class_id}/csv", response_class=PlainTextResponse)
def export_class_csv(class_id: int, db: Session = Depends(get_db), current_user: Lecturer = Depends(get_current_lecturer)):
    """
    Vygeneruje a vrátí CSV tabulku výsledků celé třídy.
    """
    try:
        csv_string = generate_class_csv(class_id, db, current_user.id)
        
        headers = {
            'Content-Disposition': f'attachment; filename="vysledky_trida_{class_id}.csv"'
        }
        # UTF-8 with BOM for Excel compatibility
        content = '\ufeff' + csv_string
        
        return PlainTextResponse(content=content, headers=headers, media_type="text/csv; charset=utf-8")
        
    except Exception as e:
        print(f"Error generating CSV: {e}")
        raise HTTPException(status_code=500, detail="Chyba při generování CSV.")
