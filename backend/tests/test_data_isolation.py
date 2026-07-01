"""
FÁZE RED (Test-Driven Vibecoding) — RBAC Data Isolation.

Tyto testy exaktně replikují bezpečnostní incident zdokumentovaný forenzním auditem:
`apply_data_isolation()` (backend/api/auth.py) dnes odvozuje rozsah viditelnosti dat
implicitně z role uživatele (is_admin / is_superadmin) i na endpointech, které slouží
jako OSOBNÍ pracovní plocha lektora — což způsobuje prosáknutí dat mezi lektory.

Architektonická náprava (parametr `scope: DataScope`, výchozí PERSONAL) je popsána
v PLAN.md a NENÍ součástí této fáze — v této fázi pouze dokládáme, že bez ní jsou
testy níže neprůchozí.

DŮLEŽITÉ: Tento soubor je záměrně nezávislý na `tests/integration/conftest.py`
(vlastní DB/TestClient fixtures), aby úprava nezasahovala do existující sdílené
test infrastruktury a nebyla interpretována jako zásah do implementačního kódu.
"""

import sys
import datetime
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from models.db_models import Base, Lecturer, StudentEvaluation
from core.database import get_db
from core.security import get_password_hash, create_access_token


# ─────────────────────────────────────────────────────────────────────────────
# Lokální fixtures (izolovaná in-memory SQLite + FastAPI TestClient bez lifespan)
#
# POZNÁMKA K IMPLEMENTACI FIXTURE (debugging note, ne produkční kód):
# FastAPI/Starlette zapouzdřuje `dependency_overrides_provider` do každé APIRoute
# JIŽ PŘI JEJÍM VYTVOŘENÍ (APIRoute.__init__ → self.app = request_response(...)),
# a to natrvalo na instanci FastAPI aplikace, která routu registrovala přes
# `include_router()`. Pouhé zkopírování route objektů do nové "prázdné" FastAPI()
# instance (vzor použitý v tests/integration/conftest.py) proto override
# `get_db` NEAPLIKUJE — request potichu spadne na PRAVOU (produkční/dev)
# databázi nakonfigurovanou v `core.database`, protože zkopírované routy stále
# odkazují na `dependency_overrides` původní `main.app` instance.
#
# Bezpečné řešení: override registrovat přímo na `main.app` (singleton) a
# `TestClient` použít BEZ `with` bloku — Starlette spouští `lifespan`
# (a tedy `init_db()`/`seed_database()` do reálného souboru) výhradně přes
# `__enter__`/`__exit__` context manager, takže i bez něj klient normálně
# obsluhuje požadavky. Override se po testu vždy uklidí (fixture teardown),
# aby neunikl do dalších test modulů sdílejících stejný `main` singleton.
# ─────────────────────────────────────────────────────────────────────────────

@pytest.fixture()
def db_session():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()
    engine.dispose()


@pytest.fixture()
def api_client(db_session):
    """TestClient napojený na izolovanou in-memory DB, bez spouštění lifespan."""
    import main as app_module

    def override_get_db():
        yield db_session

    app_module.app.dependency_overrides[get_db] = override_get_db
    try:
        # Záměrně BEZ `with` — nespouští lifespan (init_db/seed do reálného souboru),
        # ale požadavky obsluhuje normálně (viz poznámka výše).
        yield TestClient(app_module.app)
    finally:
        app_module.app.dependency_overrides.pop(get_db, None)


# ─────────────────────────────────────────────────────────────────────────────
# Test data helpers
# ─────────────────────────────────────────────────────────────────────────────

def _make_lecturer(db, *, email, is_admin=False, is_superadmin=False, school_location=""):
    lecturer = Lecturer(
        email=email,
        password_hash=get_password_hash("Heslo1234Ab!"),
        first_name="Test",
        last_name="Lektor",
        is_active=True,
        is_admin=is_admin,
        is_superadmin=is_superadmin,
        school_location=school_location,
    )
    db.add(lecturer)
    db.commit()
    db.refresh(lecturer)
    return lecturer


def _auth_headers(lecturer):
    token = create_access_token(data={"sub": lecturer.email})
    return {"Authorization": f"Bearer {token}"}


def _make_evaluation(db, *, lecturer_id, class_id, scenario_name, student_name, scenario_display_name=""):
    ev = StudentEvaluation(
        lecturer_id=lecturer_id,
        student_name=student_name,
        cleaned_name=student_name,
        class_id=class_id,
        scenario_name=scenario_name,
        scenario_display_name=scenario_display_name,
        json_result={"celkove_skore": 10, "vysledky": [], "zpetna_vazba": "ok"},
        student_identity={},
        created_at=datetime.datetime.utcnow(),
        is_approved=True,
    )
    db.add(ev)
    db.commit()
    db.refresh(ev)
    return ev


