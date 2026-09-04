"""Regresní testy pro auditní stopu lektorského zásahu (ADR-025).

`patch_evaluation_score` dřív provedl `eval_record.json_result = request.json_result`,
tedy úplný přepis tím, co poslal klient. Frontend přitom staví nový objekt jen ze čtyř
klíčů, takže se uložením nenávratně ztratily `max_skore` a `identita`. Frontend pak spadl
na fallback výpočet maxima, který je u kritérií za víc než 1 bod chybný (v3.9.10).

Vedle toho po zásahu člověka nezůstala žádná stopa: původní hodnocení AI bylo pryč,
nebylo zaznamenáno kdo a kdy zasáhl, a schválení nerozlišilo „schvaluji, jak to AI
vygenerovala" od „schvaluji po svých opravách". Man-in-the-Loop je pojistkou jen tehdy,
když je oprava dohledatelná.
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

# Podoba, v jaké hodnocení uloží evaluace — včetně klíčů, které frontend při ukládání
# neposílá zpět (`max_skore`, `identita`).
AI_RESULT = {
    "identita": {"hodnost": "prap.", "jmeno": "Jan", "prijmeni": "Novák"},
    "max_skore": 27,
    "celkove_skore": 2,
    "zpetna_vazba": "Původní zpětná vazba.",
    "vysledky": [
        {"nazev": "K1", "splneno": True, "body": 2, "oduvodneni": "AI: splněno"},
        {"nazev": "K2", "splneno": False, "body": 0, "oduvodneni": "AI: nesplněno"},
    ],
}


def _make_class(db, lecturer):
    room = ClassRoom(name="Základní kurz", lecturer_id=lecturer.id)
    db.add(room)
    db.commit()
    db.refresh(room)
    return room


def _add_record(db, *, lecturer, class_id):
    record = StudentEvaluation(
        lecturer_id=lecturer.id,
        student_name="Novák Jan",
        cleaned_name="Novák Jan",
        class_id=class_id,
        scenario_name=SCENARIO,
        scenario_display_name="MS2",
        json_result=dict(AI_RESULT),
        student_identity={},
        created_at=datetime.datetime.utcnow(),
        is_approved=False,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def _patch(api_client, lecturer, record_id, json_result):
    """Odešle úpravu ve stejném tvaru, jaký posílá frontend — tedy jen čtyři klíče."""
    return api_client.patch(
        f"/api/v1/analytics/evaluation/{record_id}/score",
        json={"json_result": json_result},
        headers=_auth_headers(lecturer),
    )


def _lecturer_edit(*, k1_splneno=False, celkove_skore=99):
    return {
        "jmeno_studenta": "Novák Jan",
        "celkove_skore": celkove_skore,
        "zpetna_vazba": "Upraveno lektorem.",
        "vysledky": [
            {"nazev": "K1", "splneno": k1_splneno, "body": 2 if k1_splneno else 0,
             "oduvodneni": "Lektor: po přezkoumání nesplněno"},
            {"nazev": "K2", "splneno": False, "body": 0, "oduvodneni": "AI: nesplněno"},
        ],
    }


class TestServerOwnedKeysSurvive:
    def test_max_skore_and_identita_are_not_lost(self, db_session, api_client):
        """Klíče, které klient neposlal, musí v hodnocení zůstat."""
        lecturer = _make_lecturer(db_session, email="merge@pcr.cz")
        room = _make_class(db_session, lecturer)
        record = _add_record(db_session, lecturer=lecturer, class_id=room.id)

        res = _patch(api_client, lecturer, record.id, _lecturer_edit())
        assert res.status_code == 200, res.text

        db_session.refresh(record)
        assert record.json_result["max_skore"] == 27
        assert record.json_result["identita"]["prijmeni"] == "Novák"

    def test_lecturer_edits_are_applied(self, db_session, api_client):
        """Sloučení nesmí zahodit to, co lektor skutečně změnil."""
        lecturer = _make_lecturer(db_session, email="apply@pcr.cz")
        room = _make_class(db_session, lecturer)
        record = _add_record(db_session, lecturer=lecturer, class_id=room.id)

        _patch(api_client, lecturer, record.id, _lecturer_edit(k1_splneno=False))

        db_session.refresh(record)
        k1 = next(v for v in record.json_result["vysledky"] if v["nazev"] == "K1")
        assert k1["splneno"] is False
        assert record.json_result["zpetna_vazba"] == "Upraveno lektorem."


class TestAuditTrail:
    def test_original_ai_result_is_preserved(self, db_session, api_client):
        lecturer = _make_lecturer(db_session, email="audit@pcr.cz")
        room = _make_class(db_session, lecturer)
        record = _add_record(db_session, lecturer=lecturer, class_id=room.id)

        _patch(api_client, lecturer, record.id, _lecturer_edit())

        db_session.refresh(record)
        original_k1 = next(v for v in record.ai_original_json["vysledky"] if v["nazev"] == "K1")
        assert original_k1["splneno"] is True, "Původní verdikt AI musí zůstat zachovaný"

    def test_second_edit_does_not_overwrite_the_original(self, db_session, api_client):
        """Stopa musí držet verzi od AI, ne předchozí verzi od lektora."""
        lecturer = _make_lecturer(db_session, email="audit2@pcr.cz")
        room = _make_class(db_session, lecturer)
        record = _add_record(db_session, lecturer=lecturer, class_id=room.id)

        _patch(api_client, lecturer, record.id, _lecturer_edit(k1_splneno=False))
        _patch(api_client, lecturer, record.id, _lecturer_edit(k1_splneno=True))

        db_session.refresh(record)
        original_k1 = next(v for v in record.ai_original_json["vysledky"] if v["nazev"] == "K1")
        assert original_k1["oduvodneni"] == "AI: splněno"

    def test_who_and_when_is_recorded(self, db_session, api_client):
        lecturer = _make_lecturer(db_session, email="kdo@pcr.cz")
        room = _make_class(db_session, lecturer)
        record = _add_record(db_session, lecturer=lecturer, class_id=room.id)

        _patch(api_client, lecturer, record.id, _lecturer_edit())

        db_session.refresh(record)
        assert record.modified_by == lecturer.id
        assert record.modified_at is not None

    def test_changed_criterion_is_flagged(self, db_session, api_client):
        """Do změněného kritéria sáhl člověk — musí to být poznat, u nezměněného ne."""
        lecturer = _make_lecturer(db_session, email="flag@pcr.cz")
        room = _make_class(db_session, lecturer)
        record = _add_record(db_session, lecturer=lecturer, class_id=room.id)

        _patch(api_client, lecturer, record.id, _lecturer_edit(k1_splneno=False))

        db_session.refresh(record)
        by_name = {v["nazev"]: v for v in record.json_result["vysledky"]}
        assert by_name["K1"].get("_lecturer_modified") is True
        assert "_lecturer_modified" not in by_name["K2"]


class TestScoreIsServerAuthoritative:
    def test_score_is_recalculated_not_trusted(self, db_session, api_client):
        """Klient pošle nesmyslné skóre — server ho musí přepočítat z verdiktů."""
        lecturer = _make_lecturer(db_session, email="skore@pcr.cz")
        room = _make_class(db_session, lecturer)
        record = _add_record(db_session, lecturer=lecturer, class_id=room.id)

        _patch(api_client, lecturer, record.id,
               _lecturer_edit(k1_splneno=False, celkove_skore=99))

        db_session.refresh(record)
        # Obě kritéria nesplněná → 0 bodů, bez ohledu na to, co poslal klient.
        assert record.json_result["celkove_skore"] == 0

    def test_score_counts_only_met_criteria(self, db_session, api_client):
        lecturer = _make_lecturer(db_session, email="skore2@pcr.cz")
        room = _make_class(db_session, lecturer)
        record = _add_record(db_session, lecturer=lecturer, class_id=room.id)

        _patch(api_client, lecturer, record.id,
               _lecturer_edit(k1_splneno=True, celkove_skore=0))

        db_session.refresh(record)
        assert record.json_result["celkove_skore"] == 2
