from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Dict, Any
import datetime
import json

from core.database import get_db
from models.db_models import StudentEvaluation, Lecturer, ClassAnalysis
from models.evaluation import EvaluationResponse
from services.analytics import generate_class_summary
from utils.sorting import sort_evaluations_by_surname
from api.auth import get_current_lecturer, apply_data_isolation
from pydantic import BaseModel


class EvaluationPatchRequest(BaseModel):
    json_result: dict


# Klíče, které si drží server a klient je nesmí přepsat ani zahodit (ADR-025).
# Frontend posílá jen podmnožinu JSONu (jmeno_studenta, celkove_skore, zpetna_vazba,
# vysledky), takže prostý přepis mazal `max_skore` a `identita`.
_SERVER_OWNED_KEYS = ("max_skore", "identita")


def _merge_evaluation_json(stored: dict, incoming: dict) -> dict:
    """Sloučí lektorovu úpravu do uloženého hodnocení místo jeho nahrazení.

    Klient posílá jen ta pole, která umí editovat. Původní implementace dělala
    `json_result = request.json_result`, čímž se nenávratně ztratilo všechno ostatní —
    zejména `max_skore` (autoritativní maximum z DB, v3.9.10) a `identita`. Frontend pak
    spadl na fallback výpočet maxima, který je u kritérií za víc než 1 bod chybný.
    """
    merged = dict(stored or {})
    merged.update(incoming or {})
    # Serverem vlastněné klíče se vrací z uložené verze, i kdyby je klient poslal.
    for key in _SERVER_OWNED_KEYS:
        if key in (stored or {}):
            merged[key] = stored[key]
    return merged


def _mark_lecturer_edits(stored_vysledky: list, incoming_vysledky: list) -> list:
    """Označí kritéria, do kterých zasáhl lektor, příznakem `_lecturer_modified`.

    Diff se dělá na serveru podle názvu kritéria, takže frontend nemusí nic posílat navíc.
    Jednou nastavený příznak se nemaže — drží informaci, že do položky sáhl člověk, i když
    ji lektor později vrátí na původní hodnotu.
    """
    original_by_name = {
        v.get("nazev"): v for v in (stored_vysledky or []) if isinstance(v, dict)
    }
    result = []
    for item in (incoming_vysledky or []):
        if not isinstance(item, dict):
            result.append(item)
            continue
        item = dict(item)
        before = original_by_name.get(item.get("nazev"))
        if before is not None:
            changed = any(
                before.get(field) != item.get(field)
                for field in ("splneno", "body", "oduvodneni")
            )
            if changed or before.get("_lecturer_modified"):
                item["_lecturer_modified"] = True
        result.append(item)
    return result


def _recalculate_score(vysledky: list) -> int:
    """Přepočítá celkové skóre ze splněných kritérií — server je autorita, ne klient.

    Stejná logika jako v `_validate_and_fix_vysledky` (llm_engine.py): sčítají se body
    pouze u splněných kritérií. Bez toho by klient mohl uložit skóre, které neodpovídá
    jednotlivým verdiktům, a analytika by pak počítala z nekonzistentních dat.
    """
    total = 0
    for v in (vysledky or []):
        if not isinstance(v, dict) or not v.get("splneno"):
            continue
        body = v.get("body")
        if isinstance(body, (int, float)):
            total += body
    return total

class NamePatchRequest(BaseModel):
    name: str

class ApproveRequest(BaseModel):
    approved: bool = True


router = APIRouter(
    prefix="/analytics",
    tags=["analytics"]
)

