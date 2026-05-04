"""Fixtures pro integrační testy.

Každý test dostane:
- `db`           — izolovanou in-memory SQLite session s oseedovanými AppSettings
- `client`       — FastAPI TestClient připojený na tuto DB (lifespan izolován)
- `auth_headers` — JWT Bearer hlavičky pro testovacího lektora
- `mock_llm`     — MockLLMRouter (context manager, musí být aktivován v testu)

AppSettings jsou nastaveny tak, aby `evaluate_report` posílal HTTP na MOCK_VLLM_URL
(interceptované přes respx v každém testu zvlášť).
"""

import sys
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parent.parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import datetime

from models.db_models import (
    Base, Lecturer, AppSettings, EvaluationCriteria, Criterion,
    ClassRoom, SystemPrompt, StudentEvaluation,
)
from core.security import get_password_hash, create_access_token
from core.database import get_db
from tests.integration.mock_llm import MOCK_VLLM_URL


# ── DB Fixtures ──────────────────────────────────────────────────────────────

@pytest.fixture(scope="function")
def db_engine():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(bind=engine)
    yield engine
    engine.dispose()


@pytest.fixture(scope="function")
def db(db_engine):
    Session = sessionmaker(bind=db_engine)
    session = Session()
    _seed_db(session)
    yield session
    session.close()


# ── FastAPI Client ────────────────────────────────────────────────────────────

@pytest.fixture(scope="function")
def client(db):
    """FastAPI TestClient s izolovanou in-memory DB.

    Lifespan je potlačen — init_db() se nevola (vyhneme se zápisu do souborového
    systému a závislostem na produkční DATABASE_URL).
    """
    import main as app_module
    from contextlib import asynccontextmanager
    from fastapi import FastAPI

    # Vytvoříme novou FastAPI aplikaci BEZ lifespan, ale se stejnými routery.
    # To zabrání init_db() zápisu souborové SQLite DB do CWD.
    test_app = FastAPI()
    for route in app_module.app.routes:
        test_app.routes.append(route)

    def override_get_db():
        yield db

    test_app.dependency_overrides[get_db] = override_get_db

    with TestClient(test_app) as c:
        yield c


# ── Auth ──────────────────────────────────────────────────────────────────────

@pytest.fixture(scope="function")
def auth_headers(db):
    lecturer = db.query(Lecturer).filter(Lecturer.email == "test@evaluz.cz").first()
    token = create_access_token(data={"sub": lecturer.email})
    return {"Authorization": f"Bearer {token}"}


# ── Mock LLM ──────────────────────────────────────────────────────────────────

@pytest.fixture(scope="function")
def mock_llm():
    from tests.integration.mock_llm import MockLLMRouter
    return MockLLMRouter()


# ── Sample data ───────────────────────────────────────────────────────────────

SAMPLE_REPORT_TEXT = """
ÚŘEDNÍ ZÁZNAM

Dne 15.3.2024 v 14:30 hod. jsem, prap. Jan Novák, služebně zařazený u OOP Praha 1,
provedl kontrolu osoby na náměstí Republiky.

Osoba byla ztotožněna jako Martin Procházka, nar. 1.1.1990.
Byly provedeny standardní úkony dle zákona č. 273/2008 Sb.
Výzva byla provedena jménem zákona dle § 63 odst. 1.
Byl proveden záznam v PATROS systému.

Vypracoval: prap. Jan Novák
""".strip()


CRITERIA_3 = [
    ("Zákonná výzva", "Ověřte, zda policista provedl zákonnou výzvu.", 2),
    ("Ztotožnění osoby", "Ověřte, zda byla osoba řádně ztotožněna.", 3),
    ("Záznam v PATROS", "Ověřte, zda byl proveden záznam v systému PATROS.", 1),
]

