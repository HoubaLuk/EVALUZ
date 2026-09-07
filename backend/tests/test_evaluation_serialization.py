"""Regresní testy pro serializaci dílčích hodnocení do API odpovědi (ADR-030).

`CriterionResult` je Pydantic model a v Pydantic v2 se nedeklarovaná pole při
serializaci **tiše zahazují**. Metadata se přitom podle zavedeného postupu ukládají
přímo do `json_result` bez migrace (JSONB je schemaless), takže `jistota`,
`upraveno_lektorem`, `_llm_omitted` i `_llm_actual_name` v databázi byly, ale
z odpovědi `GET /analytics/class/{id}` zmizely a do prohlížeče se nedostaly.

Selhání bylo dokonale tiché: žádná chyba, žádný log, jen prázdné místo v UI.
Tenhle modul hlídá kontrakt mezi tím, co se ukládá, a tím, co dostane frontend.
"""
import datetime
import sys
from pathlib import Path

import pytest

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from models.db_models import ClassRoom, StudentEvaluation
from models.evaluation import CriterionResult, EvaluationResponse

from tests.test_class_scoping import api_client, db_session  # noqa: F401  (pytest fixtures)
from tests.test_data_isolation import _auth_headers, _make_lecturer

SCENARIO = "scen-2"

# Pole, která do UI MUSÍ dorazit. Každé z nich je nositelem informace, kterou
# lektor jinak nemá jak zjistit.
METADATA_FIELDS = ("jistota", "upraveno_lektorem", "_llm_omitted", "_llm_actual_name")

FULL_CRITERION = {
    "nazev": "Ztotožnění osoby",
    "splneno": True,
    "body": 1,
    "oduvodneni": "Nalezeno v textu.",
    "citace": "Hlídka ztotožnila osobu.",
    "jistota": 2,
    "upraveno_lektorem": True,
    "_llm_omitted": False,
    "_llm_actual_name": "Ztotožnění osoby dle § 63",
}


class TestCriterionResultKeepsMetadata:
    @pytest.mark.parametrize("field", METADATA_FIELDS)
    def test_field_survives_serialization(self, field):
        dumped = CriterionResult(**FULL_CRITERION).model_dump()
        assert field in dumped, f"Pole '{field}' Pydantic zahodil — do UI nedorazí."

    def test_values_are_not_mangled(self):
        dumped = CriterionResult(**FULL_CRITERION).model_dump()
        assert dumped["jistota"] == 2
        assert dumped["upraveno_lektorem"] is True
        assert dumped["_llm_actual_name"] == "Ztotožnění osoby dle § 63"

    def test_absent_metadata_does_not_invent_values(self):
        """Chybějící jistota musí zůstat None, ne se dopočítat na nějaké číslo."""
        dumped = CriterionResult(nazev="K1").model_dump()
        assert dumped["jistota"] is None
        assert dumped["upraveno_lektorem"] is None

    def test_future_field_is_not_silently_dropped(self):
        """Ochrana i pro pole, která teprve vzniknou — JSONB je schemaless."""
        dumped = CriterionResult(**{**FULL_CRITERION, "zcela_nove_pole": 42}).model_dump()
        assert dumped.get("zcela_nove_pole") == 42


class TestEndpointDeliversMetadata:
    def test_metadata_reaches_the_client(self, db_session, api_client):
        """Kontrakt end-to-end: co je v json_result, to musí dorazit i do odpovědi API."""
        lecturer = _make_lecturer(db_session, email="serial@pcr.cz")
        room = ClassRoom(name="Základní kurz", lecturer_id=lecturer.id)
        db_session.add(room)
        db_session.commit()
        db_session.refresh(room)

        db_session.add(StudentEvaluation(
            lecturer_id=lecturer.id,
            student_name="Novák Jan",
            cleaned_name="Novák Jan",
            class_id=room.id,
            scenario_name=SCENARIO,
            json_result={
                "celkove_skore": 1,
                "max_skore": 1,
                "vysledky": [dict(FULL_CRITERION)],
            },
            student_identity={},
            created_at=datetime.datetime.utcnow(),
            is_approved=True,
        ))
        db_session.commit()

        res = api_client.get(
            f"/api/v1/analytics/class/{room.id}?scenario_id={SCENARIO}",
            headers=_auth_headers(lecturer),
        )
        assert res.status_code == 200, res.text

        kriterium = res.json()[0]["vysledky"][0]
        for field in METADATA_FIELDS:
            assert field in kriterium, f"Pole '{field}' se do odpovědi API nedostalo."
        assert kriterium["jistota"] == 2
