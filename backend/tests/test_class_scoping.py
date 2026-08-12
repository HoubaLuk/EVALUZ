"""Regresní testy pro rozsah třídy (class scoping).

Frontend měl `/analytics/class/1` natvrdo na devíti místech, jenže `ClassRoom` se
zakládá ZVLÁŠŤ pro každého lektora (auto-increment ID). Vyhodnocení se proto ukládala
pod ID třídy toho kterého lektora, ale UI se vždy ptalo na jedničku — data tak v UI
viděl jedině ten, jehož třída měla shodou okolností ID 1. Ostatním backend korektně
vrátil prázdné pole a jejich kompletně vyhodnocené ÚZ zůstaly jako „Nezpracováno",
bez skóre a bez tlačítka pro schválení, přestože v DB byly v pořádku.

Oprava: frontend si ID své třídy vyžádá přes `POST /evaluate/classes/ensure`
(`src/utils/api.ts::getClassId`). Tyhle testy zamykají kontrakt, na který se spoléhá.

Fixtures a helpery jsou převzaté z `test_data_isolation.py` (izolovaná in-memory SQLite
+ TestClient bez lifespan).
"""
import sys
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from core.database import get_db
from models.db_models import Base, ClassRoom

# Helpery pro testovací data se sdílí s test_data_isolation.py; fixtures ne — potřebujeme
# vlastní engine se StaticPool (viz komentář u db_session níže).
from tests.test_data_isolation import _auth_headers, _make_evaluation, _make_lecturer


@pytest.fixture()
def db_session():
    """Izolovaná in-memory SQLite se StaticPool.

    StaticPool je tu nutný: `sqlite:///:memory:` dává KAŽDÉMU spojení vlastní prázdnou
    databázi a TestClient obsluhuje requesty v jiném vlákně než test. Bez něj by aplikace
    v request threadu sáhla do prázdné DB a spadla na „no such table". StaticPool drží
    jedno sdílené spojení pro všechna vlákna.
    """
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()
    engine.dispose()


@pytest.fixture()
def api_client(db_session):
    """TestClient napojený na izolovanou DB, bez spouštění lifespan.

    Override se registruje přímo na `main.app` (singleton) — viz podrobná poznámka
    v tests/test_data_isolation.py.
    """
    import main as app_module

    def override_get_db():
        yield db_session

    app_module.app.dependency_overrides[get_db] = override_get_db
    try:
        yield TestClient(app_module.app)
    finally:
        app_module.app.dependency_overrides.pop(get_db, None)

# Musí odpovídat defaultu `class_name` ve fast-scan endpointu (backend/api/evaluate.py)
# i konstantě DEFAULT_CLASS_NAME v src/utils/api.ts.
DEFAULT_CLASS_NAME = "Základní kurz"


def _ensure_class(api_client, lecturer, name=DEFAULT_CLASS_NAME):
    res = api_client.post(
        "/api/v1/evaluate/classes/ensure",
        json={"name": name},
        headers=_auth_headers(lecturer),
    )
    assert res.status_code == 200, res.text
    return res.json()


