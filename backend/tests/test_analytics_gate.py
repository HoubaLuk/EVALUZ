"""Regresní testy pro bránu třídní analytiky (Man-in-the-Loop, ADR-023).

Analýza celé skupiny smí vzniknout jedině z ÚPLNÉ a schválené sady. Blokovat je nutné
ze dvou důvodů:
  a) existují vyhodnocené, ale neschválené záznamy (platilo už dřív),
  b) pod scénářem leží záznam, který ještě NENÍ vyhodnocený.

Bod (b) dřív chyběl — nevyhodnocené záznamy se tiše přeskočily a analytika se spočítala
jen z části skupiny, přestože tvrdila, že popisuje celou modelovou situaci. V provozu
k tomu stačilo, aby jeden ÚZ z dávky čekal ve frontě na volný slot souběžnosti.
"""
import datetime
import sys
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from models.db_models import ClassRoom, StudentEvaluation

from tests.test_class_scoping import api_client, db_session  # noqa: F401  (pytest fixtures)
from tests.test_data_isolation import _auth_headers, _make_lecturer

SCENARIO = "scen-2"


def _make_class(db, lecturer):
    room = ClassRoom(name="Základní kurz", lecturer_id=lecturer.id)
    db.add(room)
    db.commit()
    db.refresh(room)
    return room


def _add_record(db, *, lecturer, class_id, filename, evaluated=True, approved=True):
    """Založí záznam ÚZ. `evaluated=False` simuluje stav po fast-scanu / čekání ve frontě."""
    record = StudentEvaluation(
        lecturer_id=lecturer.id,
        student_name=filename,
        cleaned_name=filename,
        class_id=class_id,
        scenario_name=SCENARIO,
        scenario_display_name="MS2",
        json_result={"celkove_skore": 10, "vysledky": [{"nazev": "K1", "splneno": True}]} if evaluated else {},
        student_identity={},
        created_at=datetime.datetime.utcnow(),
        is_approved=approved if evaluated else False,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def _summary(api_client, lecturer, class_id):
    res = api_client.get(
        f"/api/v1/analytics/class/{class_id}/summary?scenario_id={SCENARIO}",
        headers=_auth_headers(lecturer),
    )
    assert res.status_code == 200, res.text
    return res.json()


class TestAnalyticsGate:
    def test_unevaluated_record_blocks_analytics(self, db_session, api_client):
        """Jediný nevyhodnocený ÚZ musí analytiku zablokovat, i když jsou ostatní schválené."""
        lecturer = _make_lecturer(db_session, email="brana1@pcr.cz")
        room = _make_class(db_session, lecturer)
        _add_record(db_session, lecturer=lecturer, class_id=room.id, filename="a.pdf")
        _add_record(db_session, lecturer=lecturer, class_id=room.id, filename="b.pdf")
        # Pátý ÚZ z dávky, který ještě čeká ve frontě.
        _add_record(db_session, lecturer=lecturer, class_id=room.id, filename="c.pdf", evaluated=False)

        payload = _summary(api_client, lecturer, room.id)

        assert payload["error"] == "pending_approvals"
        assert payload["unevaluated_count"] == 1
        assert payload["pending_count"] == 0
        assert payload["total_records"] == 3
        assert payload["total_evaluated"] == 2

    def test_unapproved_record_still_blocks_analytics(self, db_session, api_client):
        """Původní chování zůstává — neschválený záznam blokuje dál."""
        lecturer = _make_lecturer(db_session, email="brana2@pcr.cz")
        room = _make_class(db_session, lecturer)
        _add_record(db_session, lecturer=lecturer, class_id=room.id, filename="a.pdf")
        _add_record(db_session, lecturer=lecturer, class_id=room.id, filename="b.pdf", approved=False)

        payload = _summary(api_client, lecturer, room.id)

        assert payload["error"] == "pending_approvals"
        assert payload["pending_count"] == 1
        assert payload["unevaluated_count"] == 0

    def test_complete_and_approved_set_passes_gate(self, db_session, api_client):
        """Úplná a schválená sada projde — bez cache vrátí prázdný stav, ne chybu."""
        lecturer = _make_lecturer(db_session, email="brana3@pcr.cz")
        room = _make_class(db_session, lecturer)
        _add_record(db_session, lecturer=lecturer, class_id=room.id, filename="a.pdf")
        _add_record(db_session, lecturer=lecturer, class_id=room.id, filename="b.pdf")

        payload = _summary(api_client, lecturer, room.id)

        assert "error" not in payload
        assert payload["status"] == "no_analysis"

    def test_legacy_string_json_result_does_not_crash_gate(self, db_session, api_client):
        """Starší záznam s json_result jako STRING nesmí shodit celou analytiku.

        `.get()` na stringu by vyhodil AttributeError → HTTP 500. Takový záznam se
        počítá jako nevyhodnocený, což bránu korektně zablokuje.
        """
        lecturer = _make_lecturer(db_session, email="brana4@pcr.cz")
        room = _make_class(db_session, lecturer)
        legacy = _add_record(db_session, lecturer=lecturer, class_id=room.id, filename="legacy.pdf")
        legacy.json_result = '{"vysledky": []}'  # TEXT sloupec před migrací na JSONB
        db_session.commit()

        payload = _summary(api_client, lecturer, room.id)

        assert payload["error"] == "pending_approvals"
        assert payload["unevaluated_count"] == 1
