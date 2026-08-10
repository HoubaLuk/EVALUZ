"""Regresní testy pro parsování kritérií a přiřazení výsledků LLM (ADR-019).

Pokrytí:
- `_canonicalize_criterion_name` slévá kritéria lišící se jen jménem osoby — což je
  v pořádku (heuristika proti „personalizaci" názvu modelem), ale výběr slotu pak nesmí
  být poziční. Sada MS2 „Vstup do obydlí" má tři takové dvojice (kritéria 6+12, 7+13, 8+14).
- `parse_criteria_markdown` nad strukturou, jakou lektoři reálně píší v UI: hlavička
  scénáře, kritéria oddělená `---`, bodová hodnota v poli `**Bodová hodnota:** N`.
"""
import logging

import pytest

from services.criteria_service import parse_criteria_markdown
from services.llm_engine import _canonicalize_criterion_name, _validate_and_fix_vysledky


HORAKOVA = "Ustanovení § a zákona – prokázání totožnosti – Ivana Horáková"
KADLEC = "Ustanovení § a zákona – prokázání totožnosti – Tadeáš Kadlec"
EXPECTED = [HORAKOVA, KADLEC]
BODIES = {HORAKOVA: 1, KADLEC: 1}


# ---------------------------------------------------------------------------
# Přiřazení výsledků ke kritériím
# ---------------------------------------------------------------------------

class TestCriterionMatching:
    def test_person_variants_share_canonical_base(self):
        """Předpoklad celého problému: kanonizace obě varianty slije v jednu."""
        assert _canonicalize_criterion_name(HORAKOVA) == _canonicalize_criterion_name(KADLEC)

    def test_swapped_person_variants_map_to_correct_criteria(self):
        """Model vrátí obě varianty v OPAČNÉM pořadí, než jsou v promptu.

        Dřív rozhodoval `pop(0)`, takže odůvodnění Kadlece se tiše uložilo pod Horákovou
        a naopak. Skóre přitom zůstalo správné, takže si toho nikdo nemohl všimnout.
        """
        parsed = {"vysledky": [
            {"nazev": KADLEC, "splneno": True, "oduvodneni": "kadlec"},
            {"nazev": HORAKOVA, "splneno": True, "oduvodneni": "horakova"},
        ]}

        _validate_and_fix_vysledky(parsed, EXPECTED, "", BODIES)

        by_name = {v["nazev"]: v["oduvodneni"] for v in parsed["vysledky"]}
        assert by_name[KADLEC] == "kadlec"
        assert by_name[HORAKOVA] == "horakova"

    def test_in_order_person_variants_still_map_correctly(self):
        """Pořadí podle promptu musí fungovat dál — to je běžný případ."""
        parsed = {"vysledky": [
            {"nazev": HORAKOVA, "splneno": True, "oduvodneni": "horakova"},
            {"nazev": KADLEC, "splneno": False, "oduvodneni": "kadlec"},
        ]}

        _validate_and_fix_vysledky(parsed, EXPECTED, "", BODIES)

        by_name = {v["nazev"]: v for v in parsed["vysledky"]}
        assert by_name[HORAKOVA]["oduvodneni"] == "horakova"
        assert by_name[HORAKOVA]["body"] == 1
        assert by_name[KADLEC]["oduvodneni"] == "kadlec"
        assert by_name[KADLEC]["body"] == 0  # nesplněno → 0 bodů

    def test_single_slot_behaviour_is_unchanged(self):
        """Bez kolize (jediný slot) zůstává chování shodné s původním `pop(0)`."""
        names = ["Čas příjezdu hlídky na místo", "Označení místa události (adresa)"]
        parsed = {"vysledky": [
            {"nazev": "Označení místa události (adresa)", "splneno": True},
            {"nazev": "Čas příjezdu hlídky na místo", "splneno": True},
        ]}

        _validate_and_fix_vysledky(parsed, names, "", {n: 1 for n in names})

        assert sorted(v["nazev"] for v in parsed["vysledky"]) == sorted(names)
        assert parsed["celkove_skore"] == 2

    def test_ambiguous_assignment_warns(self, caplog):
        """Když přesná shoda chybí a slotů je víc, přiřazení se tipuje — musí to být slyšet."""
        parsed = {"vysledky": [
            {"nazev": "Ustanovení § a zákona – prokázání totožnosti – Jana Nováková",
             "splneno": True},
        ]}

        with caplog.at_level(logging.WARNING, logger="evaluz.llm"):
            _validate_and_fix_vysledky(parsed, EXPECTED, "", BODIES)

        assert any("Nejednoznačné přiřazení" in r.message for r in caplog.records)

    def test_missing_criterion_is_filled_as_placeholder(self):
        """Vynechané kritérium se doplní jako nesplněné — počet položek musí sedět."""
        parsed = {"vysledky": [{"nazev": HORAKOVA, "splneno": True}]}

        _validate_and_fix_vysledky(parsed, EXPECTED, "", BODIES)

        assert len(parsed["vysledky"]) == 2
        placeholder = [v for v in parsed["vysledky"] if v["nazev"] == KADLEC][0]
        assert placeholder["splneno"] is False
        assert placeholder.get("_llm_omitted") is True


