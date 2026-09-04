"""Regresní testy pro determinismus a poctivost třídní statistiky (ADR-026, ADR-027).

Dvě nezávislé chyby, obě tiché:

1. Analytika páruje kritéria podle názvu proti výsledkům zamrzlým z doby vyhodnocení,
   ale načítá je z AKTUÁLNÍHO stavu DB. Po přejmenování kritéria párování selhalo:
   `passes` nenaskočil, jmenovatel zůstal, a kritérium se zobrazilo jako 0% úspěšnost —
   k nerozeznání od legitimní nuly.

2. `db_criteria` se načítalo bez ORDER BY. PostgreSQL pořadí řádků negarantuje a
   `save_criteria` dělá delete+insert, takže se pořadí měnilo. Frontend přitom popisuje
   sloupce v grafu podle POZICE (`K${i+1}`), takže „K7" mohlo označovat jiné kritérium.
"""
import datetime
import sys
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

import services.llm_engine as llm_engine
from models.db_models import ClassRoom, Criterion, EvaluationCriteria, StudentEvaluation
from services.analytics import generate_class_summary

from tests.test_class_scoping import api_client, db_session  # noqa: F401  (pytest fixtures)
from tests.test_data_isolation import _make_lecturer

SCENARIO = "scen-2"
CRITERIA_NAMES = ["Ztotožnění osoby", "Poučení osoby", "Popis zákroku"]


def _make_class(db, lecturer):
    room = ClassRoom(name="Základní kurz", lecturer_id=lecturer.id)
    db.add(room)
    db.commit()
    db.refresh(room)
    return room


