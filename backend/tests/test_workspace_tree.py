"""Regresní testy pro strom tříd a modelových situací (ADR-033).

Situace je řádek v databázi patřící konkrétnímu lektorovi; strom se z těch řádků odvozuje.
Dřív to bylo obráceně — `scenario_id` vzniklo na klientovi a jediným záznamem o existenci
situace byl strom v prohlížeči (ADR-031 ho přesunulo na server, ale závislost neodstranilo).
Důsledky, které tyhle testy zamykají, aby se nevrátily:

* strom uživatele A se vytlačil do serverového záznamu uživatele B (sdílený prohlížeč,
  odhlášení mazalo jen token),
* smazání situace z prohlížeče nechalo vyhodnocení v DB bez cesty, jak se k nim dostat.
"""
import datetime
import importlib.util
import sys
from pathlib import Path

import pytest

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from models.db_models import (
    ClassRoom, EvaluationCriteria, Scenario, StudentEvaluation, StudyGroup,
)

from tests.test_class_scoping import api_client, db_session  # noqa: F401  (pytest fixtures)
from tests.test_data_isolation import _auth_headers, _make_lecturer


def _load_migration():
    """Načte migrační modul podle cesty — v `alembic/versions` není balíček."""
    cesta = _BACKEND_ROOT / "alembic" / "versions" / "e9f0a1b2c3d4_scenarios_as_data.py"
    spec = importlib.util.spec_from_file_location("migrace_scenarios", cesta)
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    return modul


# ── Helpery ───────────────────────────────────────────────────────────────────

def _group(api_client, lecturer, name="ZOP 2026"):
    res = api_client.post("/api/v1/workspace/groups", json={"name": name},
                          headers=_auth_headers(lecturer))
    assert res.status_code == 201, res.text
    return res.json()


def _scenario(api_client, lecturer, group_id, name="Vstup do obydlí"):
    res = api_client.post("/api/v1/workspace/scenarios",
                          json={"group_id": group_id, "name": name},
                          headers=_auth_headers(lecturer))
    assert res.status_code == 201, res.text
    return res.json()


def _tree(api_client, lecturer):
    res = api_client.get("/api/v1/workspace", headers=_auth_headers(lecturer))
    assert res.status_code == 200, res.text
    return res.json()


def _add_evaluation(db, lecturer, scenario_key, filename="a.pdf"):
    room = db.query(ClassRoom).filter(ClassRoom.lecturer_id == lecturer.id).first()
    if not room:
        room = ClassRoom(name="Základní kurz", lecturer_id=lecturer.id)
        db.add(room)
        db.commit()
        db.refresh(room)
    row = StudentEvaluation(
        lecturer_id=lecturer.id, student_name=filename, cleaned_name=filename,
        class_id=room.id, scenario_name=scenario_key, scenario_display_name="MS",
        json_result={"celkove_skore": 1, "vysledky": [{"nazev": "K1", "splneno": True}]},
        student_identity={}, created_at=datetime.datetime.utcnow(), is_approved=True,
    )
    db.add(row)
    db.commit()
    return row


# ── Klíče generuje server ─────────────────────────────────────────────────────

class TestServerGeneratedKeys:
    def test_key_is_generated_and_unique(self, db_session, api_client):
        lecturer = _make_lecturer(db_session, email="klice@pcr.cz")
        g = _group(api_client, lecturer)

        klice = {_scenario(api_client, lecturer, g["id"], f"MS{i}")["key"] for i in range(5)}

        assert len(klice) == 5
        assert all(k.startswith("scen-") for k in klice)

    def test_client_cannot_dictate_the_key(self, db_session, api_client):
        """Kolize mezi počítači nesmí jít vyvolat ani úmyslně."""
        lecturer = _make_lecturer(db_session, email="podvod@pcr.cz")
        g = _group(api_client, lecturer)

        res = api_client.post(
            "/api/v1/workspace/scenarios",
            json={"group_id": g["id"], "name": "MS", "key": "scen-1777446275491"},
            headers=_auth_headers(lecturer),
        )

        assert res.status_code == 201, res.text
        assert res.json()["key"] != "scen-1777446275491"


# ── Izolace mezi lektory ──────────────────────────────────────────────────────