# ---------------------------------------------------------------------------
# Parsování markdownu kritérií
# ---------------------------------------------------------------------------

MS2_MARKDOWN = """**HODNOTÍCÍ KRITÉRIA (Formát Markdown)**

**MODELOVÁ SITUACE: č. 2 – Vstup do obydlí, jiného prostoru a na pozemek**

**Maximální možný počet bodů: 3**

*(Pro každé kritérium platí bodová hodnota 1, pokud není uvedeno jinak.)*

---

**1. Kritérium:** Kdo vyslal hlídku na místo události
*   **Bodová hodnota:** 1
*   **Popis pro AI (Klíčová instrukce):** AI má ověřit, zda ÚZ obsahuje subjekt.
*   **Příklady správného splnění v ÚZ:**
    *   "Hlídka byla vyslána operačním střediskem KŘP."

---

**2. Kritérium:** Ustanovení § a zákona – prokázání totožnosti – Ivana Horáková
*   **Bodová hodnota:** 1
*   **Popis pro AI (Klíčová instrukce):** Výzva dle § 63 zák. č. 273/2008 Sb.

---

**3. Kritérium:** Ustanovení § a zákona – prokázání totožnosti – Tadeáš Kadlec
*   **Bodová hodnota:** 1
*   **Popis pro AI (Klíčová instrukce):** Výzva dle § 63 odst. 2 písm. e) ZOP.

---
"""


