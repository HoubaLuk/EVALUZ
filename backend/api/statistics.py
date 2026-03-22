from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Dict, Any
import datetime

from core.database import get_db
from models.db_models import StudentEvaluation, Lecturer
from api.auth import get_current_lecturer

router = APIRouter(
    prefix="/statistics",
    tags=["statistics"]
)

@router.get("/dashboard")
def get_statistics_dashboard(db: Session = Depends(get_db), current_user: Lecturer = Depends(get_current_lecturer)):
    """
    Vrátí agregované statistiky počtu vyhodnocených ÚZ.
    Superadmin vidí vše, rozdělené podle Organizačních článků.
    Admin vidí pouze svůj Organizační článek, rozdělený např. podle lektorů.
    Ostatní nemají přístup.
    """
    if not (current_user.is_superadmin or current_user.is_admin):
        raise HTTPException(status_code=403, detail="Nedostatečná oprávnění pro přístup ke statistikám.")

    # Base query for StudentEvaluations, joined with Lecturer
    query = db.query(StudentEvaluation, Lecturer).join(Lecturer, StudentEvaluation.lecturer_id == Lecturer.id)

    # Role-based filtering
    if not current_user.is_superadmin and current_user.is_admin:
        # Admin vidí pouze záznamy za svůj organizační článek (school_location)
        query = query.filter(Lecturer.school_location == current_user.school_location)

    records = query.all()
    
    # Aggregation
    total_evaluations = len(records)
    
    by_org_unit = {}
    by_lecturer = {}
    timeline = {}
    
    for eval_record, lecturer in records:
        # Org unit stats
        org_name = lecturer.school_location or "Neznámý útvar"
        by_org_unit[org_name] = by_org_unit.get(org_name, 0) + 1
        
        # Lecturer stats
        lec_name = f"{lecturer.last_name} {lecturer.first_name}".strip() or lecturer.email
        by_lecturer[lec_name] = by_lecturer.get(lec_name, 0) + 1
        
        # Timeline stats (Group by YYYY-MM-DD or YYYY-WW)
        if eval_record.created_at:
            date_prefix = eval_record.created_at[:10] # "YYYY-MM-DD"
        else:
            date_prefix = "Archiv"
        timeline[date_prefix] = timeline.get(date_prefix, 0) + 1

    # Convert maps to sorted arrays for the frontend charts
    org_stats = [{"name": k, "count": v} for k, v in by_org_unit.items()]
    org_stats.sort(key=lambda x: x["count"], reverse=True)
    
    lec_stats = [{"name": k, "count": v} for k, v in by_lecturer.items()]
    lec_stats.sort(key=lambda x: x["count"], reverse=True)
    
    time_stats = [{"date": k, "count": v} for k, v in timeline.items()]
    time_stats.sort(key=lambda x: x["date"])

    return {
        "role": "superadmin" if current_user.is_superadmin else "admin",
        "org_unit": current_user.school_location if current_user.is_admin and not current_user.is_superadmin else "Všechny útvary",
        "total_evaluations": total_evaluations,
        "by_org_unit": org_stats,
        "by_lecturer": lec_stats,
        "timeline": time_stats
    }

@router.get("/export/excel")
def export_statistics_excel(db: Session = Depends(get_db), current_user: Lecturer = Depends(get_current_lecturer)):
    from services.pdf_generator import generate_dashboard_excel
    from fastapi import Response
    
    data = get_statistics_dashboard(db, current_user)
    excel_bytes = generate_dashboard_excel(data)
    
    headers = {
        'Content-Disposition': f'attachment; filename="statistiky_evaluz.xlsx"'
    }
    return Response(
        content=excel_bytes, 
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 
        headers=headers
    )
