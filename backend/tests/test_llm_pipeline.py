"""Regression test suite pro JSON parse pipeline a kanonizační validaci.

Pokrytí:
- `_canonicalize_criterion_name` — strip prefixu i person-specific suffixu
- `_validate_and_fix_vysledky` — match přes kanonizaci, audit `_llm_actual_name`,
  multi-person duplikáty, doplnění chybějících
- `_check_partial_recovery` — metadata po validaci
- `_sanitize_json_string_values` — neescape uvozovky v citacích, lone backslash, control chars
- `_repair_truncated_json` — recovery z truncated výstupu
- `_split_criteria_chunks` — primární delimiter cesta i legacy regex fallback
- `_merge_chunk_results` — propagace `_json_repaired` flagu
- `parse_criteria_markdown` — delimiter primární i legacy fallback

Tyto testy pokrývají regrese, na které jsme historicky naráželi (v3.7.8 truncation,
v3.9.1 quotes v citacích, v3.9.2 missing comma, v3.9.5 hallucinace, v3.9.6 personalizace).
"""
import json
import pytest

from services.llm_engine import (
    _canonicalize_criterion_name,
    _validate_and_fix_vysledky,
    _check_partial_recovery,
    _sanitize_json_string_values,
    _repair_truncated_json,
    _split_criteria_chunks,
    _merge_chunk_results,
    CRITERIA_DELIMITER,
)
from services.criteria_service import parse_criteria_markdown


# ---------------------------------------------------------------------------
# _canonicalize_criterion_name
# ---------------------------------------------------------------------------

class TestCanonicalizeCriterionName:
    def test_passes_through_clean_name(self):
        assert _canonicalize_criterion_name("Ztotožnění osoby") == "ztotožnění osoby"

    def test_strips_prompt_prefix_with_number(self):
        # LLM někdy zkopíruje formát z promptu místo holého názvu
        assert _canonicalize_criterion_name("**1. Kritérium: Zákonná výzva**") == "zákonná výzva"
        assert _canonicalize_criterion_name("13. Kritérium: Eskorta osoby") == "eskorta osoby"
        assert _canonicalize_criterion_name("**13. Kritérium: Ustanovení paragrafu**") == "ustanovení paragrafu"

    def test_strips_person_suffix_with_em_dash(self):
        # Hlavní use-case z VTOS scénáře — model přidá jméno osoby z ÚZ
        result = _canonicalize_criterion_name("Ztotožnění osoby – Ivana Horáková")
        assert result == "ztotožnění osoby"

    def test_strips_person_suffix_with_en_dash(self):
        result = _canonicalize_criterion_name("Lustrace PATROS – Tadeáš Kadlec")
        assert result == "lustrace patros"

    def test_strips_person_suffix_with_hyphen(self):
        result = _canonicalize_criterion_name("Vysvětlení osoby - Jan Novák")
        assert result == "vysvětlení osoby"

    def test_keeps_descriptive_dash_with_lowercase(self):
        # NESMÍ ořezat popisné pomlčky uprostřed
        name = "Ztotožnění osoby – minimálně jméno, příjmení, datum narození"
        # Heuristika strippuje POSLEDNÍ segment POUZE pokud vypadá jako jméno (Velké+Velké).
        # "minimálně jméno..." začíná malým písmenem → NESTRIPOVAT.
        assert _canonicalize_criterion_name(name) == "ztotožnění osoby – minimálně jméno, příjmení, datum narození"

    def test_strips_combined_prefix_and_person_suffix(self):
        # Reálný case z logu 29.4.2026
        full = "**13. Kritérium: Ztotožnění osoby – Tadeáš Kadlec**"
        assert _canonicalize_criterion_name(full) == "ztotožnění osoby"

    def test_strips_multiple_person_suffixes(self):
        # Edge case: model přidá víc osob
        name = "Ztotožnění osoby – Jan Novák – Tadeáš Kadlec"
        assert _canonicalize_criterion_name(name) == "ztotožnění osoby"

    def test_handles_empty_and_invalid_input(self):
        assert _canonicalize_criterion_name("") == ""
        assert _canonicalize_criterion_name(None) == ""
        assert _canonicalize_criterion_name(123) == ""

    def test_match_across_different_persons(self):
        # Hurta a Kořař dostali stejné generické kritérium s různým jménem.
        # Po kanonizaci musí oba dát stejný klíč.
        a = _canonicalize_criterion_name("Ztotožnění osoby – Tadeáš Kadlec")
        b = _canonicalize_criterion_name("Ztotožnění osoby – Ivana Horáková")
        assert a == b


