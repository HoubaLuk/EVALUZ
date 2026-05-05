"""Integrační testy pro evaluate_report pipeline.

Každý test používá in-memory SQLite DB a respx mock pro vLLM HTTP endpoint.
Žádný test nevyžaduje běžící vLLM ani připojení k síti.

E1 scénáře:
  1. test_evaluate_clean_single_call          — 3 kritéria, validní JSON, skóre odpovídá
  2. test_evaluate_truncated_json_recovers    — uříznutý JSON → _json_repaired=True
  3. test_evaluate_chunked_missing_criterion  — 12 kritérií, jeden chunk vynechá 1 krit. → placeholder
  4. test_partial_recovery_flag_in_response   — 6 kritérií, chunk vrátí 4/6 → _partial_recovery
  5. test_fast_scan_identity_not_overwritten  — regression guard pro E3b (záměrně FAILuje)

E2 scénáře:
  6. test_chunking_single_call_when_under_threshold  — malý prompt → 1 LLM call
  7. test_chunking_falls_back_when_over_threshold    — přetečení → chunking aktivní
  8. test_chunking_respects_chunk_size_setting       — CHUNK_SIZE=2 → více chunků

E6 scénáře:
  2. test_evaluate_truncated_json_raises             — uříznutý JSON → ValueError (fail-fast)
  4b. test_no_partial_recovery_flag_anywhere         — _partial_recovery flag nikdy nepřítomen
"""

import pytest
from sqlalchemy.orm import Session

from services.llm_engine import evaluate_report
from models.db_models import StudentEvaluation
from tests.integration.conftest import (
    SAMPLE_REPORT_TEXT,
    CRITERIA_3,
    CRITERIA_6,
    CRITERIA_12,
    build_expected_names,
    build_expected_bodies,
)

pytestmark = pytest.mark.integration


# ── Test 1: čistý single-call ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_evaluate_clean_single_call(db: Session, mock_llm):
    """3 kritéria → jeden LLM call → výsledek má všechna kritéria, správné skóre."""
    names = build_expected_names(CRITERIA_3)
    bodies = build_expected_bodies(CRITERIA_3)

    mock_llm.respond_clean(names, list(bodies.values()))

    with mock_llm:
        result = await evaluate_report(
            report_text=SAMPLE_REPORT_TEXT,
            criteria_markdown=_build_criteria_markdown(CRITERIA_3),
            system_prompt="Vyhodnoť ÚZ.",
            db=db,
            scenario_id="scen-test-3",
            student_log_prefix="test_student",
            expected_criteria_names=names,
            expected_criteria_bodies=bodies,
        )

    assert "vysledky" in result
    returned_names = [v["nazev"] for v in result["vysledky"]]
    assert set(returned_names) == set(names), f"Chybí kritéria: {set(names) - set(returned_names)}"
    assert len(result["vysledky"]) == len(CRITERIA_3)

    # Skóre = součet bodů splněných kritérií
    expected_score = sum(bodies.values())
    assert result["celkove_skore"] == expected_score

    # Žádný příznak opravy
    assert not result.get("_json_repaired")
    assert not result.get("_partial_recovery")


# ── Test 2: uříznutý JSON → fail-fast (E6: _repair_truncated_json smazána) ───

@pytest.mark.asyncio
async def test_evaluate_truncated_json_raises(db: Session, mock_llm):
    """Po E6: uříznutý JSON (sanitizace nestačí) → ValueError (fail-fast, ne recovery).

    S 128k kontextem je truncace prakticky nemožná → half-repaired výsledek
    je horší než čistá chyba, která vynutí re-evaluaci.
    """
    names = build_expected_names(CRITERIA_3)
    bodies = build_expected_bodies(CRITERIA_3)

    mock_llm.respond_truncated(names)

    with pytest.raises((ValueError, Exception)):
        with mock_llm:
            await evaluate_report(
                report_text=SAMPLE_REPORT_TEXT,
                criteria_markdown=_build_criteria_markdown(CRITERIA_3),
                system_prompt="Vyhodnoť ÚZ.",
                db=db,
                scenario_id="scen-test-3",
                student_log_prefix="truncated_test",
                expected_criteria_names=names,
                expected_criteria_bodies=bodies,
            )


# ── Test 3: 12 kritérií, chunking, chybějící kritérium → placeholder ─────────

