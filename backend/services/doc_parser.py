"""
MODUL: PARSER DOKUMENTŮ (DOC PARSER)
Tento modul má na starosti "přečtení" nahraných souborů. Převádí binární data
z formátů PDF, Word (DOCX) a RTF do čistého textu, který následně analyzuje AI.
"""

import io
import os
import re


def _cleanup_text(text: str) -> str:
    """
    Sdílené čištění extrahovaného textu pro všechny formáty.
    Cíl: odstranit vše, co neznamená obsah, a snížit počet tokenů odesílaných do LLM.

    Kroky:
    1. Řídící znaky (C0 oblast kromě tabulátoru a LF) — artefakty parsování
    2. Tabulátory → mezera, trailing whitespace
    3. Dekorativní letter-spacing — "Ú ř e d n í" → "Úřední"
       (PDF artifact: nadpis s mezerou mezi každým znakem)
    4. Vícenásobné mezery uvnitř řádku → jedna mezera
    5. Vícenásobné prázdné řádky → jeden prázdný řádek (odstavec)
    6. Trim celého textu
    """
    # 1. Řídící znaky (vynecháme \t=0x09, \n=0x0a, \r=0x0d)
    text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', text)
    # 2. Tabulátor → mezera, trim řádků
    lines = [line.replace('\t', ' ').rstrip() for line in text.splitlines()]
    # 3. Dekorativní letter-spacing: řádek složený výhradně z jednoznakových tokenů
    #    (PDF artifact nadpisu "Ú ř e d n í z á z n a m") — odstraníme jej celý.
    #    Nadpis dokumentu nepřináší modelu žádnou informaci navíc.
    collapsed = []
    for line in lines:
        tokens = line.split()
        if len(tokens) >= 4 and all(len(t) == 1 for t in tokens):
            continue  # přeskočíme dekorativní řádek
        collapsed.append(line)
    # 4. Vícenásobné mezery uvnitř řádku
    collapsed = [re.sub(r' {2,}', ' ', line) for line in collapsed]
    # 5. Maximálně jeden prázdný řádek mezi odstavci
    text = re.sub(r'\n{3,}', '\n\n', '\n'.join(collapsed))
    return text.strip()


async def extract_text(file_bytes: bytes, filename: str) -> str:
    """
    HLAVNÍ FUNKCE PRO VYTĚŽOVÁNÍ TEXTU.
    Podle přípony souboru zvolí správnou knihovnu a pokusí se z ní dostat textový obsah.
    Všechny formáty projdou sdíleným _cleanup_text() pro normalizaci a úsporu tokenů.
    """
    ext = os.path.splitext(filename)[1].lower()

    try:
        # 1. MICROSOFT WORD (DOCX)
        if ext == '.docx':
            from docx import Document
            doc = Document(io.BytesIO(file_bytes))
            raw = "\n".join(p.text for p in doc.paragraphs)
            return _cleanup_text(raw)

        # 2. ADOBE PDF
        # PyMuPDF (fitz) — rychlé a stabilní pro digitální textové soubory.
        # get_text("text") vrací plain text bez souřadnic a metadat.
        if ext == '.pdf':
            import fitz
            doc = fitz.open(stream=file_bytes, filetype="pdf")
            pages = [page.get_text("text") for page in doc]
            doc.close()
            raw = "\n\n".join(pages)
            return _cleanup_text(raw)

        # 3. RICH TEXT FORMAT (RTF)
        if ext == '.rtf':
            from striprtf.striprtf import rtf_to_text
            rtf_content = file_bytes.decode('utf-8', errors='replace')
            raw = rtf_to_text(rtf_content)
            return _cleanup_text(raw)

        # 4. PLAIN TEXT a podobné
        if ext in ('.txt', '.csv', '.md', '.html'):
            raw = file_bytes.decode('utf-8', errors='replace')
            return _cleanup_text(raw)

    except Exception as e:
        print(f"[DOC-PARSER] Chyba při parsování {filename} ({ext}): {e}")
        return ""

    return ""