# ---------------------------------------------------------------------------
# _validate_and_fix_vysledky
# ---------------------------------------------------------------------------

class TestValidateAndFixVysledky:
    def _expected(self):
        return ["Zákonná výzva", "Ztotožnění osoby", "Eskorta osoby"]

    def test_exact_match_passes_through(self):
        parsed = {
            "vysledky": [
                {"nazev": "Zákonná výzva", "splneno": True, "body": 5},
                {"nazev": "Ztotožnění osoby", "splneno": True, "body": 3},
                {"nazev": "Eskorta osoby", "splneno": False, "body": 0},
            ]
        }
        _validate_and_fix_vysledky(parsed, self._expected(), "[T] ")
        assert len(parsed["vysledky"]) == 3
        assert parsed["celkove_skore"] == 8
        for v in parsed["vysledky"]:
            assert "_llm_actual_name" not in v  # exact match → žádný audit
            assert "_llm_omitted" not in v

    def test_canonical_match_with_person_suffix_keeps_item_and_audits(self):
        # Hlavní use-case fáze A
        parsed = {
            "vysledky": [
                {"nazev": "Ztotožnění osoby – Ivana Horáková", "splneno": True, "body": 3},
                {"nazev": "Zákonná výzva", "splneno": True, "body": 5},
                {"nazev": "Eskorta osoby", "splneno": False, "body": 0},
            ]
        }
        _validate_and_fix_vysledky(parsed, self._expected(), "[T] ")
        assert len(parsed["vysledky"]) == 3
        # nazev byl normalizován na expected
        nazvy = [v["nazev"] for v in parsed["vysledky"]]
        assert "Ztotožnění osoby" in nazvy
        # audit zachoval původní LLM verzi
        ztotozneni = next(v for v in parsed["vysledky"] if v["nazev"] == "Ztotožnění osoby")
        assert ztotozneni["_llm_actual_name"] == "Ztotožnění osoby – Ivana Horáková"
        assert parsed["celkove_skore"] == 8

    def test_canonical_match_with_prompt_prefix(self):
        # LLM zkopíruje formát z promptu
        parsed = {
            "vysledky": [
                {"nazev": "**1. Kritérium: Zákonná výzva**", "splneno": True, "body": 5},
                {"nazev": "Ztotožnění osoby", "splneno": True, "body": 3},
                {"nazev": "Eskorta osoby", "splneno": False, "body": 0},
            ]
        }
        _validate_and_fix_vysledky(parsed, self._expected(), "[T] ")
        assert len(parsed["vysledky"]) == 3
        zakonna = parsed["vysledky"][0]
        assert zakonna["nazev"] == "Zákonná výzva"  # normalizováno
        assert zakonna["_llm_actual_name"] == "**1. Kritérium: Zákonná výzva**"

    def test_multi_person_duplicate_keeps_first(self):
        # Model aplikoval kritérium na obě osoby v ÚZ — chceme jen jednu položku
        parsed = {
            "vysledky": [
                {"nazev": "Ztotožnění osoby – Ivana Horáková", "splneno": True, "body": 3},
                {"nazev": "Ztotožnění osoby – Tadeáš Kadlec", "splneno": False, "body": 0},
                {"nazev": "Zákonná výzva", "splneno": True, "body": 5},
                {"nazev": "Eskorta osoby", "splneno": False, "body": 0},
            ]
        }
        _validate_and_fix_vysledky(parsed, self._expected(), "[T] ")
        assert len(parsed["vysledky"]) == 3  # ne 4 — duplikát zahozen
        ztotozneni = next(v for v in parsed["vysledky"] if v["nazev"] == "Ztotožnění osoby")
        # první výskyt (Horáková, splneno=True) zachován
        assert ztotozneni["splneno"] is True
        assert ztotozneni["body"] == 3

    def test_truly_unknown_criterion_filtered(self):
        # Model halucinuje úplně nový název
        parsed = {
            "vysledky": [
                {"nazev": "Zákonná výzva", "splneno": True, "body": 5},
                {"nazev": "Tajná halucinace XYZ", "splneno": True, "body": 99},
                {"nazev": "Ztotožnění osoby", "splneno": True, "body": 3},
            ]
        }
        _validate_and_fix_vysledky(parsed, self._expected(), "[T] ")
        # 2 reálné + 1 doplněný placeholder pro chybějící Eskortu
        assert len(parsed["vysledky"]) == 3
        nazvy = {v["nazev"] for v in parsed["vysledky"]}
        assert "Tajná halucinace XYZ" not in nazvy
        assert "Eskorta osoby" in nazvy
        eskorta = next(v for v in parsed["vysledky"] if v["nazev"] == "Eskorta osoby")
        assert eskorta["_llm_omitted"] is True
        assert eskorta["body"] == 0
        assert parsed["celkove_skore"] == 8  # 5 + 3 + 0 (placeholder)

    def test_missing_criterion_added_as_placeholder(self):
        parsed = {
            "vysledky": [
                {"nazev": "Zákonná výzva", "splneno": True, "body": 5},
                # Ztotožnění + Eskorta chybí
            ]
        }
        _validate_and_fix_vysledky(parsed, self._expected(), "[T] ")
        assert len(parsed["vysledky"]) == 3
        omitted = [v for v in parsed["vysledky"] if v.get("_llm_omitted")]
        assert len(omitted) == 2
        assert all(v["body"] == 0 and v["splneno"] is False for v in omitted)