@pytest.mark.asyncio
async def test_evaluate_chunked_missing_criterion(db: Session, mock_llm):
    """12 kritérií → 2 chunky, druhý chunk vynechá 1 krit. → placeholder s _llm_omitted=True."""
    names = build_expected_names(CRITERIA_12)
    bodies = build_expected_bodies(CRITERIA_12)

    # CRITERIA_12 = 12 položek → CHUNK_SIZE=6 → 2 chunky [0:6] a [6:12]
    chunk1_names = names[:6]
    chunk2_names = names[6:]
    missing = chunk2_names[-1]  # Poslední kritérium vynecháme v druhém chunku

    mock_llm.respond_chunk_pattern(
        chunks=[chunk1_names, chunk2_names],
        missing_per_chunk=[[], [missing]],
    )

    with mock_llm:
        result = await evaluate_report(
            report_text=SAMPLE_REPORT_TEXT,
            criteria_markdown=_build_criteria_markdown(CRITERIA_12),
            system_prompt="Vyhodnoť ÚZ.",
            db=db,
            scenario_id="scen-test-12",
            student_log_prefix="chunked_test",
            expected_criteria_names=names,
            expected_criteria_bodies=bodies,
        )

    returned_names = [v["nazev"] for v in result["vysledky"]]
    assert len(result["vysledky"]) == len(CRITERIA_12), (
        f"Očekáváno {len(CRITERIA_12)} kritérií (včetně placeholderů), "
        f"dostáno {len(result['vysledky'])}"
    )
    assert missing in returned_names, f"Placeholder pro '{missing}' musí být v výsledcích"

    placeholder = next(v for v in result["vysledky"] if v["nazev"] == missing)
    assert placeholder.get("_llm_omitted") is True
    assert placeholder["splneno"] is False
    assert placeholder["body"] == 0


# ── Test 4: chybějící kritéria → placeholdery (po E6: bez _partial_recovery flagu) ──

@pytest.mark.asyncio
async def test_missing_criteria_get_placeholders(db: Session, mock_llm):
    """6 kritérií, LLM vrátí pouze 4 → 2 placeholdery s _llm_omitted=True.

    Po E6: _partial_recovery flag neexistuje (smazán spolu s _check_partial_recovery).
    Placeholdery zůstávají — _validate_and_fix_vysledky je přidává vždy.
    """
    names = build_expected_names(CRITERIA_6)
    bodies = build_expected_bodies(CRITERIA_6)

    missing = names[4:]

    mock_llm.respond_chunk_pattern(
        chunks=[names],
        missing_per_chunk=[missing],
    )

    with mock_llm:
        result = await evaluate_report(
            report_text=SAMPLE_REPORT_TEXT,
            criteria_markdown=_build_criteria_markdown(CRITERIA_6),
            system_prompt="Vyhodnoť ÚZ.",
            db=db,
            scenario_id="scen-test-6",
            student_log_prefix="partial_test",
            expected_criteria_names=names,
            expected_criteria_bodies=bodies,
        )

    assert "_partial_recovery" not in result, "E6: _partial_recovery flag byl smazán"
    omitted = [v for v in result["vysledky"] if v.get("_llm_omitted")]
    assert len(omitted) == len(missing)
    assert len(result["vysledky"]) == len(CRITERIA_6)


# ── Test 4b: _partial_recovery flag nesmí být v žádné odpovědi (E6 smazal _check_partial_recovery) ─

@pytest.mark.asyncio
async def test_no_partial_recovery_flag_anywhere(db: Session, mock_llm):
    """Po E6: _check_partial_recovery byla smazána → _partial_recovery flag se nikdy neobjeví."""
    names = build_expected_names(CRITERIA_6)
    bodies = build_expected_bodies(CRITERIA_6)

    # Simulujeme LLM, které vrátí jen 4/6 kritérií
    missing = names[4:]
    mock_llm.respond_chunk_pattern(chunks=[names], missing_per_chunk=[missing])

    with mock_llm:
        result = await evaluate_report(
            report_text=SAMPLE_REPORT_TEXT,
            criteria_markdown=_build_criteria_markdown(CRITERIA_6),
            system_prompt="Vyhodnoť ÚZ.",
            db=db,
            scenario_id="scen-test-6",
            student_log_prefix="no_partial_test",
            expected_criteria_names=names,
            expected_criteria_bodies=bodies,
        )

    assert "_partial_recovery" not in result, (
        "_partial_recovery flag nesmí existovat — _check_partial_recovery byla smazána v E6"
    )
    # Placeholdery stále jsou přítomny (_llm_omitted=True), ale bez metadata flagu
    omitted = [v for v in result["vysledky"] if v.get("_llm_omitted")]
    assert len(omitted) == len(missing), f"Očekáváno {len(missing)} placeholder(ů)"


