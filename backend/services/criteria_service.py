import logging
import re

logger = logging.getLogger("evaluz.criteria")

# Unikátní oddělovač kritérií (od v3.9.6) — synchronizováno s
# `services.llm_engine.CRITERIA_DELIMITER`. Definujeme zde lokálně, abychom se vyhnuli
# cross-modulové cyklické závislosti při importu.
CRITERIA_DELIMITER = "#############"

# v3.9.10: Přesný regex na header kritéria — `**N. Kritérium:** ...` nebo `**N. Kritérium: ...**`.
# Bloky bez tohoto headeru jsou IGNOROVÁNY (typicky markdown hlavička scénáře, MS info atd.).
_CRITERION_HEADER_RE = re.compile(r'^\s*\*{0,2}\s*(\d+)\.\s*Krit[eé]rium\s*:?\s*\*{0,2}\s*(.*?)\s*\*{0,2}\s*$', re.IGNORECASE)

# v3.9.10: Body extraktor — POUZE z explicitního pole "Bodová hodnota: N" (case-insensitive).
# Žádné fallbacky na náhodné číslice z popisu — to bylo zdrojem chyb (chytalo "3 části", "Maximální 25 bodů" atd.).
_BODY_EXPLICIT_RE = re.compile(r'\*{0,2}\s*Bodov[áa]\s+hodnota\s*:?\s*\*{0,2}\s*(\d+)', re.IGNORECASE)


def parse_criteria_markdown(markdown_text: str) -> list:
    """
    Rozseká markdown z UI na seznam kritérií.

    Bloky se rozdělí podle `#############` (primárně, od v3.9.6) nebo přes regex
    `**N. Kritérium:` (legacy fallback).

    KRITICKÉ: Blok je akceptován jako kritérium POUZE tehdy, pokud první řádek vyhovuje
    pattern-u `**N. Kritérium: ...**`. Tím se filtruje úvodní hlavička scénáře, kterou
    parser dříve mylně ukládal jako 26. kritérium (v3.9.10 fix).

    Bodová hodnota se extrahuje POUZE z explicitního pole `**Bodová hodnota:** N`.
    Pokud chybí, default = 1. Žádné fallbacky na číslice z popisu (v3.9.10 fix).

    Vrací: [{"nazev": str, "popis": str, "body": int}, ...]
    """
    results = []
    text = markdown_text.strip()

    # SPLITTER — primárně delimiter, fallback regex header.
    if CRITERIA_DELIMITER in text:
        blocks = [b for b in text.split(CRITERIA_DELIMITER) if b.strip()]
    else:
        text_with_newline = '\n' + text
        start_match = re.search(r'\n\**1\.\s*Kritérium:', text_with_newline)
        if start_match:
            text = text_with_newline[start_match.start():].strip()
        blocks = re.split(r'\n(?=\**\d+\.\s*Kritérium:)', '\n' + text)

    for block in blocks:
        block = block.strip()
        if not block:
            continue

        lines = block.split('\n')
        first_line = lines[0].strip()

        # FILTR: pouze bloky s validním headerem `**N. Kritérium:**`
        header_match = _CRITERION_HEADER_RE.match(first_line)
        if not header_match:
            # Hlavička scénáře, MS popis, prázdné odstavce — ignorujeme.
            # Blok, který se o hlavičku POKOUŠÍ (obsahuje slovo „Kritérium"), ale neprošel,
            # je ale podezřelý: nejspíš překlep ve formátu, kterým lektor tiše přijde
            # o celé kritérium. Takový případ musí být hlasitý.
            preview = first_line[:60].replace('\n', ' ')
            if 'kritérium' in block[:200].lower() or 'kriterium' in block[:200].lower():
                logger.warning(
                    f"[CRITERIA] Blok přeskočen — hlavička neodpovídá formátu "
                    f"`**N. Kritérium: název**`: '{preview}…'"
                )
            else:
                logger.info(f"[CRITERIA] Blok bez hlavičky kritéria přeskočen: '{preview}…'")
            continue

        nazev = header_match.group(2).strip().strip('*').strip()
        if not nazev:
            # Header bez názvu — také ignorujeme (defenzivní).
            logger.warning(f"[CRITERIA] Hlavička bez názvu kritéria přeskočena: '{first_line[:60]}…'")
            continue

        # Popis = zbytek textu (bez prvního řádku). Smaž delimiter, pokud zbyl.
        popis = re.sub(r'\s*#############\s*', ' ', '\n'.join(lines[1:])).strip()
        # Splitter dělí PŘED hlavičkou dalšího kritéria, takže markdown oddělovač `---`
        # zůstane viset na konci popisu toho předchozího. Kotveno na konec, aby to
        # nepoškodilo popisné pomlčky uvnitř textu.
        popis = re.sub(r'\n\s*-{3,}\s*$', '', popis).strip()
        if not popis:
            popis = nazev

        # Body — POUZE z explicitního "Bodová hodnota: N" pole. Default 1.
        body = 1
        body_match = _BODY_EXPLICIT_RE.search(block)
        if body_match:
            try:
                body = int(body_match.group(1))
            except (ValueError, TypeError):
                logger.warning(
                    f"[CRITERIA] '{nazev}': hodnotu '{body_match.group(1)}' nelze převést "
                    f"na číslo — použit default 1 bod."
                )
        else:
            # Tiché dosazení 1 bodu bývalo neviditelné: max. skóre se změnilo a UI
            # i logy hlásily OK. Pole se musí jmenovat přesně `**Bodová hodnota:** N`.
            logger.warning(
                f"[CRITERIA] '{nazev}': chybí pole `**Bodová hodnota:** N` "
                f"— použit default 1 bod."
            )

        results.append({
            "nazev": nazev,
            "popis": popis,
            "body": body
        })

    logger.info(
        f"[CRITERIA] Rozparsováno {len(results)} kritérií, "
        f"maximum {sum(c['body'] for c in results)} bodů."
    )
    return results
