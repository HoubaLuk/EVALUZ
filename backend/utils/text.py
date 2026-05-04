"""Pomocné funkce pro práci s textem a názvy souborů."""
import re


_FILENAME_NOISE_RE = re.compile(r'(?i)\b(?:úz|uz|vtos|sluz|hlaseni)\b')
_DASH_CLEANUP_RE = re.compile(r'[-_]+')


def clean_filename_to_display(filename: str) -> str:
    """Odstraní z názvu souboru (bez přípony) typické prefixové zkratky a nahradí pomlčky/podtržítka mezerami.

    Příklady:
      "uz_novak_jan"     → "novak jan"
      "VTOS-Horáková"    → "Horáková"
      "hlaseni-Beneš"    → "Beneš"
      "Procházka-Jan"    → "Procházka Jan"
    """
    base = filename.rsplit(".", 1)[0] if "." in filename else filename
    cleaned = _FILENAME_NOISE_RE.sub("", base)
    cleaned = _DASH_CLEANUP_RE.sub(" ", cleaned)
    return cleaned.strip()