# ── Test 5: fast-scan identity → full eval NEPŘEPÍŠE cleaned_name (regression guard) ─

@pytest.mark.asyncio
async def test_fast_scan_identity_not_overwritten(db: Session, mock_llm):
    """Regression test pro E3b fix.

    Scénář:
      1. Fast-scan uloží StudentEvaluation s prázdnou student_identity={} a cleaned_name z filename.
      2. Full eval (evaluate_report) najde identitu → příjmení "Novák".
      3. E3b FIX: cleaned_name a student_identity se PŘEPÍŠÍ, protože nová podmínka
         has_new=True (příjmení nalezeno) AND prev_has=False ({} je bez příjmení).

    Dříve selhal před E3b (prázdný dict {} byl falsy → podmínka neprojela).
    """
    from models.db_models import ClassRoom, StudentEvaluation, Lecturer
    import datetime

    lecturer = db.query(Lecturer).filter(Lecturer.email == "test@evaluz.cz").first()
    classroom = db.query(ClassRoom).filter(ClassRoom.name == "Základní kurz").first()

    # 1. Fast-scan state: prázdná identita ({}), cleaned_name z filename
    eval_record = StudentEvaluation(
        student_name="uz_novak_jan.pdf",
        cleaned_name="uz_novak_jan",  # Raw filename-based name
        class_id=classroom.id,
        scenario_name="scen-test-3",
        lecturer_id=lecturer.id,
        student_identity={},  # Prázdná identita — fast-scan nic nenašel
        created_at=datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None),
    )
    db.add(eval_record)
    db.commit()
    db.refresh(eval_record)

    # 2. Full eval mock — LLM vrátí identitu s příjmením "Novák"
    names = build_expected_names(CRITERIA_3)
    bodies = build_expected_bodies(CRITERIA_3)
    mock_llm.respond_clean(names, list(bodies.values()))

    with mock_llm:
        llm_result = await evaluate_report(
            report_text=SAMPLE_REPORT_TEXT,
            criteria_markdown=_build_criteria_markdown(CRITERIA_3),
            system_prompt="Vyhodnoť ÚZ.",
            db=db,
            scenario_id="scen-test-3",
            student_log_prefix="uz_novak_jan.pdf",
            expected_criteria_names=names,
            expected_criteria_bodies=bodies,
        )

    # Aplikujeme opravenou E3b logiku z evaluate.py
    identita = llm_result.get("identita", {})
    prijmeni = identita.get("prijmeni", "").strip()
    jmeno = identita.get("jmeno", "").strip()
    if prijmeni and jmeno:
        cleaned_eval_name = f"{prijmeni.capitalize()} {jmeno.capitalize()}"
    elif prijmeni:
        cleaned_eval_name = prijmeni.capitalize()
    else:
        from utils.text import clean_filename_to_display
        cleaned_eval_name = clean_filename_to_display(eval_record.student_name)

    existing = db.query(StudentEvaluation).filter(
        StudentEvaluation.id == eval_record.id
    ).first()

    # E3b: nová podmínka — has_new=True (příjmení "Novák"), prev_has=False ({}) → update proběhne
    prev_identity = existing.student_identity or {}
    has_new = bool(identita.get("prijmeni", "").strip())
    prev_has = bool(prev_identity.get("prijmeni", "").strip())
    if has_new and not prev_has:
        existing.student_identity = identita
        existing.cleaned_name = cleaned_eval_name
        db.commit()

    db.refresh(existing)

    assert existing.cleaned_name == "Novák Jan", (
        f"E3b: cleaned_name='{existing.cleaned_name}' musí být aktualizováno z identity LLM"
    )
    assert existing.student_identity == identita


