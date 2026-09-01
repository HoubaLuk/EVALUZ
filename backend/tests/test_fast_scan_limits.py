"""Regresní testy pro limity fast-scanu (ADR-024).

Soubor přes `MAX_UPLOAD_SIZE` backend při fast-scanu přeskočil a vrátil jen `results`
bez jakékoli zmínky — student z odpovědi beze stopy zmizel. Ve frontendu přitom
zůstal optimisticky vykreslený řádek, takže to vypadalo, že se nahrání povedlo,
a teprve vyhodnocení pak zhavarovalo.

Cesta přes limit velikosti se vrací dřív, než dojde na volání LLM, takže tyto testy
nepotřebují žádný mock modelu.
"""
import io
import sys
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from api.evaluate import MAX_UPLOAD_SIZE

from tests.test_class_scoping import api_client, db_session  # noqa: F401  (pytest fixtures)
from tests.test_data_isolation import _auth_headers, _make_lecturer


def _upload(api_client, lecturer, *, filename: str, size: int):
    return api_client.post(
        "/api/v1/evaluate/fast-scan",
        files=[("files", (filename, io.BytesIO(b"x" * size), "application/pdf"))],
        data={"scenario_id": "scen-2", "scenario_display_name": "MS2"},
        headers=_auth_headers(lecturer),
    )


class TestFastScanSizeLimit:
    def test_oversized_file_is_reported_not_silently_dropped(self, db_session, api_client):
        """Soubor nad limit se musí objevit v `skipped`, ne jen zmizet z `results`."""
        lecturer = _make_lecturer(db_session, email="limit@pcr.cz")

        res = _upload(api_client, lecturer, filename="obri.pdf", size=MAX_UPLOAD_SIZE + 1024)

        assert res.status_code == 200, res.text
        payload = res.json()
        assert payload["results"] == []
        assert payload["skipped"] == ["obri.pdf"]

    def test_response_always_carries_skipped_field(self, db_session, api_client):
        """Klíč `skipped` musí být v odpovědi vždy — frontend na něj spoléhá."""
        lecturer = _make_lecturer(db_session, email="tvar@pcr.cz")

        res = _upload(api_client, lecturer, filename="velky.pdf", size=MAX_UPLOAD_SIZE + 1)

        assert "skipped" in res.json()

    def test_limit_matches_frontend_constant(self):
        """MAX_UPLOAD_SIZE musí odpovídat MAX_FILE_BYTES v src/utils/api.ts.

        Kdyby se rozešly, frontend by pustil na server soubor, který backend zahodí —
        přesně ten tichý propad, který tenhle modul hlídá.
        """
        api_ts = (_BACKEND_ROOT.parent / "src" / "utils" / "api.ts").read_text(encoding="utf-8")
        assert "export const MAX_FILE_BYTES = 10 * 1024 * 1024;" in api_ts
        assert MAX_UPLOAD_SIZE == 10 * 1024 * 1024
