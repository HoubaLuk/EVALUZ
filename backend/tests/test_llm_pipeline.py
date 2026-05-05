"""Regression test suite pro JSON parse pipeline a kanonizační validaci.

Pokrytí:
- `_canonicalize_criterion_name` — strip prefixu i person-specific suffixu
- `_validate_and_fix_vysledky` — match přes kanonizaci, audit `_llm_actual_name`,
  multi-person duplikáty, doplnění chybějících
- `_sanitize_json_string_values` — neescape uvozovky v citacích, lone backslash, control chars
- `_split_criteria_chunks` — primární delimiter cesta i legacy regex fallback
- `_merge_chunk_results` — propagace `_json_repaired` flagu
- `parse_criteria_markdown` — delimiter primární i legacy fallback

Tyto testy pokrývají regrese, na které jsme historicky naráželi (v3.9.1 quotes v citacích,
v3.9.2 missing comma, v3.9.5 hallucinace, v3.9.6 personalizace).

E6 poznámka: `_check_partial_recovery` a `_repair_truncated_json` byly smazány — jejich testy
jsou v integration suite (test_evaluate_endpoint.py), fail-fast chování ověřuje
test_evaluate_truncated_json_raises a test_no_partial_recovery_flag_anywhere.
"""
import json
import pytest