def _make_criteria(db, lecturer, names=CRITERIA_NAMES):
    record = EvaluationCriteria(
        scenario_name=SCENARIO, lecturer_id=lecturer.id, markdown_content="…"
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    for name in names:
        db.add(Criterion(evaluation_criteria_id=record.id, nazev=name, popis="", body=1))
    db.commit()
    return record


def _add_record(db, *, lecturer, class_id, filename, results):
    """`results` je mapa název kritéria → splněno, tak jak ji uložila evaluace."""
    record = StudentEvaluation(
        lecturer_id=lecturer.id,
        student_name=filename,
        cleaned_name=filename,
        class_id=class_id,
        scenario_name=SCENARIO,
        scenario_display_name="MS2",
        json_result={
            "celkove_skore": sum(1 for met in results.values() if met),
            "vysledky": [
                {"nazev": name, "splneno": met, "body": 1 if met else 0, "oduvodneni": ""}
                for name, met in results.items()
            ],
        },
        student_identity={},
        created_at=datetime.datetime.utcnow(),
        is_approved=True,
    )
    db.add(record)
    db.commit()
    return record


async def _summary(db, lecturer, class_id, monkeypatch):
    """Spustí analytiku s force=True a zamockovaným LLM — statistika je deterministická."""
    async def _fake_chat_completion(**kwargs):
        return "### Celkové zhodnocení\nTestovací komentář."

    monkeypatch.setattr(llm_engine, "chat_completion", _fake_chat_completion)
    return await generate_class_summary(
        class_id=class_id, scenario_id=SCENARIO, force=True, db=db, current_user=lecturer
    )


class TestCriteriaMismatch:
    async def test_renamed_criterion_is_reported_not_silently_zero(
        self, db_session, monkeypatch
    ):
        """Kritérium bez jediného spárovaného výsledku se musí ohlásit, ne tvářit jako 0 %."""
        lecturer = _make_lecturer(db_session, email="rozpor@pcr.cz")
        room = _make_class(db_session, lecturer)
        # Výsledky nesou PŮVODNÍ název, kritérium v DB bylo skutečně přeformulováno —
        # nový název není podřetězcem ani nadřetězcem toho původního, takže ho nezachytí
        # ani částečná shoda v matcheru.
        _make_criteria(db_session, lecturer,
                       names=["Ověření totožnosti podle § 63", "Poučení osoby", "Popis zákroku"])
        _add_record(db_session, lecturer=lecturer, class_id=room.id, filename="a.pdf",
                    results={"Ztotožnění osoby": True, "Poučení osoby": True, "Popis zákroku": False})

        payload = await _summary(db_session, lecturer, room.id, monkeypatch)

        assert payload["criteria_mismatch"] is not None
        assert "Ověření totožnosti podle § 63" in payload["criteria_mismatch"]["unmatched_criteria"]
        # Osiřelý výsledek se hlásí zároveň — lektor uvidí obě strany rozporu.
        assert "Ztotožnění osoby" in payload["criteria_mismatch"]["orphan_results"]

    async def test_cosmetic_rename_is_tolerated(self, db_session, monkeypatch):
        """Rozšíření názvu zachytí částečná shoda — varovat kvůli kosmetice by bylo planě.

        Kdyby se hlásil i tenhle případ, lektor by si na varování zvykl a přestal ho číst.
        """
        lecturer = _make_lecturer(db_session, email="kosmetika@pcr.cz")
        room = _make_class(db_session, lecturer)
        _make_criteria(db_session, lecturer,
                       names=["Ztotožnění osoby dle § 63", "Poučení osoby", "Popis zákroku"])
        _add_record(db_session, lecturer=lecturer, class_id=room.id, filename="a.pdf",
                    results={"Ztotožnění osoby": True, "Poučení osoby": True, "Popis zákroku": False})

        payload = await _summary(db_session, lecturer, room.id, monkeypatch)

        assert payload["criteria_mismatch"] is None

    async def test_legitimate_zero_percent_does_not_warn(self, db_session, monkeypatch):
        """Kritérium, které všichni nesplnili, je poctivá nula — varovat se nesmí."""
        lecturer = _make_lecturer(db_session, email="nula@pcr.cz")
        room = _make_class(db_session, lecturer)
        _make_criteria(db_session, lecturer)
        _add_record(db_session, lecturer=lecturer, class_id=room.id, filename="a.pdf",
                    results={"Ztotožnění osoby": True, "Poučení osoby": True, "Popis zákroku": False})

        payload = await _summary(db_session, lecturer, room.id, monkeypatch)

        assert payload["criteria_mismatch"] is None
        popis = next(s for s in payload["stats"] if s["full_name"] == "Popis zákroku")
        assert popis["success_rate"] == 0

    async def test_orphan_result_is_reported(self, db_session, monkeypatch):
        """Výsledek, který nesedí na žádné aktuální kritérium, se nesmí jen tiše zahodit."""
        lecturer = _make_lecturer(db_session, email="sirotek@pcr.cz")
        room = _make_class(db_session, lecturer)
        _make_criteria(db_session, lecturer, names=["Ztotožnění osoby"])
        _add_record(db_session, lecturer=lecturer, class_id=room.id, filename="a.pdf",
                    results={"Ztotožnění osoby": True, "Zrušené kritérium": True})

        payload = await _summary(db_session, lecturer, room.id, monkeypatch)

        assert payload["criteria_mismatch"] is not None
        assert "Zrušené kritérium" in payload["criteria_mismatch"]["orphan_results"]


class TestStatsOrdering:
    async def test_stats_follow_criteria_definition_order(self, db_session, monkeypatch):
        """Pořadí `stats` musí odpovídat pořadí kritérií v sadě — na něm stojí popisky K1…KN."""
        lecturer = _make_lecturer(db_session, email="poradi@pcr.cz")
        room = _make_class(db_session, lecturer)
        _make_criteria(db_session, lecturer)
        _add_record(db_session, lecturer=lecturer, class_id=room.id, filename="a.pdf",
                    results={name: True for name in CRITERIA_NAMES})

        payload = await _summary(db_session, lecturer, room.id, monkeypatch)

        assert [s["full_name"] for s in payload["stats"]] == CRITERIA_NAMES

    async def test_ordering_is_stable_across_calls(self, db_session, monkeypatch):
        lecturer = _make_lecturer(db_session, email="stabilita@pcr.cz")
        room = _make_class(db_session, lecturer)
        _make_criteria(db_session, lecturer)
        _add_record(db_session, lecturer=lecturer, class_id=room.id, filename="a.pdf",
                    results={name: True for name in CRITERIA_NAMES})

        first = await _summary(db_session, lecturer, room.id, monkeypatch)
        second = await _summary(db_session, lecturer, room.id, monkeypatch)

        assert [s["full_name"] for s in first["stats"]] == [s["full_name"] for s in second["stats"]]