# ─────────────────────────────────────────────────────────────────────────────
# TEST 1 — Admin na OSOBNÍM endpointu vidí data kolegy ze stejné school_location
# (replika Q1 / Q3 forenzního auditu)
# ─────────────────────────────────────────────────────────────────────────────

def test_admin_personal_endpoint_must_not_leak_colocated_lecturer_data(db_session, api_client):
    """
    Admin (is_admin=True) volající OSOBNÍ endpoint `/api/v1/analytics/class/{id}`
    — tj. STEJNÝ endpoint, který používá běžná Evaluation obrazovka SPA — nesmí
    v odpovědi vidět záznam jiného lektora jen proto, že sdílí `school_location`.

    Aktuální `apply_data_isolation()` (auth.py:104-122) pro is_admin rozšiřuje
    filtr na `lecturer_id IN (všichni lektoři stejné lokality)` bez ohledu na to,
    že jde o osobní pracovní plochu — proto tento test v RED fázi SPADNE.
    """
    admin = _make_lecturer(
        db_session, email="admin@pcr.cz", is_admin=True, school_location="OR_PRAHA"
    )
    victim = _make_lecturer(
        db_session, email="ivona.palova@pcr.cz", is_admin=False, school_location="OR_PRAHA"
    )

    _make_evaluation(
        db_session, lecturer_id=admin.id, class_id=1,
        scenario_name="scen-1", student_name="ADMIN_VLASTNI_ZAZNAM",
    )
    _make_evaluation(
        db_session, lecturer_id=victim.id, class_id=1,
        scenario_name="scen-1", student_name="CIZI_ZAZNAM_KOLEGYNE",
    )

    resp = api_client.get(
        "/api/v1/analytics/class/1?scenario_id=scen-1",
        headers=_auth_headers(admin),
    )
    assert resp.status_code == 200

    names = {row["jmeno_studenta"] for row in resp.json()}
    assert "CIZI_ZAZNAM_KOLEGYNE" not in names, (
        "BEZPEČNOSTNÍ INCIDENT REPLIKOVÁN: osobní endpoint /analytics/class/1 vrátil "
        f"i záznam kolegy ze stejné school_location. Vráceno: {names}"
    )
    assert names == {"ADMIN_VLASTNI_ZAZNAM"}


# ─────────────────────────────────────────────────────────────────────────────
# TEST 2 — Superadmin na OSOBNÍM endpointu vidí data ZCELA CIZÍHO lektora
# (odlišná lokalita i role) — replika Q1 / Q3 auditu, globální varianta
# ─────────────────────────────────────────────────────────────────────────────

def test_superadmin_personal_endpoint_must_not_leak_global_data(db_session, api_client):
    """
    Superadmin volající OSOBNÍ endpoint (např. z vlastního profilu/evaluation tabu)
    nesmí automaticky obdržet VŠECHNA data v systému — bez explicitního volání
    manažerského/globálního endpointu (`/api/v1/statistics/...`).

    Aktuální `apply_data_isolation()` pro is_superadmin vrací `query` beze změny
    (žádný filtr) — proto tento test v RED fázi SPADNE.
    """
    superadmin = _make_lecturer(
        db_session, email="lukas.zverina@pcr.cz", is_superadmin=True, school_location="OR_PRAHA"
    )
    unrelated_lecturer = _make_lecturer(
        db_session, email="jiny.lektor@pcr.cz", is_admin=False, school_location="OR_BRNO"
    )

    _make_evaluation(
        db_session, lecturer_id=superadmin.id, class_id=1,
        scenario_name="scen-1", student_name="SUPERADMIN_VLASTNI_ZAZNAM",
    )
    _make_evaluation(
        db_session, lecturer_id=unrelated_lecturer.id, class_id=1,
        scenario_name="scen-1", student_name="CIZI_ZAZNAM_JINE_LOKALITY",
    )

    resp = api_client.get(
        "/api/v1/analytics/class/1?scenario_id=scen-1",
        headers=_auth_headers(superadmin),
    )
    assert resp.status_code == 200

    names = {row["jmeno_studenta"] for row in resp.json()}
    assert "CIZI_ZAZNAM_JINE_LOKALITY" not in names, (
        "BEZPEČNOSTNÍ INCIDENT REPLIKOVÁN: osobní endpoint /analytics/class/1 vrátil "
        f"superadminovi data zcela nesouvisejícího lektora z jiné lokality. Vráceno: {names}"
    )
    assert names == {"SUPERADMIN_VLASTNI_ZAZNAM"}