CRITERIA_6 = [
    ("Zákonná výzva", "Ověřte zákonnou výzvu.", 2),
    ("Ztotožnění osoby", "Ověřte ztotožnění.", 3),
    ("Záznam v PATROS", "Ověřte PATROS.", 1),
    ("Poučení osoby", "Ověřte poučení.", 1),
    ("Přiměřenost zásahu", "Ověřte přiměřenost.", 2),
    ("Dokumentace", "Ověřte dokumentaci.", 1),
]

CRITERIA_12 = CRITERIA_6 + [
    ("Oznámení NOS", "Ověřte oznámení NOS.", 1),
    ("Zajištění místa", "Ověřte zajištění místa.", 1),
    ("Eskorta osoby", "Ověřte eskortu.", 2),
    ("Sdělení práv", "Ověřte sdělení práv.", 1),
    ("Zákrok dle SŘP", "Ověřte SŘP.", 1),
    ("Závěrečná zpráva", "Ověřte zprávu.", 1),
]


# ── Seed helper ──────────────────────────────────────────────────────────────

def _seed_db(db):
    # Lektor
    lecturer = Lecturer(
        email="test@evaluz.cz",
        password_hash=get_password_hash("TestHeslo123!"),
        first_name="Test",
        last_name="Lektor",
        is_active=True,
        is_admin=True,
    )
    db.add(lecturer)
    db.flush()

    # AppSettings — povinné pro evaluate_report
    settings_map = {
        "VLLM_API_URL": MOCK_VLLM_URL,
        "VLLM_MODEL_NAME": "test-model",
        "VLLM_API_KEY": "sk-test",
        "LLM_PLATFORM": "vllm",
        "VLLM_ENABLE_THINKING": "false",
        "VLLM_MAX_TOKENS": "512",
        "VLLM_TOP_P": "0.95",
        "VLLM_PRESENCE_PENALTY": "0.0",
        "VLLM_FREQUENCY_PENALTY": "0.0",
        "LLM_CONTEXT_WINDOW": "8192",
        "CHUNK_SIZE": "6",
        "CHUNK_THRESHOLD_TOKENS_PCT": "0.7",
    }
    for key, value in settings_map.items():
        db.add(AppSettings(key=key, value=value))

    # System prompt phase2
    db.add(SystemPrompt(
        phase_name="prompt2",
        content="Vyhodnoť ÚZ. Vrať validní JSON.",
        temperature=0.1,
    ))

    # Třída
    classroom = ClassRoom(name="Základní kurz", lecturer_id=lecturer.id)
    db.add(classroom)

    # Kritéria pro jednotlivé scénáře
    _seed_criteria(db, lecturer.id, "scen-test-3", CRITERIA_3)
    _seed_criteria(db, lecturer.id, "scen-test-6", CRITERIA_6)
    _seed_criteria(db, lecturer.id, "scen-test-12", CRITERIA_12)

    db.commit()
    return lecturer.id  # vrátíme pro případné explicitní použití


def _seed_criteria(db, lecturer_id: int, scenario: str, criteria: list[tuple]):
    from services.llm_engine import CRITERIA_DELIMITER
    lines = []
    for i, (name, popis, body) in enumerate(criteria, 1):
        lines.append(f"**{i}. Kritérium: {name}**\n{popis}\nBodů za splnění: {body}")
    markdown = f"\n\n{CRITERIA_DELIMITER}\n\n".join(lines)

    ec = EvaluationCriteria(
        lecturer_id=lecturer_id,
        scenario_name=scenario,
        markdown_content=markdown,
    )
    db.add(ec)
    db.flush()

    for i, (name, popis, body) in enumerate(criteria, 1):
        db.add(Criterion(
            evaluation_criteria_id=ec.id,
            nazev=name,
            popis=popis,
            body=body,
        ))


def build_expected_names(criteria: list[tuple]) -> list[str]:
    return [name for name, _, _ in criteria]


def build_expected_bodies(criteria: list[tuple]) -> dict[str, int]:
    return {name: body for name, _, body in criteria}