class TestCriteriaParser:
    def test_parses_all_criteria_and_skips_scenario_header(self):
        result = parse_criteria_markdown(MS2_MARKDOWN)

        assert len(result) == 3
        assert result[0]["nazev"] == "Kdo vyslal hlídku na místo události"
        # Hlavička scénáře ani "Maximální možný počet bodů" se nesmí stát kritériem.
        assert all("MODELOVÁ SITUACE" not in c["nazev"] for c in result)

    def test_reads_explicit_point_values(self):
        result = parse_criteria_markdown(MS2_MARKDOWN)
        assert [c["body"] for c in result] == [1, 1, 1]
        assert sum(c["body"] for c in result) == 3

    def test_descriptions_do_not_keep_trailing_horizontal_rule(self):
        """Splitter dělí před hlavičkou, takže `---` dřív zůstávalo na konci popisu."""
        result = parse_criteria_markdown(MS2_MARKDOWN)
        for criterion in result:
            assert not criterion["popis"].rstrip().endswith("---"), criterion["nazev"]

    def test_descriptions_keep_inner_dashes(self):
        """Ořez je kotvený na konec — pomlčky uvnitř popisu musí zůstat."""
        result = parse_criteria_markdown(MS2_MARKDOWN)
        assert "§ 63" in result[1]["popis"]

    def test_person_variants_are_parsed_as_separate_criteria(self):
        result = parse_criteria_markdown(MS2_MARKDOWN)
        names = [c["nazev"] for c in result]
        assert "Ustanovení § a zákona – prokázání totožnosti – Ivana Horáková" in names
        assert "Ustanovení § a zákona – prokázání totožnosti – Tadeáš Kadlec" in names

    def test_missing_point_field_defaults_to_one_and_warns(self, caplog):
        """Tiché dosazení 1 bodu měnilo maximum skóre bez jakékoli stopy."""
        markdown = (
            "**1. Kritérium:** Kritérium bez bodového pole\n"
            "*   **Popis pro AI:** Něco.\n"
        )

        with caplog.at_level(logging.WARNING, logger="evaluz.criteria"):
            result = parse_criteria_markdown(markdown)

        assert result[0]["body"] == 1
        assert any("Bodová hodnota" in r.message for r in caplog.records)

    def test_nested_numbered_lists_do_not_split_criteria(self):
        """Reálná sada MS2 má uvnitř popisů číslované podseznamy (kritérium 17 „3 části",
        kritérium 21 „1. Jakým způsobem") i odsazené pod-odrážky s § (kritérium 12).

        Splitter dělí na `\\n(?=\\**\\d+\\.\\s*Kritérium:)`, takže vyžaduje slovo
        „Kritérium:" za číslem — tyhle konstrukce ho nesmí rozseknout. Kdyby ano,
        z jednoho kritéria by vznikla dvě useknutá a lektor by to poznal až podle skóre.
        """
        markdown = (
            "**1. Kritérium:** Citace zákonné výzvy (musí obsahovat 3 části)\n"
            "*   **Bodová hodnota:** 1\n"
            "*   **Popis pro AI:** Výzva musí obsahovat všechny tři povinné části:\n"
            "        1.  Explicitní frázi **\"Jménem zákona\"**.\n"
            "        2.  Co má osoba konat nebo čeho se zdržet.\n"
            "        3.  Následek neuposlechnutí výzvy.\n"
            "\n---\n\n"
            "**2. Kritérium:** Ustanovení § a zákona – prokázání totožnosti – Tadeáš Kadlec\n"
            "*   **Bodová hodnota:** 1\n"
            "*   **Popis pro AI:** Očekává se citace jednoho z ustanovení:\n"
            "        *   § 63 odst. 2 písm. a) ZOP (podezřelý)\n"
            "        *   § 63 odst. 2 písm. e) ZOP (odpovídá popisu hledané osoby)\n"
            "\n---\n\n"
            "**3. Kritérium:** Eskorta osoby\n"
            "*   **Bodová hodnota:** 1\n"
            "*   **Popis pro AI:** Musí být uvedeno **1. Jakým způsobem**, "
            "**2. Za jakým účelem** a **3. Kam**.\n"
            "\n---\n"
        )

        result = parse_criteria_markdown(markdown)

        assert len(result) == 3
        assert [c["body"] for c in result] == [1, 1, 1]
        # Podseznam zůstal celý uvnitř popisu prvního kritéria.
        assert "Jménem zákona" in result[0]["popis"]
        assert "Následek neuposlechnutí" in result[0]["popis"]
        # Odsazené pod-odrážky s § taky.
        assert "písm. e) ZOP" in result[1]["popis"]
        # Inline číslování v souvislém textu splitter neruší.
        assert result[2]["nazev"] == "Eskorta osoby"

    def test_malformed_header_is_reported(self, caplog):
        """Překlep ve formátu hlavičky znamená ztracené kritérium — musí být slyšet."""
        markdown = (
            "**1. Kritérium:** Správně zapsané kritérium\n"
            "*   **Bodová hodnota:** 1\n"
            "\n#############\n\n"
            "**Kritérium 2:** Špatně zapsaná hlavička\n"
            "*   **Bodová hodnota:** 1\n"
        )

        with caplog.at_level(logging.WARNING, logger="evaluz.criteria"):
            result = parse_criteria_markdown(markdown)

        assert len(result) == 1
        assert any("hlavička neodpovídá formátu" in r.message for r in caplog.records)
