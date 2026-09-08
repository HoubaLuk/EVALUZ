"""Regresní testy pro strom tříd a modelových situací (ADR-031).

Strom dřív žil výhradně v `localStorage` prohlížeče. Modelová situace vytvořená na jednom
počítači tak na jiném vůbec neexistovala — a protože se `scenario_id` generuje na klientovi
(`scen-${Date.now()}`), nešlo ho odnikud zjistit. Kritéria i vyhodnocení přitom v databázi
zůstala; jen se k nim nedalo dostat.

Dva stavy je nutné rozlišovat a testy to hlídají:
  * `classes: null` — lektor na serveru ještě nic nemá, frontend nabídne přenos z prohlížeče,
  * `classes: []`  — lektor si strom vědomě vymazal a nesmí se mu vrátit.
"""
import sys
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from tests.test_class_scoping import api_client, db_session  # noqa: F401  (pytest fixtures)
from tests.test_data_isolation import _auth_headers, _make_lecturer

TREE = [
    {
        "id": "class-1",
        "name": "ZOP I.",
        "expanded": True,
        "scenarios": [
            {"id": "scen-1777446275491", "name": "Vstup do obydlí"},
            {"id": "scen-1777442226092", "name": "Omezení osobní svobody"},
        ],
    }
]


def _get(api_client, lecturer):
    return api_client.get("/api/v1/workspace", headers=_auth_headers(lecturer))


def _put(api_client, lecturer, classes):
    return api_client.put(
        "/api/v1/workspace", json={"classes": classes}, headers=_auth_headers(lecturer)
    )


class TestWorkspacePersistence:
    def test_empty_workspace_is_null_not_empty_list(self, db_session, api_client):
        """Rozlišení „nic neuloženo" od „vědomě prázdné" — na něm stojí přenos z prohlížeče."""
        lecturer = _make_lecturer(db_session, email="novy@pcr.cz")

        res = _get(api_client, lecturer)

        assert res.status_code == 200, res.text
        assert res.json()["classes"] is None

    def test_tree_survives_and_is_returned(self, db_session, api_client):
        """Jádro opravy: co uložím z jednoho počítače, musím dostat i odjinud."""
        lecturer = _make_lecturer(db_session, email="strom@pcr.cz")

        assert _put(api_client, lecturer, TREE).status_code == 200
        payload = _get(api_client, lecturer).json()

        assert payload["classes"][0]["name"] == "ZOP I."
        scen_ids = [s["id"] for s in payload["classes"][0]["scenarios"]]
        assert "scen-1777446275491" in scen_ids
        assert payload["updated_at"] is not None

    def test_saving_twice_updates_not_duplicates(self, db_session, api_client):
        lecturer = _make_lecturer(db_session, email="dvakrat@pcr.cz")

        _put(api_client, lecturer, TREE)
        _put(api_client, lecturer, [{"id": "class-2", "name": "ZOP II.", "scenarios": []}])

        classes = _get(api_client, lecturer).json()["classes"]
        assert len(classes) == 1
        assert classes[0]["name"] == "ZOP II."

    def test_deliberately_empty_tree_stays_empty(self, db_session, api_client):
        """Vymazaný strom se nesmí tvářit jako „nic neuloženo" a vrátit se z cache."""
        lecturer = _make_lecturer(db_session, email="prazdny@pcr.cz")

        _put(api_client, lecturer, TREE)
        _put(api_client, lecturer, [])

        assert _get(api_client, lecturer).json()["classes"] == []


class TestWorkspaceIsolation:
    def test_lecturers_do_not_see_each_other(self, db_session, api_client):
        """Strom je osobní pracovní plocha — cizí se nesmí objevit ani omylem."""
        a = _make_lecturer(db_session, email="a@pcr.cz")
        b = _make_lecturer(db_session, email="b@pcr.cz")

        _put(api_client, a, TREE)

        assert _get(api_client, b).json()["classes"] is None

    def test_save_does_not_overwrite_another_lecturer(self, db_session, api_client):
        a = _make_lecturer(db_session, email="a2@pcr.cz")
        b = _make_lecturer(db_session, email="b2@pcr.cz")

        _put(api_client, a, TREE)
        _put(api_client, b, [{"id": "class-b", "name": "Jiná třída", "scenarios": []}])

        assert _get(api_client, a).json()["classes"][0]["name"] == "ZOP I."

    def test_requires_authentication(self, db_session, api_client):
        assert api_client.get("/api/v1/workspace").status_code == 401


class TestWorkspaceLimits:
    def test_absurd_tree_is_rejected(self, db_session, api_client):
        lecturer = _make_lecturer(db_session, email="limit2@pcr.cz")
        huge = [{"id": f"c{i}", "name": f"T{i}", "scenarios": []} for i in range(201)]

        assert _put(api_client, lecturer, huge).status_code == 400

    def test_scenario_without_name_is_accepted(self, db_session, api_client):
        """Situace pojmenovaná až později nesmí uložení shodit."""
        lecturer = _make_lecturer(db_session, email="beznazvu@pcr.cz")

        res = _put(api_client, lecturer, [
            {"id": "class-x", "name": "T", "scenarios": [{"id": "scen-x"}]}
        ])

        assert res.status_code == 200, res.text
        assert _get(api_client, lecturer).json()["classes"][0]["scenarios"][0]["name"] == ""
