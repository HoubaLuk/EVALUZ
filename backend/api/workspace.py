"""Strom tříd a modelových situací lektora (ADR-031).

Dřív žil výhradně v `localStorage` prohlížeče. Modelová situace vytvořená na jednom
počítači tak na jiném vůbec neexistovala — a protože se `scenario_id` generuje na
klientovi (`scen-${Date.now()}`), nešlo ho odnikud zjistit. Kritéria i vyhodnocení
přitom v databázi byla; jen se k nim nedalo dostat.

Strom se ukládá i vrací jako celek. Frontend s ním tak pracuje, takže dělit ho na
jednotlivé operace by přineslo jen složitost a možnost nekonzistence mezi kroky.
"""
import datetime
import logging
from typing import Any, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from core.database import get_db
from models.db_models import Lecturer, LecturerWorkspace
from api.auth import get_current_lecturer

logger = logging.getLogger("evaluz.workspace")

router = APIRouter(prefix="/workspace", tags=["workspace"])

# Pojistka proti odeslání nesmyslně velkého stromu. Reálný strom má jednotky tříd
# a desítky situací, takže tenhle strop nikdo poctivým používáním nedosáhne.
MAX_CLASSES = 200
MAX_SCENARIOS_PER_CLASS = 500


class WorkspaceScenario(BaseModel):
    id: str
    name: str = ""


class WorkspaceClass(BaseModel):
    id: str
    name: str = ""
    expanded: bool = True
    scenarios: List[WorkspaceScenario] = []


class WorkspacePayload(BaseModel):
    classes: List[WorkspaceClass] = Field(default_factory=list)


class WorkspaceResponse(BaseModel):
    # None znamená „lektor ještě nic neuložil" — frontend v takovém případě nabídne
    # jednorázový přenos stromu z localStorage. Prázdný seznam je NĚCO JINÉHO:
    # lektor si strom vědomě vymazal a nesmí se mu vrátit.
    classes: List[WorkspaceClass] | None = None
    updated_at: datetime.datetime | None = None


def _get_row(db: Session, lecturer_id: int) -> LecturerWorkspace | None:
    return db.query(LecturerWorkspace).filter(
        LecturerWorkspace.lecturer_id == lecturer_id
    ).first()


@router.get("", response_model=WorkspaceResponse)
def get_workspace(db: Session = Depends(get_db), current_user: Lecturer = Depends(get_current_lecturer)):
    """Vrátí strom přihlášeného lektora. `classes: null` = ještě nikdy neuložil."""
    row = _get_row(db, current_user.id)
    if not row or row.tree is None:
        return WorkspaceResponse(classes=None, updated_at=None)

    tree = row.tree
    # Starší nebo poškozený zápis nesmí shodit celé UI — raději se tvářit jako
    # „nic uloženo" a nechat frontend nabídnout přenos z prohlížeče.
    if not isinstance(tree, list):
        logger.warning(
            f"[WORKSPACE] Strom lektora id={current_user.id} není seznam "
            f"({type(tree).__name__}) — vracím jako neuložený."
        )
        return WorkspaceResponse(classes=None, updated_at=row.updated_at)

    return WorkspaceResponse(classes=tree, updated_at=row.updated_at)


@router.put("", response_model=WorkspaceResponse)
def save_workspace(
    payload: WorkspacePayload,
    db: Session = Depends(get_db),
    current_user: Lecturer = Depends(get_current_lecturer),
):
    """Uloží celý strom. Poslední zápis vyhrává — viz ADR-031."""
    if len(payload.classes) > MAX_CLASSES:
        raise HTTPException(status_code=400, detail=f"Příliš mnoho tříd (limit {MAX_CLASSES}).")
    for cls in payload.classes:
        if len(cls.scenarios) > MAX_SCENARIOS_PER_CLASS:
            raise HTTPException(
                status_code=400,
                detail=f"Třída '{cls.name}' má příliš mnoho modelových situací "
                       f"(limit {MAX_SCENARIOS_PER_CLASS}).",
            )

    tree: Any = [cls.model_dump() for cls in payload.classes]

    row = _get_row(db, current_user.id)
    if not row:
        row = LecturerWorkspace(lecturer_id=current_user.id)
        db.add(row)

    row.tree = tree
    row.updated_at = datetime.datetime.utcnow()
    db.commit()
    db.refresh(row)

    return WorkspaceResponse(classes=tree, updated_at=row.updated_at)
