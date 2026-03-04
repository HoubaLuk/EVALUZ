import io
import os
import asyncio

async def extract_text(file_bytes: bytes, filename: str) -> str:
    """
    Vysoce výkonný a stabilní extraktor textu pro podporované formáty (.pdf, .docx, .rtf).
    Používá rychlé a spolehlivé knihovny.
    """
    ext = os.path.splitext(filename)[1].lower()
    extracted_text = ""
    
    try:
        # 1. DOCX (python-docx)
        if ext == '.docx':
            from docx import Document
            doc = Document(io.BytesIO(file_bytes))
            extracted_text = "\n".join([p.text for p in doc.paragraphs])
            return extracted_text
            
        # 2. PDF (PyMuPDF / fitz)
        if ext == '.pdf':
            import fitz # PyMuPDF
            doc = fitz.open(stream=file_bytes, filetype="pdf")
            text_parts = []
            for page in doc:
                text_parts.append(page.get_text())
            doc.close()
            extracted_text = "\n\n".join(text_parts)
            return extracted_text
            
        # 3. RTF (striprtf)
        if ext == '.rtf':
            from striprtf.striprtf import rtf_to_text
            rtf_content = file_bytes.decode('utf-8', errors='replace')
            extracted_text = rtf_to_text(rtf_content)
            return extracted_text
                
    except Exception as e:
        print(f"[DOC-PARSER] Chyba při parsování {filename} ({ext}): {e}")
        # Pokud parsování binárního souboru selže, NEVRACÍME binární smetí přes fallback
        if ext in ['.pdf', '.docx', '.rtf']:
            return ""
        
    # Finální fallback pouze pro textové soubory nebo neznámé formáty (pokud nejsou binární)
    if ext in ['.txt', '.csv', '.md', '.html']:
        try:
            return file_bytes.decode('utf-8', errors='replace')
        except:
            return ""
            
    return ""