# ─────────────────────────────────────────────────────────────────────────────
# TEST 3 — replika Q4 auditu, PŘEKALIBROVÁNO na schválenou architekturu z PLAN.md
#
# GREEN fáze objasnila rozpor v původním RED zadání: `/statistics/filter-options`
# je dle PLAN.md explicitně MANAŽERSKÝ endpoint (vyžaduje is_admin/is_superadmin,
# jinak 403 — žádný "osobní" volající pro něj neexistuje) a legitimně používá
# scope=LOCATION/GLOBAL. Požadovat, aby Admin na tomto endpointu viděl jen svoje
# scénáře, by rozbilo zamýšlenou manažerskou funkci (filtrování statistik napříč
# lokalitou) — a je to mimo rozsah incidentu.
#
# Skutečná bezpečnostní vlastnost z auditu (Q4): i když Admin přes filter-options
# legitimně UVIDÍ cizí scenario_id (name-level transparentnost pro manažera),
# NESMÍ ho už zneužít k získání cizího OBSAHU přes OSOBNÍ endpoint
# `/analytics/class/{id}` — to je přesně to, co scope=PERSONAL (test 1) zaručuje.
# Test níže ověřuje obě části tohoto řetězce najednou.
# ─────────────────────────────────────────────────────────────────────────────

def test_filter_options_scenario_cannot_be_weaponized_via_personal_endpoint(db_session, api_client):
    admin = _make_lecturer(
        db_session, email="admin@pcr.cz", is_admin=True, school_location="OR_PRAHA"
    )
    colleague = _make_lecturer(
        db_session, email="kolega@pcr.cz", is_admin=False, school_location="OR_PRAHA"
    )
    plain_lecturer = _make_lecturer(
        db_session, email="obycejny.lektor@pcr.cz", is_admin=False, school_location="OR_PRAHA"
    )

    _make_evaluation(
        db_session, lecturer_id=admin.id, class_id=1,
        scenario_name="scen-admin-vlastni", student_name="Student A",
    )
    _make_evaluation(
        db_session, lecturer_id=colleague.id, class_id=1,
        scenario_name="scen-2", student_name="CIZI_ZAZNAM_KOLEGYNE",
    )

    # a) Endpoint zůstává striktně manažerský — obyčejný lektor je odmítnut (403),
    #    tj. pro tento endpoint reálně neexistuje "osobní" volající.
    resp_plain = api_client.get(
        "/api/v1/statistics/filter-options",
        headers=_auth_headers(plain_lecturer),
    )
    assert resp_plain.status_code == 403

    # b) Admin legitimně vidí scenario_id kolegy ze stejné lokality — to je
    #    ZAMÝŠLENÉ chování scope=LOCATION pro manažerský přehled, ne únik.
    resp_admin = api_client.get(
        "/api/v1/statistics/filter-options",
        headers=_auth_headers(admin),
    )
    assert resp_admin.status_code == 200
    scenario_ids = {s["id"] for s in resp_admin.json()["scenarios"]}
    assert "scen-2" in scenario_ids, (
        "Regrese manažerské funkce: Admin by měl na /statistics/filter-options "
        f"vidět scénáře celé lokality (scope=LOCATION). Vráceno: {scenario_ids}"
    )

    # c) KLÍČOVÁ BEZPEČNOSTNÍ VLASTNOST (jádro Q4 incidentu): získané cizí
    #    scenario_id "scen-2" nesmí adminovi přes OSOBNÍ endpoint
    #    /analytics/class/{id} zpřístupnit obsah kolegynina záznamu.
    resp_personal = api_client.get(
        "/api/v1/analytics/class/1?scenario_id=scen-2",
        headers=_auth_headers(admin),
    )
    assert resp_personal.status_code == 200
    names = {row["jmeno_studenta"] for row in resp_personal.json()}
    assert "CIZI_ZAZNAM_KOLEGYNE" not in names, (
        "BEZPEČNOSTNÍ INCIDENT REPLIKOVÁN: scenario_id získané z manažerského "
        "filter-options bylo možné zneužít v osobním kontextu k získání cizích "
        f"dat. Vráceno: {names}"
    )
    assert names == set()