# ---------------------------------------------------------------------------
# _check_partial_recovery
# ---------------------------------------------------------------------------

class TestCheckPartialRecovery:
    def test_no_partial_recovery_when_all_present(self):
        parsed = {
            "vysledky": [
                {"nazev": "A", "splneno": True, "body": 1},
                {"nazev": "B", "splneno": True, "body": 1},
            ]
        }
        _check_partial_recovery(parsed, ["A", "B"], "[T] ")
        assert "_partial_recovery" not in parsed

    def test_partial_recovery_when_omitted_present(self):
        parsed = {
            "vysledky": [
                {"nazev": "A", "splneno": True, "body": 1},
                {"nazev": "B", "splneno": False, "body": 0, "_llm_omitted": True},
            ]
        }
        _check_partial_recovery(parsed, ["A", "B"], "[T] ")
        pr = parsed["_partial_recovery"]
        assert pr["expected"] == 2
        assert pr["recovered"] == 1
        assert pr["lost"] == 1
        assert pr["reason"] == "llm_omitted"

    def test_reason_json_repair_when_flag_set(self):
        parsed = {
            "_json_repaired": True,
            "vysledky": [
                {"nazev": "A", "splneno": False, "body": 0, "_llm_omitted": True},
            ]
        }
        _check_partial_recovery(parsed, ["A"], "[T] ")
        assert parsed["_partial_recovery"]["reason"] == "json_repair"


# ---------------------------------------------------------------------------
# _sanitize_json_string_values
# ---------------------------------------------------------------------------

class TestSanitizer:
    def test_passes_through_valid_json(self):
        text = '{"nazev": "Zákonná výzva", "body": 5}'
        result = _sanitize_json_string_values(text)
        assert json.loads(result) == json.loads(text)

    def test_escapes_unescaped_quotes_in_citation(self):
        # Reálný regress z v3.9.1: model zapíše přímou řeč doslovně
        text = '{"citace": "Řekl: "Jménem zákona, otevřete!" a vstoupil"}'
        result = _sanitize_json_string_values(text)
        parsed = json.loads(result)
        assert "Jménem zákona" in parsed["citace"]

    def test_escapes_lone_backslash(self):
        # FIX D z v3.9.5
        text = r'{"text": "C:\Users\path\file"}'
        result = _sanitize_json_string_values(text)
        parsed = json.loads(result)
        assert "Users" in parsed["text"]

    def test_escapes_control_chars(self):
        # FIX D z v3.9.5
        text = '{"text": "line1\x01line2"}'  # SOH control char
        result = _sanitize_json_string_values(text)
        # Po escapingu už by mělo být parsovatelné
        json.loads(result)  # nesmí selhat

    def test_handles_literal_newline_in_string(self):
        text = '{"oduvodneni": "První věta.\nDruhá věta."}'
        result = _sanitize_json_string_values(text)
        parsed = json.loads(result)
        assert "První" in parsed["oduvodneni"]