from services.llm_engine import (
    _canonicalize_criterion_name,
    _validate_and_fix_vysledky,
    _sanitize_json_string_values,
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

    def test_score_ignores_body_when_splneno_false(self):
        """Regrese: Gemma4 vrací splneno=false ale body=1 → skóre bylo nafouklé."""
        parsed = {
            "celkove_skore": 99,
            "vysledky": [
                {"nazev": "Zákonná výzva",    "splneno": True,  "body": 5},
                {"nazev": "Ztotožnění osoby", "splneno": False, "body": 1},  # body>0 ale splneno=False!
                {"nazev": "Eskorta osoby",    "splneno": False, "body": 0},
            ]
        }
        _validate_and_fix_vysledky(parsed, self._expected(), "[T] ")
        ztotozneni = next(v for v in parsed["vysledky"] if v["nazev"] == "Ztotožnění osoby")
        assert ztotozneni["body"] == 0
        assert parsed["celkove_skore"] == 5

    def test_score_not_taken_from_model_when_wrong(self):
        """Regrese: model vrátil celkove_skore=25 přestože 4 kritéria nesplněna (Jančařík/Gemma4 case)."""
        parsed = {
            "celkove_skore": 25,
            "vysledky": [
                {"nazev": "Zákonná výzva",    "splneno": True,  "body": 5},
                {"nazev": "Ztotožnění osoby", "splneno": False, "body": 0},
                {"nazev": "Eskorta osoby",    "splneno": False, "body": 0},
            ]
        }
        _validate_and_fix_vysledky(parsed, self._expected(), "[T] ")
        assert parsed["celkove_skore"] == 5  # ne 25

    def test_body_normalized_from_db_when_splneno_true(self):
        """Regrese: Gemma4 vrací splneno=true ale body=0 — skóre podhodnoceno.
        expected_criteria_bodies přepíše model's body autoritativní hodnotou z DB."""
        parsed = {
            "vysledky": [
                {"nazev": "Zákonná výzva",    "splneno": True, "body": 0},  # model vrátil 0, ale DB má 5
                {"nazev": "Ztotožnění osoby", "splneno": True, "body": 0},  # model vrátil 0, ale DB má 3
                {"nazev": "Eskorta osoby",    "splneno": False, "body": 0},
            ]
        }
        db_bodies = {"Zákonná výzva": 5, "Ztotožnění osoby": 3, "Eskorta osoby": 2}
        _validate_and_fix_vysledky(parsed, self._expected(), "[T] ", expected_criteria_bodies=db_bodies)
        zakonna = next(v for v in parsed["vysledky"] if v["nazev"] == "Zákonná výzva")
        ztotozneni = next(v for v in parsed["vysledky"] if v["nazev"] == "Ztotožnění osoby")
        assert zakonna["body"] == 5   # z DB, ne 0 z modelu
        assert ztotozneni["body"] == 3
        assert parsed["celkove_skore"] == 8  # 5 + 3

    def test_two_criteria_same_canonical_both_preserved(self):
        """Regrese: dvě kritéria se stejným kanonickým základem (VTOS: dvě osoby).
        Starý dict uložil jen jedno → druhé se ztratilo (nikdy placeholder). Fronta opravuje."""
        # Dvě kritéria se stejným základem "Ztotožnění osoby" (různé osoby)
        expected = [
            "Ztotožnění osoby – Tadeáš Kadlec",
            "Ztotožnění osoby – Ivana Horáková",
            "Zákonná výzva",
        ]
        db_bodies = {
            "Ztotožnění osoby – Tadeáš Kadlec": 3,
            "Ztotožnění osoby – Ivana Horáková": 3,
            "Zákonná výzva": 5,
        }
        # Model vrátil jen Kadlece a výzvu — Horáková chybí
        parsed = {
            "vysledky": [
                {"nazev": "Ztotožnění osoby – Tadeáš Kadlec", "splneno": True, "body": 3},
                {"nazev": "Zákonná výzva", "splneno": True, "body": 5},
            ]
        }
        _validate_and_fix_vysledky(parsed, expected, "[T] ", expected_criteria_bodies=db_bodies)
        # Musíme mít všechny 3 kritéria
        assert len(parsed["vysledky"]) == 3
        nazvy = [v["nazev"] for v in parsed["vysledky"]]
        assert "Ztotožnění osoby – Tadeáš Kadlec" in nazvy
        assert "Ztotožnění osoby – Ivana Horáková" in nazvy  # placeholder přidán
        assert "Zákonná výzva" in nazvy
        horakova = next(v for v in parsed["vysledky"] if v["nazev"] == "Ztotožnění osoby – Ivana Horáková")
        assert horakova["_llm_omitted"] is True
        assert horakova["body"] == 0
        # skóre: Kadlec(3) + výzva(5) = 8
        assert parsed["celkove_skore"] == 8

    def test_output_sorted_by_original_order(self):
        """Model vrátí kritéria v jiném pořadí než jsou zadána → výstup musí být seřazen
        podle expected_criteria_names, aby frontend zobrazil 1. kritérium jako první."""
        expected = ["Zákonná výzva", "Ztotožnění osoby", "Eskorta osoby"]
        # Model vrátil v opačném pořadí
        parsed = {
            "vysledky": [
                {"nazev": "Eskorta osoby",    "splneno": False, "body": 0},
                {"nazev": "Ztotožnění osoby", "splneno": True,  "body": 3},
                {"nazev": "Zákonná výzva",    "splneno": True,  "body": 5},
            ]
        }
        _validate_and_fix_vysledky(parsed, expected, "[T] ")
        result_nazvy = [v["nazev"] for v in parsed["vysledky"]]
        assert result_nazvy == ["Zákonná výzva", "Ztotožnění osoby", "Eskorta osoby"]

    def test_missing_placeholder_inserted_at_correct_position(self):
        """Chybějící kritérium (placeholder) musí být na svém původním místě,
        ne naskládané na konci — jinak by frontend zobrazil čísla špatně."""
        expected = ["Zákonná výzva", "Ztotožnění osoby", "Eskorta osoby"]
        # Model vynechal "Ztotožnění osoby"
        parsed = {
            "vysledky": [
                {"nazev": "Eskorta osoby",  "splneno": True, "body": 2},
                {"nazev": "Zákonná výzva",  "splneno": True, "body": 5},
            ]
        }
        _validate_and_fix_vysledky(parsed, expected, "[T] ")
        result_nazvy = [v["nazev"] for v in parsed["vysledky"]]
        # Ztotožnění osoby musí být na pozici 1 (index 1), ne na konci
        assert result_nazvy == ["Zákonná výzva", "Ztotožnění osoby", "Eskorta osoby"]
        assert parsed["vysledky"][1].get("_llm_omitted") is True

    def test_merge_score_ignores_failed_criteria(self):
        """Regrese: _merge_chunk_results sčítal body bez ohledu na splneno."""
        chunk1 = {
            "identita": {"jmeno": "Jan", "prijmeni": "Novák"},
            "vysledky": [
                {"nazev": "A", "splneno": True,  "body": 3},
                {"nazev": "B", "splneno": False, "body": 2},
            ]
        }
        chunk2 = {
            "identita": {},
            "vysledky": [
                {"nazev": "C", "splneno": True,  "body": 1},
                {"nazev": "D", "splneno": False, "body": 1},
            ]
        }
        merged = _merge_chunk_results([chunk1, chunk2])
        assert merged["celkove_skore"] == 4  # jen A+C
        b = next(v for v in merged["vysledky"] if v["nazev"] == "B")
        assert b["body"] == 0


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

    def test_25_criteria_gives_5_chunks_not_9_v399(self):
        # Regression: legacy parser ukládal popis s trailing delimiter → 50 bloků místo 25
        # a criteria_str pak generoval 9 chunků místo 5. Ověřujeme, že clean popis dává 5.
        items = [
            f"**{i}. Kritérium: K{i}**\nPopis kritéria {i} bez delimiteru\nBodů za splnění: 1"
            for i in range(1, 26)
        ]
        markdown = f"\n\n{CRITERIA_DELIMITER}\n\n".join(items)
        chunks = _split_criteria_chunks(markdown, chunk_size=6)
        # ceil(25/6) = 5
        assert len(chunks) == 5, f"Očekáváno 5 chunků, dostali jsme {len(chunks)}"


# ---------------------------------------------------------------------------
# _merge_chunk_results
# ---------------------------------------------------------------------------

class TestMergeChunkResults:
    def test_merges_vysledky_from_multiple_chunks(self):
        # splneno=True required for body to count (normalizace: nesplněné = 0)
        chunk1 = {"identita": {"jmeno": "Jan"}, "vysledky": [
            {"nazev": "A", "splneno": True, "body": 5},
            {"nazev": "B", "splneno": True, "body": 3}
        ]}
        chunk2 = {"identita": {}, "vysledky": [
            {"nazev": "C", "splneno": True, "body": 2}
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
        # v3.9.10: Body se extrahují POUZE z `**Bodová hodnota:** N` (lektorův formát z UI).
        markdown = (
            "**1. Kritérium: Zákonná výzva**\n* **Bodová hodnota:** 5\nOvěř, zda..."
            f"\n\n{CRITERIA_DELIMITER}\n\n"
            "**2. Kritérium: Eskorta osoby**\n* **Bodová hodnota:** 3\nHledej v textu..."
        )
        result = parse_criteria_markdown(markdown)
        assert len(result) == 2
        assert result[0]["nazev"] == "Zákonná výzva"
        assert result[0]["body"] == 5
        assert result[1]["nazev"] == "Eskorta osoby"

    def test_parses_legacy_format_without_delimiter(self):
        markdown = (
            "**1. Kritérium: Zákonná výzva**\n* **Bodová hodnota:** 5\nOvěř...\n\n"
            "**2. Kritérium: Eskorta osoby**\n* **Bodová hodnota:** 3\nHledej..."
        )
        result = parse_criteria_markdown(markdown)
        assert len(result) == 2
        assert result[0]["nazev"] == "Zákonná výzva"

    def test_extracts_default_body_when_not_specified(self):
        markdown = "**1. Kritérium: Test**\nPopis bez bodů"
        result = parse_criteria_markdown(markdown)
        assert len(result) == 1
        assert result[0]["body"] == 1

    def test_filters_out_scenario_header_block_v3910(self):
        # v3.9.10: Markdown často začíná hlavičkou scénáře (MS info, max body, atd.).
        # Parser tento blok dříve mylně ukládal jako 26. kritérium s body=25.
        # Po opravě jsou akceptovány POUZE bloky s validním headerem `**N. Kritérium:**`.
        markdown = (
            "**HODNOTÍCÍ KRITÉRIA (Formát Markdown)**\n"
            "**MODELOVÁ SITUACE: č. 2 – Vstup do obydlí**\n"
            "**Maximální možný počet bodů: 25**\n"
            f"\n\n{CRITERIA_DELIMITER}\n\n"
            "**1. Kritérium: Kdo vyslal hlídku**\n* **Bodová hodnota:** 1\n* Popis"
            f"\n\n{CRITERIA_DELIMITER}\n\n"
            "**2. Kritérium: Eskorta osoby**\n* **Bodová hodnota:** 1\n* Popis"
        )
        result = parse_criteria_markdown(markdown)
        assert len(result) == 2, f"Očekáváno 2 kritéria, dostali jsme {len(result)}: {[r['nazev'] for r in result]}"
        assert all("Kritéri" not in r["nazev"][:8] or "HODNOTÍ" not in r["nazev"] for r in result)
        assert result[0]["nazev"] == "Kdo vyslal hlídku"
        assert result[1]["nazev"] == "Eskorta osoby"

    def test_body_only_from_explicit_field_v3910(self):
        # v3.9.10: Body se smí extrahovat POUZE z `**Bodová hodnota:** N`.
        # Dříve regex chytal náhodné číslice ("3 části", "Maximální 25 bodů" atd.).
        markdown = (
            "**1. Kritérium: Citace zákonné výzvy**\n"
            "* **Bodová hodnota:** 1\n"
            "* Popis: musí obsahovat 3 části (Jménem zákona, pokyn, následek). "
            "Maximálně 25 bodů celého scénáře."
        )
        result = parse_criteria_markdown(markdown)
        assert len(result) == 1
        # Body MUSÍ být 1 z explicitního pole, ne 3 ani 25 z volného textu
        assert result[0]["body"] == 1, f"Body má být 1, dostali jsme {result[0]['body']}"

    def test_body_default_1_when_no_explicit_field_v3910(self):
        markdown = "**1. Kritérium: Test**\n* Popis bez explicitního body pole"
        result = parse_criteria_markdown(markdown)
        assert len(result) == 1
        assert result[0]["body"] == 1

    def test_strips_trailing_delimiter_from_popis_v399(self):
        # v3.9.9: Legacy parser ukládal delimiter na konci popis (byl součástí bloku
        # v markdown_content mezi dvěma kritérii). Po opravě musí popis delimiter neobsahovat.
        markdown = (
            "**1. Kritérium: Zákonná výzva**\nOvěř, zda...\nBodů za splnění: 5"
            f"\n\n{CRITERIA_DELIMITER}\n\n"
            "**2. Kritérium: Eskorta osoby**\nHledej...\nBodů za splnění: 3"
        )
        result = parse_criteria_markdown(markdown)
        assert len(result) == 2
        for r in result:
            assert CRITERIA_DELIMITER not in r["popis"], f"Delimiter found in popis of '{r['nazev']}'"


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