class TestEnsureClassContract:
    def test_each_lecturer_gets_their_own_class(self, db_session, api_client):
        """Dva lektoři = dvě různé třídy. Právě proto nesmí být ID ve frontendu natvrdo."""
        first = _make_lecturer(db_session, email="prvni@pcr.cz")
        second = _make_lecturer(db_session, email="druhy@pcr.cz")

        first_class = _ensure_class(api_client, first)
        second_class = _ensure_class(api_client, second)

        assert first_class["id"] != second_class["id"]
        assert first_class["name"] == second_class["name"] == DEFAULT_CLASS_NAME

    def test_ensure_is_idempotent(self, db_session, api_client):
        """Opakované volání nesmí zakládat další třídy — frontend ho volá při každém načtení."""
        lecturer = _make_lecturer(db_session, email="opakovane@pcr.cz")

        first_call = _ensure_class(api_client, lecturer)
        second_call = _ensure_class(api_client, lecturer)

        assert first_call["id"] == second_call["id"]
        assert db_session.query(ClassRoom).filter(ClassRoom.lecturer_id == lecturer.id).count() == 1

    def test_ensure_returns_class_used_by_fast_scan(self, db_session, api_client):
        """KLÍČOVÝ KONTRAKT: `ensure` musí vrátit TU TŘÍDU, do které zapisuje fast-scan.

        Kdyby vrátil jinou (nebo založil duplicitní), frontend by se ptal na prázdnou
        třídu a původní chyba by se vrátila jen v jiném hávu.
        """
        lecturer = _make_lecturer(db_session, email="fastscan@pcr.cz")
        # Přesně to, co dělá fast_scan_batch při prvním nahrání souborů.
        existing = ClassRoom(name=DEFAULT_CLASS_NAME, lecturer_id=lecturer.id)
        db_session.add(existing)
        db_session.commit()
        db_session.refresh(existing)

        resolved = _ensure_class(api_client, lecturer)

        assert resolved["id"] == existing.id
        assert db_session.query(ClassRoom).filter(ClassRoom.lecturer_id == lecturer.id).count() == 1

    def test_ensure_does_not_return_another_lecturers_class(self, db_session, api_client):
        """Stejný název třídy u jiného lektora nesmí být sdílený."""
        owner = _make_lecturer(db_session, email="vlastnik@pcr.cz")
        other = _make_lecturer(db_session, email="cizi@pcr.cz")
        owners_class = ClassRoom(name=DEFAULT_CLASS_NAME, lecturer_id=owner.id)
        db_session.add(owners_class)
        db_session.commit()
        db_session.refresh(owners_class)

        resolved = _ensure_class(api_client, other)

        assert resolved["id"] != owners_class.id


class TestClassScopedVisibility:
    def test_evaluation_is_visible_under_resolved_class_id(self, db_session, api_client):
        """Reprodukce nahlášené chyby: pod natvrdo zadanou 1 nevidí lektor nic,
        pod ID vrácenou z `classes/ensure` vidí svoje vyhodnocení."""
        # Cizí lektor obsadí ClassRoom s ID 1 — přesně jak k tomu došlo v provozu.
        squatter = _make_lecturer(db_session, email="prvni.v.rade@pcr.cz")
        db_session.add(ClassRoom(name=DEFAULT_CLASS_NAME, lecturer_id=squatter.id))
        db_session.commit()

        lecturer = _make_lecturer(db_session, email="zverina@pcr.cz", is_superadmin=True)
        own_class = _ensure_class(api_client, lecturer)
        assert own_class["id"] != 1, "předpoklad testu: vlastní třída nemá ID 1"

        _make_evaluation(
            db_session,
            lecturer_id=lecturer.id,
            class_id=own_class["id"],
            scenario_name="scen-2",
            student_name="Malíková - ÚZ VTOS.pdf",
        )

        headers = _auth_headers(lecturer)

        # Původní chování frontendu — prázdno, i když je záznam v DB kompletní.
        hardcoded = api_client.get("/api/v1/analytics/class/1?scenario_id=scen-2", headers=headers)
        assert hardcoded.status_code == 200
        assert hardcoded.json() == []

        # Po opravě se frontend ptá na tohle a záznam dostane.
        resolved = api_client.get(
            f"/api/v1/analytics/class/{own_class['id']}?scenario_id=scen-2", headers=headers
        )
        assert resolved.status_code == 200
        payload = resolved.json()
        assert len(payload) == 1
        assert payload[0]["jmeno_studenta"] == "Malíková - ÚZ VTOS.pdf"
        # Pole, na kterém ve frontendu závisí odznak stavu i schvalovací tlačítko.
        assert "is_approved" in payload[0]

    def test_resolved_class_still_isolates_between_lecturers(self, db_session, api_client):
        """Oprava nesmí prolomit izolaci dat — cizí třída zůstává prázdná (ADR-014)."""
        owner = _make_lecturer(db_session, email="majitel@pcr.cz")
        owner_class = _ensure_class(api_client, owner)
        _make_evaluation(
            db_session,
            lecturer_id=owner.id,
            class_id=owner_class["id"],
            scenario_name="scen-2",
            student_name="Cizi.pdf",
        )

        intruder = _make_lecturer(db_session, email="vetrelec@pcr.cz", is_superadmin=True)
        res = api_client.get(
            f"/api/v1/analytics/class/{owner_class['id']}?scenario_id=scen-2",
            headers=_auth_headers(intruder),
        )

        assert res.status_code == 200
        assert res.json() == []
