"""Strom tříd a modelových situací lektora (ADR-033).

Modelová situace je řádek v databázi, který patří konkrétnímu lektorovi. Strom se z těch
řádků odvozuje — ne naopak. Dřív to bylo obráceně: `scenario_id` vzniklo na klientovi
(`scen-${Date.now()}`) a jediným záznamem o existenci situace byl strom v prohlížeči,
později JSON blob na serveru (ADR-031). Když se strom ztratil nebo přepsal, kritéria
a vyhodnocení v DB zůstala, ale nevedla k nim žádná cesta.

Dvě pravidla, na kterých to celé stojí:

1. **Klíč generuje server.** Klient ho nesmí určit ani poslat — kolize mezi počítači
   tím přestává být možná.
2. **Nic se nesmaže potichu.** Smazání situace nebo třídy, pod kterou leží vyhodnocení,
   vrátí 409 s počtem dotčených záznamů. Teprve výslovné `force=true` smaže situaci
   i její data. Stav „záznam v DB, ke kterému nevede cesta" tak nemůže vzniknout.
"""
import datetime
import logging
import uuid
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from core.database import get_db
from models.db_models import (
    ClassAnalysis, EvaluationCriteria, Lecturer, Scenario, StudentEvaluation, StudyGroup,
)
from api.auth import get_current_lecturer, apply_data_isolation

logger = logging.getLogger("evaluz.workspace")

router = APIRouter(prefix="/workspace", tags=["workspace"])

MAX_NAME_LEN = 200


# ── Schémata ──────────────────────────────────────────────────────────────────

class ScenarioOut(BaseModel):
    id: int
    # `key` je to, co zbytek aplikace zná jako `scenario_id` / `scenario_name`.
    key: str
    name: str = ""


class GroupOut(BaseModel):
    id: int
    name: str = ""
    scenarios: List[ScenarioOut] = []


class TreeOut(BaseModel):
    groups: List[GroupOut] = []


class GroupIn(BaseModel):
    name: str = Field(default="", max_length=MAX_NAME_LEN)


class ScenarioIn(BaseModel):
    group_id: int
    name: str = Field(default="", max_length=MAX_NAME_LEN)


class ScenarioPatch(BaseModel):
    name: str | None = Field(default=None, max_length=MAX_NAME_LEN)
    group_id: int | None = None


# ── Pomocné ───────────────────────────────────────────────────────────────────

def _own_group(db: Session, group_id: int, user: Lecturer) -> StudyGroup:
    """Vrátí třídu, jen když patří přihlášenému lektorovi. Jinak 404.

    404 (ne 403) záměrně: cizí ID se nemá potvrdit ani tím, že existuje.
    """
    q = db.query(StudyGroup).filter(StudyGroup.id == group_id)
    row = apply_data_isolation(q, StudyGroup, user, db).first()
    if not row:
        raise HTTPException(status_code=404, detail="Třída nebyla nalezena.")
    return row


def _own_scenario(db: Session, scenario_id: int, user: Lecturer) -> Scenario:
    q = db.query(Scenario).filter(Scenario.id == scenario_id)
    row = apply_data_isolation(q, Scenario, user, db).first()
    if not row:
        raise HTTPException(status_code=404, detail="Modelová situace nebyla nalezena.")
    return row


def _next_position(db: Session, model, user: Lecturer, **filters) -> int:
    q = db.query(model).filter_by(**filters)
    rows = apply_data_isolation(q, model, user, db).all()
    return max((r.position or 0) + 1 for r in rows) if rows else 0


def _count_evaluations(db: Session, user: Lecturer, keys: List[str]) -> int:
    if not keys:
        return 0
    q = db.query(StudentEvaluation).filter(StudentEvaluation.scenario_name.in_(keys))
    return apply_data_isolation(q, StudentEvaluation, user, db).count()


def _purge_scenario_data(db: Session, user: Lecturer, keys: List[str]) -> None:
    """Smaže vyhodnocení, kritéria i cache analytiky pro dané klíče.

    Vždy přes izolaci dat — mazání cizích záznamů nesmí být možné ani omylem.
    """
    if not keys:
        return
    for model in (StudentEvaluation, EvaluationCriteria):
        q = db.query(model).filter(model.scenario_name.in_(keys))
        for row in apply_data_isolation(q, model, user, db).all():
            db.delete(row)

    q = db.query(ClassAnalysis).filter(ClassAnalysis.scenario_id.in_(keys))
    for row in apply_data_isolation(q, ClassAnalysis, user, db).all():
        db.delete(row)


def _conflict(scenarios: int, evaluations: int) -> HTTPException:
    """409 s počty, ať frontend může říct, co přesně se chystá smazat."""
    return HTTPException(
        status_code=409,
        detail={"error": "has_evaluations", "scenarios": scenarios, "evaluations": evaluations},
    )


# ── Endpointy ─────────────────────────────────────────────────────────────────