# ---------------------------------------------------------------------------
# _repair_truncated_json
# ---------------------------------------------------------------------------

class TestRepairTruncatedJson:
    def test_recovers_complete_records_from_truncated_array(self):
        # Simulace: vLLM JSON mode truncated uprostřed 3. záznamu
        truncated = '''
        {
            "identita": {"jmeno": "Jan", "prijmeni": "Novák"},
            "vysledky": [
                {"nazev": "A", "splneno": true, "body": 5, "oduvodneni": "x", "citace": "y"},
                {"nazev": "B", "splneno": false, "body": 0, "oduvodneni": "x", "citace": "y"},
                {"nazev": "C", "splneno": true, "body
        '''
        result = _repair_truncated_json(truncated)
        assert result is not None
        assert len(result["vysledky"]) == 2  # A a B (kompletní), C zahozeno
        nazvy = [v["nazev"] for v in result["vysledky"]]
        assert "A" in nazvy and "B" in nazvy

    def test_returns_none_when_no_vysledky_marker(self):
        result = _repair_truncated_json('{"some": "thing"}')
        assert result is None


# ---------------------------------------------------------------------------
# _split_criteria_chunks
# ---------------------------------------------------------------------------

class TestSplitCriteriaChunks:
    def test_delimiter_split_primary(self):
        markdown = (
            "**1. Kritérium: A**\nPopis A\nBodů: 1"
            f"\n\n{CRITERIA_DELIMITER}\n\n"
            "**2. Kritérium: B**\nPopis B\nBodů: 1"
            f"\n\n{CRITERIA_DELIMITER}\n\n"
            "**3. Kritérium: C**\nPopis C\nBodů: 1"
        )
        chunks = _split_criteria_chunks(markdown, chunk_size=2)
        assert len(chunks) == 2
        assert "A" in chunks[0] and "B" in chunks[0]
        assert "C" in chunks[1]

    def test_legacy_regex_fallback_when_no_delimiter(self):
        markdown = (
            "**1. Kritérium: A**\nPopis A\nBodů: 1\n\n"
            "**2. Kritérium: B**\nPopis B\nBodů: 1\n\n"
            "**3. Kritérium: C**\nPopis C\nBodů: 1"
        )
        chunks = _split_criteria_chunks(markdown, chunk_size=2)
        assert len(chunks) == 2

    def test_chunk_size_respected(self):
        items = [f"**{i}. Kritérium: K{i}**\nPopis\nBodů: 1" for i in range(1, 8)]
        markdown = f"\n\n{CRITERIA_DELIMITER}\n\n".join(items)
        chunks = _split_criteria_chunks(markdown, chunk_size=3)
        # 7 kritérií / chunk_size 3 = 3 chunky (3+3+1)
        assert len(chunks) == 3


# ---------------------------------------------------------------------------
# _merge_chunk_results
# ---------------------------------------------------------------------------

class TestMergeChunkResults:
    def test_merges_vysledky_from_multiple_chunks(self):
        chunk1 = {"identita": {"jmeno": "Jan"}, "vysledky": [
            {"nazev": "A", "body": 5}, {"nazev": "B", "body": 3}
        ]}
        chunk2 = {"identita": {}, "vysledky": [
            {"nazev": "C", "body": 2}
        ]}
        merged = _merge_chunk_results([chunk1, chunk2])
        assert len(merged["vysledky"]) == 3
        assert merged["celkove_skore"] == 10
        assert merged["identita"]["jmeno"] == "Jan"

    def test_propagates_json_repaired_flag(self):
        # Regress na v3.9.5: pokud kterýkoli chunk byl opraven, merged má flag
        chunk1 = {"identita": {}, "vysledky": [{"nazev": "A", "body": 1}]}
        chunk2 = {"identita": {}, "vysledky": [{"nazev": "B", "body": 1}], "_json_repaired": True}
        merged = _merge_chunk_results([chunk1, chunk2])
        assert merged.get("_json_repaired") is True

    def test_no_json_repaired_when_all_clean(self):
        chunk1 = {"identita": {}, "vysledky": [{"nazev": "A", "body": 1}]}
        chunk2 = {"identita": {}, "vysledky": [{"nazev": "B", "body": 1}]}
        merged = _merge_chunk_results([chunk1, chunk2])
        assert "_json_repaired" not in merged


