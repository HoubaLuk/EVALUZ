"""Regresní testy pro seedování systémových promptů (ADR-028).

Seeder dřív při zvýšení konstanty `PROMPT_VERSION` v kódu přepsal **obsah i teplotu**
všech čtyř promptů továrními hodnotami. Nerozlišoval prompt upravený správcem od
nedotčeného a `system_prompts` nemá historii ani verzování, takže ztracený text nešlo
obnovit — jedinou stopou byl řádek v logu, v UI se neobjevilo nic.

Prompty se v tomhle nasazení autorují mimo repozitář a vkládají přes Administraci,
takže tovární verze nemá co „vylepšovat". Seeder proto pouze doplňuje chybějící.
"""
import sys
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from core.seeder import _ensure_prompt, seed_database
from models.db_models import SystemPrompt

from tests.test_class_scoping import db_session  # noqa: F401  (pytest fixture)

PHASES = ("prompt1", "prompt2", "prompt_feedback", "prompt3")

CUSTOM_TEXT = "Vlastní prompt správce — deset pravidel, nesmí zmizet."


class TestEnsurePromptContract:
    """Přímé testy invariantu, nezávislé na tom, co `seed_database` zrovna volá.

    Opakované `seed_database()` samo o sobě starou chybu nereprodukuje — ta se
    spouštěla až při ZMĚNĚ konstanty `PROMPT_VERSION`, tedy při zásahu do kódu.
    Tyhle testy proto míří rovnou na krok, který škodil: pokus zapsat jiný obsah
    do existujícího řádku.
    """

    def test_existing_row_is_left_untouched(self, db_session):
        db_session.add(SystemPrompt(phase_name="prompt2", content=CUSTOM_TEXT, temperature=0.35))
        db_session.commit()

        created = _ensure_prompt(db_session, "prompt2", "TOVÁRNÍ ZNĚNÍ", 0.1)
        db_session.commit()

        row = db_session.query(SystemPrompt).filter(SystemPrompt.phase_name == "prompt2").first()
        assert created is False
        assert row.content == CUSTOM_TEXT
        assert row.temperature == 0.35

    def test_missing_row_is_created_with_defaults(self, db_session):
        created = _ensure_prompt(db_session, "prompt2", "TOVÁRNÍ ZNĚNÍ", 0.1)
        db_session.commit()

        row = db_session.query(SystemPrompt).filter(SystemPrompt.phase_name == "prompt2").first()
        assert created is True
        assert row.content == "TOVÁRNÍ ZNĚNÍ"
        assert row.temperature == 0.1


class TestSeederNeverOverwrites:
    def test_customized_prompt_survives_seeding(self, db_session):
        """Opakovaný start backendu nesmí sáhnout na text, který někdo vložil v UI."""
        seed_database(db_session)

        prompt = db_session.query(SystemPrompt).filter(SystemPrompt.phase_name == "prompt2").first()
        prompt.content = CUSTOM_TEXT
        db_session.commit()

        seed_database(db_session)

        db_session.refresh(prompt)
        assert prompt.content == CUSTOM_TEXT

    def test_customized_temperature_survives_seeding(self, db_session):
        """Teplota se od v3.15.0 skutečně používá — její tichý reset by změnil hodnocení."""
        seed_database(db_session)

        prompt = db_session.query(SystemPrompt).filter(SystemPrompt.phase_name == "prompt2").first()
        prompt.temperature = 0.35
        db_session.commit()

        seed_database(db_session)

        db_session.refresh(prompt)
        assert prompt.temperature == 0.35

    def test_all_phases_are_protected(self, db_session):
        """Ochrana platí pro všechny čtyři fáze, ne jen pro evaluaci."""
        seed_database(db_session)

        for phase in PHASES:
            row = db_session.query(SystemPrompt).filter(SystemPrompt.phase_name == phase).first()
            row.content = f"{CUSTOM_TEXT} ({phase})"
        db_session.commit()

        seed_database(db_session)

        for phase in PHASES:
            row = db_session.query(SystemPrompt).filter(SystemPrompt.phase_name == phase).first()
            assert row.content == f"{CUSTOM_TEXT} ({phase})"


class TestSeederFillsGaps:
    def test_missing_prompt_is_created(self, db_session):
        """Prázdná DB musí dostat všechny čtyři prompty."""
        seed_database(db_session)

        for phase in PHASES:
            assert db_session.query(SystemPrompt).filter(
                SystemPrompt.phase_name == phase
            ).first() is not None

    def test_deleted_prompt_is_restored_on_next_start(self, db_session):
        """Smazaný prompt se obnoví sám.

        Dřív se doplnění spouštělo jen při změně PROMPT_VERSION, takže chybějící prompt
        zůstal chybět a fáze tiše běžela na nouzovém jednořádkovém textu z kódu.
        """
        seed_database(db_session)
        db_session.query(SystemPrompt).filter(SystemPrompt.phase_name == "prompt2").delete()
        db_session.commit()

        seed_database(db_session)

        restored = db_session.query(SystemPrompt).filter(
            SystemPrompt.phase_name == "prompt2"
        ).first()
        assert restored is not None
        assert restored.content.strip()

    def test_restoring_one_does_not_touch_the_others(self, db_session):
        """Obnova chybějícího promptu nesmí být záminkou k přepsání ostatních."""
        seed_database(db_session)

        other = db_session.query(SystemPrompt).filter(SystemPrompt.phase_name == "prompt3").first()
        other.content = CUSTOM_TEXT
        db_session.query(SystemPrompt).filter(SystemPrompt.phase_name == "prompt2").delete()
        db_session.commit()

        seed_database(db_session)

        db_session.refresh(other)
        assert other.content == CUSTOM_TEXT
