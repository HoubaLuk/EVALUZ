"""
MODUL: PARSER DOKUMENTŮ (DOC PARSER)
Tento modul má na starosti "přečtení" nahraných souborů. Převádí binární data
z formátů PDF, Word (DOCX) a RTF do čistého textu, který následně analyzuje AI.
"""

import io
import os
import asyncio

async def extract_text(file_bytes: bytes, filename: str) -> str:
    """
    HLAVNÍ FUNKCE PRO VYTĚŽOVÁNÍ TEXTU.
    Podle přípony souboru zvolí správnou knihovnu a pokusí se z ní dostat textový obsah.
    """
    ext = os.path.splitext(filename)[1].lower()
    extracted_text = ""
    
    try:
        # 1. MICROSOFT WORD (DOCX)
        # Používáme knihovnu python-docx. Dokument procházíme po odstavcích.
        if ext == '.docx':
            from docx import Document
            doc = Document(io.BytesIO(file_bytes))
            extracted_text = "\n".join([p.text for p in doc.paragraphs])
            return extracted_text
            
        # 2. ADOBE PDF
        # Používáme knihovnu PyMuPDF (fitz), která je extrémně rychlá a stabilní.
        # Procházíme dokument stránku po stránce.
        if ext == '.pdf':
            import fitz # PyMuPDF
            doc = fitz.open(stream=file_bytes, filetype="pdf")
            text_parts = []
            for page in doc:
                text_parts.append(page.get_text())
            doc.close()
            # Spojíme stránky dvěma odstavci pro lepší přehlednost.
            extracted_text = "\n\n".join(text_parts)
            return extracted_text
            
        # 3. RICH TEXT FORMAT (RTF)
        # Starší formát, který se stále vyskytuje. Text čistíme od RTF značek.
        if ext == '.rtf':
            from striprtf.striprtf import rtf_to_text
            # Dekódujeme binární data na text s tolerancí chyb (replace).
            rtf_content = file_bytes.decode('utf-8', errors='replace')
            extracted_text = rtf_to_text(rtf_content)
            return extracted_text
                
    except Exception as e:
        # Pokud parsování selže, zalogujeme chybu a vrátíme prázdný řetězec.
        # Důležité: Nikdy nevracíme binární data do AI promptu, jinak by AI vracela nesmysly.
        print(f"[DOC-PARSER] Chyba při parsování {filename} ({ext}): {e}")
        if ext in ['.pdf', '.docx', '.rtf']:
            return ""
        
    # Finální fallback: Pokud jde o obyčejný text/markdown, prostě ho dekódujeme.
    if ext in ['.txt', '.csv', '.md', '.html']:
        try:
            return file_bytes.decode('utf-8', errors='replace')
        except:
            return ""
            
    return ""