# ---------------------------------------------------------------------------
# parse_criteria_markdown
# ---------------------------------------------------------------------------

class TestParseCriteriaMarkdown:
    def test_parses_with_delimiter(self):
        markdown = (
            "**1. Kritérium: Zákonná výzva**\nOvěř, zda...\nBodů za splnění: 5"
            f"\n\n{CRITERIA_DELIMITER}\n\n"
            "**2. Kritérium: Eskorta osoby**\nHledej v textu...\nBodů za splnění: 3"
        )
        result = parse_criteria_markdown(markdown)
        assert len(result) == 2
        assert result[0]["nazev"] == "Zákonná výzva"
        assert result[0]["body"] == 5
        assert result[1]["nazev"] == "Eskorta osoby"

    def test_parses_legacy_format_without_delimiter(self):
        markdown = (
            "**1. Kritérium: Zákonná výzva**\nOvěř...\nBodů za splnění: 5\n\n"
            "**2. Kritérium: Eskorta osoby**\nHledej...\nBodů za splnění: 3"
        )
        result = parse_criteria_markdown(markdown)
        assert len(result) == 2
        assert result[0]["nazev"] == "Zákonná výzva"

    def test_extracts_default_body_when_not_specified(self):
        markdown = "**1. Kritérium: Test**\nPopis bez bodů"
        result = parse_criteria_markdown(markdown)
        assert len(result) == 1
        assert result[0]["body"] == 1


# ---------------------------------------------------------------------------
# Integration — celkový dopad fáze A
# ---------------------------------------------------------------------------

class TestPhaseAIntegration:
    """Ověření, že kombinace kanonizace + audit + multi-person pokrývá reálný case z 29.4.2026."""

    def test_kořař_scenario_recovers_from_personalization(self):
        # Reálný case: Kořař dostal 19/25 placeholderů kvůli person-specific halucinaci.
        # Po v3.9.6 by se měla většina zachránit přes kanonizaci.
        expected = [
            "Zákonná výzva",
            "Ztotožnění osoby",
            "Vysvětlení osoby",
            "Lustrace PATROS",
            "Eskorta osoby",
        ]
        # LLM vrátil personalizované varianty (model "aplikoval per osobu")
        parsed = {
            "vysledky": [
                {"nazev": "Zákonná výzva", "splneno": True, "body": 5},
                {"nazev": "Ztotožnění osoby – Ivana Horáková", "splneno": True, "body": 3},
                {"nazev": "Vysvětlení osoby – Ivana Horáková", "splneno": True, "body": 2},
                {"nazev": "Lustrace PATROS – Ivana Horáková", "splneno": True, "body": 4},
                {"nazev": "Ztotožnění osoby – Tadeáš Kadlec", "splneno": True, "body": 3},  # duplikát
                {"nazev": "Lustrace PATROS – Tadeáš Kadlec", "splneno": True, "body": 4},  # duplikát
                {"nazev": "Eskorta osoby", "splneno": True, "body": 6},
            ]
        }
        _validate_and_fix_vysledky(parsed, expected, "[T-Kořař] ")
        _check_partial_recovery(parsed, expected, "[T-Kořař] ")

        # Po kanonizaci by mělo být všech 5 kritérií zachráněno
        assert len(parsed["vysledky"]) == 5
        omitted = [v for v in parsed["vysledky"] if v.get("_llm_omitted")]
        assert len(omitted) == 0  # nic nechybí — všechno se spárovalo
        # Žádný partial_recovery — vše zachráněno
        assert "_partial_recovery" not in parsed
        # Skóre = 5 + 3 + 2 + 4 + 6 = 20 (duplikáty Kadlec se nepočítají)
        assert parsed["celkove_skore"] == 20
        # Kontrola, že duplikáty byly opravdu zahozeny (ne nakopírovány)
        nazvy = [v["nazev"] for v in parsed["vysledky"]]
        assert nazvy.count("Ztotožnění osoby") == 1
        assert nazvy.count("Lustrace PATROS") == 1