class TestIsolation:
    def test_tree_is_personal(self, db_session, api_client):
        a = _make_lecturer(db_session, email="a@pcr.cz")
        b = _make_lecturer(db_session, email="b@pcr.cz")
        _scenario(api_client, a, _group(api_client, a)["id"])

        assert _tree(api_client, b)["groups"] == []

    def test_cannot_touch_foreign_group(self, db_session, api_client):
        a = _make_lecturer(db_session, email="a2@pcr.cz")
        b = _make_lecturer(db_session, email="b2@pcr.cz")
        g = _group(api_client, a)

        h = _auth_headers(b)
        assert api_client.patch(f"/api/v1/workspace/groups/{g['id']}",
                                json={"name": "Ukradeno"}, headers=h).status_code == 404
        assert api_client.delete(f"/api/v1/workspace/groups/{g['id']}",
                                 headers=h).status_code == 404

    def test_cannot_add_scenario_into_foreign_group(self, db_session, api_client):
        a = _make_lecturer(db_session, email="a3@pcr.cz")
        b = _make_lecturer(db_session, email="b3@pcr.cz")
        g = _group(api_client, a)

        res = api_client.post("/api/v1/workspace/scenarios",
                              json={"group_id": g["id"], "name": "Cizí"},
                              headers=_auth_headers(b))

        assert res.status_code == 404

    def test_identical_names_do_not_collide(self, db_session, api_client):
        """Dva lektoři smí mít třídu i situaci stejného jména — jsou to jiná data."""
        a = _make_lecturer(db_session, email="a4@pcr.cz")
        b = _make_lecturer(db_session, email="b4@pcr.cz")

        ka = _scenario(api_client, a, _group(api_client, a, "ZOP I.")["id"], "Vstup")["key"]
        kb = _scenario(api_client, b, _group(api_client, b, "ZOP I.")["id"], "Vstup")["key"]

        assert ka != kb
        assert len(_tree(api_client, a)["groups"]) == 1
        assert len(_tree(api_client, b)["groups"]) == 1


# ── Situace nemůže osiřet ─────────────────────────────────────────────────────

class TestNoOrphans:
    def test_created_scenario_appears_in_tree(self, db_session, api_client):
        lecturer = _make_lecturer(db_session, email="strom@pcr.cz")
        g = _group(api_client, lecturer)
        s = _scenario(api_client, lecturer, g["id"], "Vstup do obydlí")

        strom = _tree(api_client, lecturer)

        assert strom["groups"][0]["scenarios"][0]["key"] == s["key"]

    def test_delete_with_data_is_refused_and_changes_nothing(self, db_session, api_client):
        """Bez `force` se nesmí smazat nic — a lektor se dozví, o kolik záznamů jde."""
        lecturer = _make_lecturer(db_session, email="odmitnuti@pcr.cz")
        s = _scenario(api_client, lecturer, _group(api_client, lecturer)["id"])
        _add_evaluation(db_session, lecturer, s["key"], "a.pdf")
        _add_evaluation(db_session, lecturer, s["key"], "b.pdf")

        res = api_client.delete(f"/api/v1/workspace/scenarios/{s['id']}",
                                headers=_auth_headers(lecturer))

        assert res.status_code == 409
        assert res.json()["detail"]["evaluations"] == 2
        assert db_session.query(Scenario).count() == 1
        assert db_session.query(StudentEvaluation).count() == 2

    def test_force_delete_removes_scenario_and_its_data(self, db_session, api_client):
        lecturer = _make_lecturer(db_session, email="force@pcr.cz")
        s = _scenario(api_client, lecturer, _group(api_client, lecturer)["id"])
        _add_evaluation(db_session, lecturer, s["key"])
        db_session.add(EvaluationCriteria(
            scenario_name=s["key"], lecturer_id=lecturer.id, markdown_content="…"))
        db_session.commit()

        res = api_client.delete(f"/api/v1/workspace/scenarios/{s['id']}?force=true",
                                headers=_auth_headers(lecturer))

        assert res.status_code == 200, res.text
        assert db_session.query(Scenario).count() == 0
        assert db_session.query(StudentEvaluation).filter(
            StudentEvaluation.scenario_name == s["key"]).count() == 0
        assert db_session.query(EvaluationCriteria).filter(
            EvaluationCriteria.scenario_name == s["key"]).count() == 0

    def test_empty_scenario_deletes_without_force(self, db_session, api_client):
        lecturer = _make_lecturer(db_session, email="prazdna@pcr.cz")
        s = _scenario(api_client, lecturer, _group(api_client, lecturer)["id"])

        res = api_client.delete(f"/api/v1/workspace/scenarios/{s['id']}",
                                headers=_auth_headers(lecturer))

        assert res.status_code == 200, res.text
        assert db_session.query(Scenario).count() == 0

    def test_group_delete_counts_all_scenarios_beneath(self, db_session, api_client):
        lecturer = _make_lecturer(db_session, email="trida@pcr.cz")
        g = _group(api_client, lecturer)
        s1 = _scenario(api_client, lecturer, g["id"], "MS1")
        s2 = _scenario(api_client, lecturer, g["id"], "MS2")
        _add_evaluation(db_session, lecturer, s1["key"], "a.pdf")
        _add_evaluation(db_session, lecturer, s2["key"], "b.pdf")

        res = api_client.delete(f"/api/v1/workspace/groups/{g['id']}",
                                headers=_auth_headers(lecturer))

        assert res.status_code == 409
        assert res.json()["detail"] == {"error": "has_evaluations", "scenarios": 2,
                                        "evaluations": 2}

    def test_group_force_delete_cleans_everything(self, db_session, api_client):
        lecturer = _make_lecturer(db_session, email="trida2@pcr.cz")
        g = _group(api_client, lecturer)
        s = _scenario(api_client, lecturer, g["id"])
        _add_evaluation(db_session, lecturer, s["key"])

        res = api_client.delete(f"/api/v1/workspace/groups/{g['id']}?force=true",
                                headers=_auth_headers(lecturer))

        assert res.status_code == 200, res.text
        assert db_session.query(StudyGroup).count() == 0
        assert db_session.query(Scenario).count() == 0
        assert db_session.query(StudentEvaluation).count() == 0

    def test_force_delete_never_touches_another_lecturer(self, db_session, api_client):
        """Shodný klíč u jiného lektora nemůže vzniknout, ale mazání to musí ustát i tak."""
        a = _make_lecturer(db_session, email="a5@pcr.cz")
        b = _make_lecturer(db_session, email="b5@pcr.cz")
        sa = _scenario(api_client, a, _group(api_client, a)["id"])
        _add_evaluation(db_session, a, sa["key"])
        _add_evaluation(db_session, b, sa["key"], "cizi.pdf")  # ručně, obchází API

        api_client.delete(f"/api/v1/workspace/scenarios/{sa['id']}?force=true",
                          headers=_auth_headers(a))

        zbyle = db_session.query(StudentEvaluation).all()
        assert [e.lecturer_id for e in zbyle] == [b.id]


