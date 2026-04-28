from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Dict, Any, Optional
import json

from core.database import get_db
from models.db_models import StudentEvaluation, Lecturer, ClassRoom, AppSettings
from api.auth import get_current_lecturer

router = APIRouter(
    prefix="/statistics",
    tags=["statistics"]
)


def _get_allowed_lecturer_ids(current_user: Lecturer, db: Session) -> Optional[List[int]]:
    """Returns list of lecturer IDs visible to current user, or None if superadmin (no restriction)."""
    if current_user.is_superadmin:
        return None
    if current_user.is_admin and current_user.school_location:
        return [l.id for l in db.query(Lecturer.id).filter(Lecturer.school_location == current_user.school_location).all()]
    return [current_user.id]


@router.get("/filter-options")
def get_filter_options(db: Session = Depends(get_db), current_user: Lecturer = Depends(get_current_lecturer)):
    """Returns available filter values (facilities, classes, scenarios) respecting RBAC."""
    if not (current_user.is_superadmin or current_user.is_admin):
        raise HTTPException(status_code=403, detail="Nedostatečná oprávnění.")

    allowed_ids = _get_allowed_lecturer_ids(current_user, db)

    # Facilities — only for superadmin, read from AppSettings
    facilities: List[str] = []
    if current_user.is_superadmin:
        setting = db.query(AppSettings).filter(AppSettings.key == "SCHOOL_LOCATIONS").first()
        if setting and setting.value:
            try:
                facilities = json.loads(setting.value)
            except (json.JSONDecodeError, TypeError):
                pass

    # Classes — with RBAC
    class_query = db.query(ClassRoom)
    if allowed_ids is not None:
        class_query = class_query.filter(ClassRoom.lecturer_id.in_(allowed_ids))
    classes_raw = class_query.all()
    # Deduplicate by name (multiple lecturers may have same class name)
    seen_names: Dict[str, int] = {}
    classes = []
    for c in classes_raw:
        if c.name not in seen_names:
            seen_names[c.name] = c.id
            classes.append({"id": c.id, "name": c.name})
    classes.sort(key=lambda x: x["name"])

    # Scenarios — with RBAC, return id + display name
    scenario_query = db.query(
        StudentEvaluation.scenario_name,
        func.max(StudentEvaluation.scenario_display_name)
    ).group_by(StudentEvaluation.scenario_name)
    if allowed_ids is not None:
        scenario_query = scenario_query.filter(StudentEvaluation.lecturer_id.in_(allowed_ids))
    scenarios = sorted(
        [{"id": r[0], "name": r[1] or r[0]} for r in scenario_query.all() if r[0]],
        key=lambda x: x["name"]
    )

    return {
        "facilities": facilities,
        "classes": classes,
        "scenarios": scenarios
    }


