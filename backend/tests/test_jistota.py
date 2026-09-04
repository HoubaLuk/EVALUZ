"""Regresní testy pro pole `jistota` (ADR-029).

Model u každého kritéria vrací míru jistoty 1–5. Je to jeho TVRZENÍ o obtížnosti,
ne měření nejistoty — slouží lektorovi k triáži, kam se podívat nejdřív.

Server hodnotu normalizuje ze stejného důvodu jako `body` a `celkove_skore`: model
vrací občas řetězec, hodnotu mimo škálu, nebo pole vynechá úplně. Chybějící jistota
se vědomě NEDOPLŇUJE náhradním číslem — vymyšlený odhad by v UI vypadal stejně jako
skutečný a byl by horší než přiznané „neuvedeno".
"""
import logging
import sys
from pathlib import Path

import pytest

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from services.llm_engine import _normalize_jistota, _validate_and_fix_vysledky

EXPECTED = ["Ztotožnění osoby", "Poučení osoby"]
BODIES = {"Ztotožnění osoby": 1, "Poučení osoby": 1}


class TestNormalizeJistota:
    @pytest.mark.parametrize("raw,expected", [
        (3, 3),
        (1, 1),
        (5, 5),
        (4.0, 4),
        (3.6, 4),          # zaokrouhlení
        ("4", 4),          # model vrátí řetězec
        ("4/5", 4),        # nebo zlomek
        ("jistota 2", 2),
        (0, 1),            # mimo škálu → ořez
        (9, 5),
        (-3, 1),
    ])
    def test_valid_and_recoverable_values(self, raw, expected):
        assert _normalize_jistota(raw) == expected

    @pytest.mark.parametrize("raw", [None, "", "vysoká", {}, [], "n/a"])
    def test_unusable_values_become_none(self, raw):
        assert _normalize_jistota(raw) is None

    def test_bool_is_not_a_number(self):
        """`True` je v Pythonu podtyp int — nesmí projít jako jistota 1."""
        assert _normalize_jistota(True) is None
        assert _normalize_jistota(False) is None


class TestJistotaInPipeline:
    def _parsed(self, jistota_values):
        return {
            "vysledky": [
                {"nazev": name, "splneno": True, "body": 1, "jistota": j}
                for name, j in zip(EXPECTED, jistota_values)
            ]
        }

    def test_values_are_normalized_in_place(self):
        parsed = self._parsed(["5", 99])
        _validate_and_fix_vysledky(parsed, EXPECTED, "", BODIES)
        assert [v["jistota"] for v in parsed["vysledky"]] == [5, 5]

    def test_missing_field_becomes_none_not_a_guess(self):
        parsed = {"vysledky": [{"nazev": n, "splneno": True, "body": 1} for n in EXPECTED]}
        _validate_and_fix_vysledky(parsed, EXPECTED, "", BODIES)
        assert all(v["jistota"] is None for v in parsed["vysledky"])

    def test_omitted_criterion_placeholder_gets_lowest_confidence(self):
        """Kritérium, ke kterému se model nevyjádřil, musí spadnout do filtru pozornosti."""
        parsed = {"vysledky": [{"nazev": EXPECTED[0], "splneno": True, "body": 1, "jistota": 5}]}
        _validate_and_fix_vysledky(parsed, EXPECTED, "", BODIES)

        placeholder = next(v for v in parsed["vysledky"] if v.get("_llm_omitted"))
        assert placeholder["jistota"] == 1

    def test_missing_jistota_is_logged(self, caplog):
        """Tichá ignorace nového pole by vypadala stejně jako „vše je jednoznačné"."""
        parsed = {"vysledky": [{"nazev": n, "splneno": True, "body": 1} for n in EXPECTED]}
        with caplog.at_level(logging.WARNING, logger="evaluz.llm"):
            _validate_and_fix_vysledky(parsed, EXPECTED, "", BODIES)
        assert any("jistota" in r.message for r in caplog.records)

    def test_complete_jistota_does_not_warn(self, caplog):
        parsed = self._parsed([5, 4])
        with caplog.at_level(logging.WARNING, logger="evaluz.llm"):
            _validate_and_fix_vysledky(parsed, EXPECTED, "", BODIES)
        assert not any("jistota" in r.message for r in caplog.records)

    def test_score_ignores_jistota(self):
        """Jistota je informace pro člověka — nesmí ovlivnit body ani skóre."""
        low = self._parsed([1, 1])
        high = self._parsed([5, 5])
        _validate_and_fix_vysledky(low, EXPECTED, "", BODIES)
        _validate_and_fix_vysledky(high, EXPECTED, "", BODIES)
        assert low["celkove_skore"] == high["celkove_skore"] == 2
