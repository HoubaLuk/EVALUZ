from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response, PlainTextResponse
from sqlalchemy.orm import Session
from core.database import get_db
from models.db_models import StudentEvaluation
from services.pdf_generator import generate_student_pdf, generate_class_csv

router = APIRouter(
    prefix="/export",
    tags=["export"]
)

@router.get("/student/by-name/{student_name}/pdf", response_class=Response)
def export_student_pdf(student_name: str, db: Session = Depends(get_db)):
    """
    Vygeneruje a vrátí PDF hodnocení pro nejnovější záznam daného studenta.
    Očekává přesnou shodu jména.
    """
    # Bereme nejnovější evaluaci pro daného studenta (např. po novém nahrátí)
    evaluation = db.query(StudentEvaluation).filter(
        StudentEvaluation.student_name == student_name
    ).order_by(StudentEvaluation.created_at.desc()).first()
    
    if not evaluation:
        raise HTTPException(status_code=404, detail=f"Hodnocení pro studenta '{student_name}' nebylo nalezeno.")
        
    try:
        pdf_bytes = generate_student_pdf(evaluation)
        
        headers = {
            'Content-Disposition': f'attachment; filename="hodnoceni_{student_name.replace(" ", "_")}.pdf"'
        }
        
        return Response(content=bytes(pdf_bytes), media_type="application/pdf", headers=headers)
        
    except Exception as e:
        print(f"Error generating PDF: {e}")
        raise HTTPException(status_code=500, detail="Chyba při generování PDF.")

@router.get("/class/{class_id}/csv", response_class=PlainTextResponse)
def export_class_csv(class_id: int, db: Session = Depends(get_db)):
    """
    Vygeneruje a vrátí CSV tabulku výsledků celé třídy.
    """
    try:
        csv_string = generate_class_csv(class_id, db)
        
        headers = {
            'Content-Disposition': f'attachment; filename="vysledky_trida_{class_id}.csv"'
        }
        # UTF-8 with BOM for Excel compatibility
        content = '\ufeff' + csv_string
        
        return PlainTextResponse(content=content, headers=headers, media_type="text/csv; charset=utf-8")
        
    except Exception as e:
        print(f"Error generating CSV: {e}")
        raise HTTPException(status_code=500, detail="Chyba při generování CSV.")