@router.get("", response_model=TreeOut)
def get_tree(db: Session = Depends(get_db), current_user: Lecturer = Depends(get_current_lecturer)):
    """Strom přihlášeného lektora, složený z jeho vlastních řádků."""
    groups = apply_data_isolation(
        db.query(StudyGroup), StudyGroup, current_user, db
    ).order_by(StudyGroup.position, StudyGroup.id).all()

    scenarios = apply_data_isolation(
        db.query(Scenario), Scenario, current_user, db
    ).order_by(Scenario.position, Scenario.id).all()

    podle_skupiny: dict[int, List[ScenarioOut]] = {}
    for s in scenarios:
        podle_skupiny.setdefault(s.group_id, []).append(
            ScenarioOut(id=s.id, key=s.scenario_key, name=s.display_name or "")
        )

    return TreeOut(groups=[
        GroupOut(id=g.id, name=g.name or "", scenarios=podle_skupiny.get(g.id, []))
        for g in groups
    ])


@router.post("/groups", response_model=GroupOut, status_code=201)
def create_group(
    payload: GroupIn,
    db: Session = Depends(get_db),
    current_user: Lecturer = Depends(get_current_lecturer),
):
    row = StudyGroup(
        lecturer_id=current_user.id,
        name=payload.name.strip(),
        position=_next_position(db, StudyGroup, current_user),
        created_at=datetime.datetime.utcnow(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return GroupOut(id=row.id, name=row.name or "", scenarios=[])


@router.patch("/groups/{group_id}", response_model=GroupOut)
def rename_group(
    group_id: int,
    payload: GroupIn,
    db: Session = Depends(get_db),
    current_user: Lecturer = Depends(get_current_lecturer),
):
    row = _own_group(db, group_id, current_user)
    row.name = payload.name.strip()
    db.commit()
    db.refresh(row)
    return GroupOut(id=row.id, name=row.name or "", scenarios=[])


@router.delete("/groups/{group_id}")
def delete_group(
    group_id: int,
    force: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user: Lecturer = Depends(get_current_lecturer),
):
    """Smaže třídu i situace pod ní. Bez `force` odmítne, pokud pod ní leží data."""
    row = _own_group(db, group_id, current_user)

    scenarios = apply_data_isolation(
        db.query(Scenario).filter(Scenario.group_id == group_id), Scenario, current_user, db
    ).all()
    keys = [s.scenario_key for s in scenarios]
    pocet = _count_evaluations(db, current_user, keys)

    if pocet and not force:
        raise _conflict(scenarios=len(scenarios), evaluations=pocet)

    _purge_scenario_data(db, current_user, keys)
    for s in scenarios:
        db.delete(s)
    db.delete(row)
    db.commit()
    return {"status": "deleted", "scenarios": len(scenarios), "evaluations": pocet}


@router.post("/scenarios", response_model=ScenarioOut, status_code=201)
def create_scenario(
    payload: ScenarioIn,
    db: Session = Depends(get_db),
    current_user: Lecturer = Depends(get_current_lecturer),
):
    """Založí situaci. Klíč generuje SERVER — klient ho nemůže ovlivnit (ADR-033)."""
    _own_group(db, payload.group_id, current_user)

    row = Scenario(
        lecturer_id=current_user.id,
        group_id=payload.group_id,
        scenario_key=f"scen-{uuid.uuid4().hex}",
        display_name=payload.name.strip(),
        position=_next_position(db, Scenario, current_user, group_id=payload.group_id),
        created_at=datetime.datetime.utcnow(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return ScenarioOut(id=row.id, key=row.scenario_key, name=row.display_name or "")


@router.patch("/scenarios/{scenario_id}", response_model=ScenarioOut)
def update_scenario(
    scenario_id: int,
    payload: ScenarioPatch,
    db: Session = Depends(get_db),
    current_user: Lecturer = Depends(get_current_lecturer),
):
    row = _own_scenario(db, scenario_id, current_user)

    if payload.name is not None:
        row.display_name = payload.name.strip()
    if payload.group_id is not None:
        _own_group(db, payload.group_id, current_user)
        row.group_id = payload.group_id

    db.commit()
    db.refresh(row)
    return ScenarioOut(id=row.id, key=row.scenario_key, name=row.display_name or "")


@router.delete("/scenarios/{scenario_id}")
def delete_scenario(
    scenario_id: int,
    force: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user: Lecturer = Depends(get_current_lecturer),
):
    """Smaže situaci. Bez `force` odmítne, pokud pod ní leží vyhodnocení."""
    row = _own_scenario(db, scenario_id, current_user)
    pocet = _count_evaluations(db, current_user, [row.scenario_key])

    if pocet and not force:
        raise _conflict(scenarios=1, evaluations=pocet)

    _purge_scenario_data(db, current_user, [row.scenario_key])
    db.delete(row)
    db.commit()
    return {"status": "deleted", "scenarios": 1, "evaluations": pocet}