# ── Backfill = náprava promíchaných účtů ──────────────────────────────────────

class TestBackfill:
    def test_each_lecturer_gets_only_their_own(self, db_session, api_client):
        """Přímý test na chybu, kvůli které to celé vzniklo.

        Strom se skládá z `student_evaluations` a `evaluation_criteria`, které jsou podle
        `lecturer_id` vedené správně — výsledek je proto z definice neprosáklý.
        """
        a = _make_lecturer(db_session, email="bf-a@pcr.cz")
        b = _make_lecturer(db_session, email="bf-b@pcr.cz")
        _add_evaluation(db_session, a, "scen-aaa", "a1.pdf")
        _add_evaluation(db_session, a, "scen-bbb", "a2.pdf")
        _add_evaluation(db_session, b, "scen-ccc", "b1.pdf")
        db_session.query(StudyGroup).delete()
        db_session.query(Scenario).delete()
        db_session.commit()

        _load_migration()._backfill(db_session.connection())
        db_session.commit()

        klice_a = {s["key"] for g in _tree(api_client, a)["groups"] for s in g["scenarios"]}
        klice_b = {s["key"] for g in _tree(api_client, b)["groups"] for s in g["scenarios"]}

        assert klice_a == {"scen-aaa", "scen-bbb"}
        assert klice_b == {"scen-ccc"}

    def test_criteria_without_evaluations_are_included(self, db_session, api_client):
        """Situace, kde lektor zatím jen uložil kritéria, se nesmí ztratit."""
        lecturer = _make_lecturer(db_session, email="bf-krit@pcr.cz")
        db_session.add(EvaluationCriteria(
            scenario_name="scen-jen-kriteria", lecturer_id=lecturer.id, markdown_content="…"))
        db_session.commit()

        _load_migration()._backfill(db_session.connection())
        db_session.commit()

        klice = {s["key"] for g in _tree(api_client, lecturer)["groups"] for s in g["scenarios"]}
        assert klice == {"scen-jen-kriteria"}

    def test_lecturer_without_data_gets_empty_tree(self, db_session, api_client):
        lecturer = _make_lecturer(db_session, email="bf-prazdny@pcr.cz")

        _load_migration()._backfill(db_session.connection())
        db_session.commit()

        assert _tree(api_client, lecturer)["groups"] == []


class TestAuth:
    def test_requires_authentication(self, db_session, api_client):
        assert api_client.get("/api/v1/workspace").status_code == 401
        assert api_client.post("/api/v1/workspace/groups", json={"name": "X"}).status_code == 401