@router.get("/class/{class_id}", response_model=List[EvaluationResponse])
def get_class_evaluations(class_id: int, scenario_id: str = None, db: Session = Depends(get_db), current_user: Lecturer = Depends(get_current_lecturer)):
    """
    Retrieves all stored evaluations for a specific class ID.
    Parses the JSON strings from the DB and returns them as structured Pydantic models.
    """
    query = db.query(StudentEvaluation).filter(
        StudentEvaluation.class_id == class_id
    )
    query = apply_data_isolation(query, StudentEvaluation, current_user, db)
    
    if scenario_id:
        query = query.filter(StudentEvaluation.scenario_name == scenario_id)
        
    evaluations = query.all()
    evaluations = sort_evaluations_by_surname(evaluations)
    
    results = []

    for eval_record in evaluations:
        try:
            # DŮLEŽITÉ: Kopírujeme dict, aby nedošlo ke circular reference.
            # eval_record.json_result je JSONB z DB (dict). Kdybychom ho přímo mutovali
            # a pak přiřadili data["json_result"] = eval_record.json_result, vznikl by
            # circular reference (data odkazuje sám na sebe).
            raw_json = eval_record.json_result  # originál — NEZMĚNĚNÝ

            # Defensivní deserializace: starší záznamy mohou mít json_result jako
            # JSON string (TEXT sloupec před migrací na JSONB). dict(string) by způsobilo
            # "dictionary update sequence element #0 has length 1; 2 is required".
            if isinstance(raw_json, str):
                try:
                    raw_json = json.loads(raw_json)
                except (json.JSONDecodeError, TypeError, ValueError):
                    raw_json = {}

            data = dict(raw_json) if raw_json else {}  # mělká kopie pro mutace
            # Make sure we inject the student_name and ID into the payload just like the frontend expects it
            data["jmeno_studenta"] = eval_record.student_name
            data["id"] = eval_record.id
            data["cleaned_name"] = eval_record.cleaned_name
            # Inject raw json_result (originál, nikoli kopie data) pro frontend quickview
            data["json_result"] = raw_json
            data["is_approved"] = eval_record.is_approved or False

            # Defensivní deserializace identity: starší záznamy mohou mít student_identity
            # jako JSON string (TEXT) místo dict (JSONB). Pydantic EvaluationResponse
            # vyžaduje Optional[dict] — string způsobí ValidationError.
            identity = eval_record.student_identity
            if isinstance(identity, str):
                try:
                    identity = json.loads(identity)
                except (json.JSONDecodeError, TypeError, ValueError):
                    identity = None
            data["identita"] = identity if isinstance(identity, dict) else None
                
            if "vysledky" not in data:
                data["vysledky"] = []
            if "celkove_skore" not in data:
                data["celkove_skore"] = 0
            if "zpetna_vazba" not in data:
                data["zpetna_vazba"] = ""

            results.append(EvaluationResponse(**data))
        except Exception as e:
            print(f"Error parsing json for evaluation {eval_record.id}: {e}")
            # Skip invalid records
            continue
            
    return results

@router.get("/class/{class_id}/summary")
async def get_class_summary(class_id: int, scenario_id: str = "default", force: bool = False, db: Session = Depends(get_db), current_user: Lecturer = Depends(get_current_lecturer)):
    """
    Computes aggregated stats from student evaluations and requests
    an AI pedagogical insight from the vLLM engine based on Phase 3 prompt
    and context. Checks db for cached analysis first unless forced.
    """
    return await generate_class_summary(class_id, scenario_id, force, db, current_user)

@router.delete("/evaluation/{evaluation_id}")
def delete_evaluation(evaluation_id: int, db: Session = Depends(get_db), current_user: Lecturer = Depends(get_current_lecturer)):
    """
    Permanently deletes a student evaluation record from the database.
    """
    query = db.query(StudentEvaluation).filter(StudentEvaluation.id == evaluation_id)
    query = apply_data_isolation(query, StudentEvaluation, current_user, db)
    eval_record = query.first()
    if not eval_record:
        raise HTTPException(status_code=404, detail="Záznam nebyl nalezen.")
    
    db.delete(eval_record)
    db.commit()
    return {"status": "success", "message": "Záznam byl smazán."}