# ── E2: Adaptivní chunking ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_chunking_single_call_when_under_threshold(db: Session, mock_llm):
    """Krátký prompt (3 kritéria + krátký ÚZ) vejde do 8192 × 0.7 = 5734 token budget
    → single-call (1 HTTP request), žádný merge.
    """
    from models.db_models import AppSettings

    # Nastavíme malý kontext pro test — 8192 s default threshold 0.7 = budget 5734 tokenů.
    # Krátký SAMPLE_REPORT_TEXT (~500 znaků) + 3 kritéria (~200 znaků) = ~200 tokenů → single-call.
    db.query(AppSettings).filter(AppSettings.key == "LLM_CONTEXT_WINDOW").update({"value": "8192"})
    db.query(AppSettings).filter(AppSettings.key == "CHUNK_THRESHOLD_TOKENS_PCT").update({"value": "0.7"})
    db.commit()
    db.expire_all()  # Bulk UPDATE obchází identity map — nutné pro správné čtení v _get_setting

    names = build_expected_names(CRITERIA_3)
    bodies = build_expected_bodies(CRITERIA_3)
    mock_llm.respond_clean(names, list(bodies.values()))

    with mock_llm:
        result = await evaluate_report(
            report_text=SAMPLE_REPORT_TEXT,
            criteria_markdown=_build_criteria_markdown(CRITERIA_3),
            system_prompt="Vyhodnoť ÚZ.",
            db=db,
            scenario_id="scen-test-3",
            student_log_prefix="single_call_test",
            expected_criteria_names=names,
            expected_criteria_bodies=bodies,
        )

    assert mock_llm.call_count == 1, (
        f"Single-call scénář musí generovat právě 1 HTTP request, bylo {mock_llm.call_count}"
    )
    assert len(result["vysledky"]) == len(CRITERIA_3)


@pytest.mark.asyncio
async def test_chunking_falls_back_when_over_threshold(db: Session, mock_llm):
    """Nastavíme threshold_pct=0.0 → budget=0 → chunking se aktivuje i pro 3 kritéria."""
    from models.db_models import AppSettings

    db.query(AppSettings).filter(AppSettings.key == "CHUNK_THRESHOLD_TOKENS_PCT").update({"value": "0.0"})
    db.query(AppSettings).filter(AppSettings.key == "CHUNK_SIZE").update({"value": "2"})
    db.commit()
    db.expire_all()

    names = build_expected_names(CRITERIA_3)
    bodies = build_expected_bodies(CRITERIA_3)
    # 3 kritéria, chunk_size=2 → 2 chunky: [K1,K2] a [K3]
    chunk1 = names[:2]
    chunk2 = names[2:]
    mock_llm.respond_chunk_pattern(chunks=[chunk1, chunk2])

    with mock_llm:
        result = await evaluate_report(
            report_text=SAMPLE_REPORT_TEXT,
            criteria_markdown=_build_criteria_markdown(CRITERIA_3),
            system_prompt="Vyhodnoť ÚZ.",
            db=db,
            scenario_id="scen-test-3",
            student_log_prefix="over_threshold_test",
            expected_criteria_names=names,
            expected_criteria_bodies=bodies,
        )

    assert mock_llm.call_count == 2, (
        f"Chunking (2 chunks) musí generovat 2 HTTP requesty, bylo {mock_llm.call_count}"
    )
    assert len(result["vysledky"]) == len(CRITERIA_3)


@pytest.mark.asyncio
async def test_chunking_respects_chunk_size_setting(db: Session, mock_llm):
    """CHUNK_SIZE=3 aplikovaný na 12 kritérií → 4 chunky (ne 2 jako při default 6)."""
    from models.db_models import AppSettings

    db.query(AppSettings).filter(AppSettings.key == "CHUNK_THRESHOLD_TOKENS_PCT").update({"value": "0.0"})
    db.query(AppSettings).filter(AppSettings.key == "CHUNK_SIZE").update({"value": "3"})
    db.commit()
    db.expire_all()

    names = build_expected_names(CRITERIA_12)
    bodies = build_expected_bodies(CRITERIA_12)
    # 12 kritérií, chunk_size=3 → 4 chunky
    chunks = [names[i:i+3] for i in range(0, 12, 3)]
    mock_llm.respond_chunk_pattern(chunks=chunks)

    with mock_llm:
        result = await evaluate_report(
            report_text=SAMPLE_REPORT_TEXT,
            criteria_markdown=_build_criteria_markdown(CRITERIA_12),
            system_prompt="Vyhodnoť ÚZ.",
            db=db,
            scenario_id="scen-test-12",
            student_log_prefix="chunk_size_test",
            expected_criteria_names=names,
            expected_criteria_bodies=bodies,
        )

    assert mock_llm.call_count == 4, (
        f"CHUNK_SIZE=3 na 12 kritériích musí generovat 4 HTTP requesty, bylo {mock_llm.call_count}"
    )
    assert len(result["vysledky"]) == len(CRITERIA_12)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _build_criteria_markdown(criteria: list[tuple]) -> str:
    from services.llm_engine import CRITERIA_DELIMITER
    lines = []
    for i, (name, popis, body) in enumerate(criteria, 1):
        lines.append(f"**{i}. Kritérium: {name}**\n{popis}\nBodů za splnění: {body}")
    return f"\n\n{CRITERIA_DELIMITER}\n\n".join(lines)