@router.get("/dashboard")
def get_statistics_dashboard(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    facility: Optional[str] = None,
    class_id: Optional[int] = None,
    scenario_name: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: Lecturer = Depends(get_current_lecturer)
):
    """
    Vrátí agregované statistiky počtu vyhodnocených ÚZ.
    Superadmin vidí vše, rozdělené podle Organizačních článků.
    Admin vidí pouze svůj Organizační článek, rozdělený např. podle lektorů.
    Ostatní nemají přístup.
    """
    if not (current_user.is_superadmin or current_user.is_admin):
        raise HTTPException(status_code=403, detail="Nedostatečná oprávnění pro přístup ke statistikám.")

    # Base query for StudentEvaluations, joined with Lecturer
    # Filtrujeme pouze záznamy s dokončeným vyhodnocením (json_result IS NOT NULL).
    # Fast-scan vytváří záznamy okamžitě (UX), json_result se plní až po dokončení LLM —
    # bez tohoto filtru by se nedokončené záznamy počítaly do statistik.
    query = db.query(StudentEvaluation, Lecturer).join(
        Lecturer, StudentEvaluation.lecturer_id == Lecturer.id
    ).filter(
        StudentEvaluation.json_result.isnot(None)
    )

    # Role-based filtering
    if not current_user.is_superadmin and current_user.is_admin:
        query = query.filter(Lecturer.school_location == current_user.school_location)

    # Apply optional filters
    if facility and current_user.is_superadmin:
        query = query.filter(Lecturer.school_location == facility)
    if class_id:
        query = query.filter(StudentEvaluation.class_id == class_id)
    if scenario_name:
        query = query.filter(StudentEvaluation.scenario_name == scenario_name)
    if start_date:
        try:
            from datetime import datetime as _dt
            query = query.filter(StudentEvaluation.created_at >= _dt.fromisoformat(start_date))
        except Exception:
            pass
    if end_date:
        try:
            from datetime import datetime as _dt
            query = query.filter(StudentEvaluation.created_at <= _dt.fromisoformat(end_date).replace(hour=23, minute=59, second=59))
        except Exception:
            pass

    records = query.all()

    # Prefetch class name map
    class_map = {c.id: c.name for c in db.query(ClassRoom).all()}

    # Aggregation
    total_evaluations = len(records)

    by_org_unit: Dict[str, int] = {}
    by_lecturer: Dict[str, int] = {}
    timeline: Dict[str, int] = {}

    # New aggregations
    score_by_group: Dict[str, List[float]] = {}  # group_name -> list of percentages
    criterion_stats: Dict[str, Dict[str, int]] = {}  # criterion_name -> {total, failures}

    for eval_record, lecturer in records:
        # Org unit stats
        org_name = lecturer.school_location or "Neznámý útvar"
        by_org_unit[org_name] = by_org_unit.get(org_name, 0) + 1

        # Lecturer stats
        lec_name = f"{lecturer.last_name} {lecturer.first_name}".strip() or lecturer.email
        by_lecturer[lec_name] = by_lecturer.get(lec_name, 0) + 1

        # Timeline stats
        if eval_record.created_at:
            # created_at může být datetime objekt (SQLite) nebo string (starší záznamy)
            ca = eval_record.created_at
            if hasattr(ca, 'strftime'):
                date_prefix = ca.strftime('%Y-%m-%d')
            else:
                date_prefix = str(ca)[:10]
        else:
            date_prefix = "Archiv"
        timeline[date_prefix] = timeline.get(date_prefix, 0) + 1

        # Parse json_result for score + criterion analysis
        if eval_record.json_result:
            try:
                result = eval_record.json_result
                if isinstance(result, str):
                    result = json.loads(result)
                if isinstance(result, str):  # handle double-encoded JSON
                    result = json.loads(result)
                vysledky = result.get("vysledky", [])

                # Calculate score percentage
                total_points = 0
                max_points = 0
                for v in vysledky:
                    body = v.get("body", 0)
                    total_points += body
                    # Max points: use body if splneno, otherwise we need the criterion's max
                    # Since we don't have max per criterion here, approximate: splneno items contribute their body,
                    # failed items contribute 0 but we need max. Use a heuristic: sum body for passed + body for failed if available.
                    # Better approach: count each criterion as worth its body value when passed.
                    # For failed criteria body=0, so we can't derive max from json_result alone.
                    # Use max_mozne_skore from result if available.
                    pass

                celkove = result.get("celkove_skore", total_points)
                max_skore = result.get("max_mozne_skore", None)

                if max_skore and max_skore > 0:
                    pct = (celkove / max_skore) * 100
                elif vysledky:
                    # Fallback: sum body values from passed criteria and estimate max
                    # This is imprecise but better than nothing
                    pct = None
                else:
                    pct = None

                if pct is not None:
                    # Group by class or facility
                    group_name = class_map.get(eval_record.class_id, f"Třída #{eval_record.class_id}")
                    if current_user.is_superadmin and not class_id:
                        group_name = org_name  # Group by facility for superadmin when no class filter
                    score_by_group.setdefault(group_name, []).append(pct)

                # Criterion failure tracking
                for v in vysledky:
                    nazev = v.get("nazev", "")
                    if not nazev:
                        continue
                    if nazev not in criterion_stats:
                        criterion_stats[nazev] = {"total": 0, "failures": 0}
                    criterion_stats[nazev]["total"] += 1
                    if v.get("body", 0) == 0:
                        criterion_stats[nazev]["failures"] += 1

            except (json.JSONDecodeError, TypeError, KeyError):
                pass

    # Convert maps to sorted arrays
    org_stats = [{"name": k, "count": v} for k, v in by_org_unit.items()]
    org_stats.sort(key=lambda x: x["count"], reverse=True)

    lec_stats = [{"name": k, "count": v} for k, v in by_lecturer.items()]
    lec_stats.sort(key=lambda x: x["count"], reverse=True)

    time_stats = [{"date": k, "count": v} for k, v in timeline.items()]
    time_stats.sort(key=lambda x: x["date"])

    # Build avg_score_by_group
    avg_score_by_group = []
    for name, pcts in score_by_group.items():
        if pcts:
            avg_score_by_group.append({"name": name, "avg_pct": round(sum(pcts) / len(pcts), 1)})
    avg_score_by_group.sort(key=lambda x: x["avg_pct"], reverse=True)

    # Build top_failures (top 5 criteria with highest failure rate)
    top_failures = []
    for nazev, stats in criterion_stats.items():
        if stats["total"] > 0:
            top_failures.append({
                "nazev": nazev,
                "failure_rate": round(stats["failures"] / stats["total"], 3),
                "failure_count": stats["failures"],
                "total": stats["total"]
            })
    top_failures.sort(key=lambda x: x["failure_rate"], reverse=True)
    top_failures = top_failures[:5]

    return {
        "role": "superadmin" if current_user.is_superadmin else "admin",
        "org_unit": current_user.school_location if current_user.is_admin and not current_user.is_superadmin else "Všechny útvary",
        "total_evaluations": total_evaluations,
        "by_org_unit": org_stats,
        "by_lecturer": lec_stats,
        "timeline": time_stats,
        "avg_score_by_group": avg_score_by_group,
        "top_failures": top_failures
    }


@router.get("/export/excel")
def export_statistics_excel(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    facility: Optional[str] = None,
    class_id: Optional[int] = None,
    scenario_name: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: Lecturer = Depends(get_current_lecturer)
):
    from services.pdf_generator import generate_dashboard_excel
    from fastapi import Response

    data = get_statistics_dashboard(start_date, end_date, facility, class_id, scenario_name, db, current_user)
    excel_bytes = generate_dashboard_excel(data)

    headers = {
        'Content-Disposition': f'attachment; filename="statistiky_evaluz.xlsx"'
    }
    return Response(
        content=excel_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers
    )