@router.patch("/evaluation/{evaluation_id}/score")
def patch_evaluation_score(evaluation_id: int, request: EvaluationPatchRequest, db: Session = Depends(get_db), current_user: Lecturer = Depends(get_current_lecturer)):
    """
    Overwrites the JSON result of an existing evaluation with manually corrected scores from the UI.
    Invalidates the analytics cache for the affected scenario.
    """
    query = db.query(StudentEvaluation).filter(StudentEvaluation.id == evaluation_id)
    query = apply_data_isolation(query, StudentEvaluation, current_user, db)
    eval_record = query.first()
    
    if not eval_record:
        raise HTTPException(status_code=404, detail="Záznam nebyl nalezen.")

    stored = eval_record.json_result if isinstance(eval_record.json_result, dict) else {}

    # Auditní stopa (ADR-025): původní hodnocení AI se uchová při PRVNÍ úpravě.
    # Další úpravy ho nepřepíšou — drží se verze, kterou skutečně vyprodukoval model.
    if eval_record.ai_original_json is None:
        eval_record.ai_original_json = stored

    merged = _merge_evaluation_json(stored, request.json_result)
    merged["vysledky"] = _mark_lecturer_edits(stored.get("vysledky"), merged.get("vysledky"))
    # Skóre je odvozená hodnota — počítá ho server ze samotných verdiktů, ne klient.
    merged["celkove_skore"] = _recalculate_score(merged.get("vysledky"))

    eval_record.json_result = merged
    eval_record.modified_at = datetime.datetime.utcnow()
    eval_record.modified_by = current_user.id

    # Invalidation of cache (only for the current lecturer)
    if eval_record.scenario_name:
        db.query(ClassAnalysis).filter(
            ClassAnalysis.scenario_id == eval_record.scenario_name,
            ClassAnalysis.lecturer_id == current_user.id,
            ClassAnalysis.class_id == eval_record.class_id
        ).delete()
        
    db.commit()
    return {"status": "success", "message": "Hodnocení manuálně upraveno. Analytika bude při příštím zobrazení přepočítána."}

@router.patch("/evaluation/{evaluation_id}/approve")
def approve_evaluation(evaluation_id: int, request: ApproveRequest, db: Session = Depends(get_db), current_user: Lecturer = Depends(get_current_lecturer)):
    """
    Schválí nebo odvolá schválení záznamu hodnocení lektorem (Man-in-the-Loop).
    Schválené záznamy jsou zahrnuty do analytiky, neschválené blokují výpočet.
    """
    query = db.query(StudentEvaluation).filter(StudentEvaluation.id == evaluation_id)
    query = apply_data_isolation(query, StudentEvaluation, current_user, db)
    eval_record = query.first()

    if not eval_record:
        raise HTTPException(status_code=404, detail="Záznam nebyl nalezen.")

    eval_record.is_approved = request.approved

    # Invalidace cache analytiky (stejný pattern jako patch_evaluation_score)
    if eval_record.scenario_name:
        db.query(ClassAnalysis).filter(
            ClassAnalysis.scenario_id == eval_record.scenario_name,
            ClassAnalysis.lecturer_id == current_user.id,
            ClassAnalysis.class_id == eval_record.class_id
        ).delete()

    db.commit()
    return {"status": "success", "is_approved": eval_record.is_approved}


@router.patch("/evaluation/{evaluation_id}/name")
def patch_evaluation_name(evaluation_id: int, request: NamePatchRequest, db: Session = Depends(get_db), current_user: Lecturer = Depends(get_current_lecturer)):
    """
    Ručně upraví extrahovanou identitu/jméno studenta.
    """
    query = db.query(StudentEvaluation).filter(StudentEvaluation.id == evaluation_id)
    query = apply_data_isolation(query, StudentEvaluation, current_user, db)
    eval_record = query.first()
    
    if not eval_record:
        raise HTTPException(status_code=404, detail="Záznam nebyl nalezen.")
        
    eval_record.cleaned_name = request.name
    eval_record.student_identity = None # Zamezí zobrazení původního JSON jména
    db.commit()
    return {"status": "success", "message": "Jméno studenta bylo ručně upraveno."}


@router.get("/class/{class_id}/status")
def get_class_analysis_status(class_id: int, db: Session = Depends(get_db), current_user: Lecturer = Depends(get_current_lecturer)):
    """
    Vrátí seznam scenario_id, pro které již existuje uložená globální analýza.
    Slouží pro UI (zlatá fajfka ve Stepperu), aniž by se musela tahat/generovat velká data.
    """
    query = db.query(ClassAnalysis.scenario_id).filter(ClassAnalysis.class_id == class_id)
    query = apply_data_isolation(query, ClassAnalysis, current_user, db)
    analyses = query.all()
    return [a[0] for a in analyses]
