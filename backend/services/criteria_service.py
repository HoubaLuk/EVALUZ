import re

# Unikátní oddělovač kritérií (od v3.9.6) — synchronizováno s
# `services.llm_engine.CRITERIA_DELIMITER`. Definujeme zde lokálně, abychom se vyhnuli
# cross-modulové cyklické závislosti při importu.
CRITERIA_DELIMITER = "#############"


def parse_criteria_markdown(markdown_text: str) -> list:
    """
    Vezme souvislý Markdown z UI a rozseká ho na jednotlivé objekty.
    Zahodí úvodní balast.
    Vrací list dictů: [{"nazev": str, "popis": str, "body": int}, ...]
    """
    results = []

    # 2. ÚKLID BALASTU
    text = markdown_text.strip()

    # 1. SPLITTER — primárně podle delimiteru `#############` (od v3.9.6),
    #    fallback na regex header `**N. Kritérium:` (legacy data).
    if CRITERIA_DELIMITER in text:
        blocks = [b for b in text.split(CRITERIA_DELIMITER) if b.strip()]
    else:
        text_with_newline = '\n' + text
        # Najdi první reálný začátek kritéria, abychom ořízli balast.
        start_match = re.search(r'\n\**1\.\s*Kritérium:', text_with_newline)
        if start_match:
            text = text_with_newline[start_match.start():].strip()
        blocks = re.split(r'\n(?=\**\d+\.\s*Kritérium:)', '\n' + text)
        
    for block in blocks:
        block = block.strip()
        if not block:
            continue
            
        # Extrakce názvu
        # Vezmeme úplně první řádek bloku, odstraníme hvězdičky a pak ořízneme začátek
        lines = block.split('\n')
        first_line = lines[0].replace('*', '').strip()
        nazev = re.sub(r'^\d+\.\s*(Kritérium)?\s*:?\s*', '', first_line).strip()
        if not nazev:
            nazev = "Neznámé kritérium"
            
        # 4. AUTOMATICKÉ BODY
        # Default nastaven na 1, pokud není explicitně nalezen jiný
        body = 1
        body_match = re.search(r'(?:[Bb]od[^0-9]*?)([0-9]+)|([0-9]+)\s*(?:bod|body|bodů|b\.)', block)
        if body_match:
            found = body_match.group(1) or body_match.group(2)
            if found:
                try:
                    body = int(found)
                except:
                    pass
        
        # Popis je zbytek textu, abychom zbytečně neduplikovali název
        popis = '\n'.join(lines[1:]).strip()
        if not popis:
            popis = nazev

        
        results.append({
            "nazev": nazev,
            "popis": popis,
            "body": body
        })
        
    return results
