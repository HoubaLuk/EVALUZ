import re

def parse_criteria_markdown(markdown_text: str) -> list:
    """
    Vezme souvislý Markdown z UI a rozseká ho na jednotlivé objekty.
    Zahodí úvodní balast.
    Vrací list dictů: [{"nazev": str, "popis": str, "body": int}, ...]
    """
    results = []
    
    # 2. ÚKLID BALASTU
    text = markdown_text.strip()
    text_with_newline = '\n' + text
    
    # Najdi první reálný začátek kritéria (1. Kritérium s nebo bez hvězdiček), abychom ořízli balast
    start_match = re.search(r'\n\**1\.\s*Kritérium:', text_with_newline)
    if start_match:
        text = text_with_newline[start_match.start():].strip()
    
    # 1. MARKDOWN SPLITTER
    # Split podle: \n následované volitelnými hvězdičkami, číslem, tečkou, mezerou a "Kritérium:"
    blocks = re.split(r'\n(?=\**\d+\.\s*Kritérium:)', '\n' + text)
        
    for block in blocks:
        block = block.strip()
        if not block:
            continue
            
        # Extrakce názvu
        # Vezmeme úplně první řádek bloku, odstraníme hvězdičky a pak ořízneme začátek
        first_line = block.split('\n')[0].replace('*', '').strip()
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
        
        # Popis je zbytek textu
        popis = block.strip()
        
        results.append({
            "nazev": nazev,
            "popis": popis,
            "body": body
        })
        
    return results
