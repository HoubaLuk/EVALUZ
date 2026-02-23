import io
from docx import Document
from striprtf.striprtf import rtf_to_text
import fitz  # PyMuPDF

def extract_text_from_docx(file_bytes: bytes) -> str:
    """Extrahuje text z .docx souboru."""
    doc = Document(io.BytesIO(file_bytes))
    return "\n".join([para.text for para in doc.paragraphs])

def extract_text_from_rtf(file_bytes: bytes) -> str:
    """Extrahuje čistý text z .rtf souboru."""
    # RTF is typically encoded in ANSI/cp1250/utf-8, decode gracefully
    try:
        text_content = file_bytes.decode('utf-8')
    except UnicodeDecodeError:
        text_content = file_bytes.decode('cp1250', errors='replace')
    return rtf_to_text(text_content)

def extract_text_from_pdf(file_bytes: bytes) -> str:
    """Extrahuje čistý text z digitálního .pdf (ne OCR)."""
    document = fitz.open(stream=file_bytes, filetype="pdf")
    text = ""
    for page in document:
        text += page.get_text() + "\n"
    return text

def extract_text(file_bytes: bytes, filename: str) -> str:
    """
    Univerzální dispatcher pro extrakci textu.
    Podle přípony zavolá příslušný pod-parser.
    """
    lower_name = filename.lower()
    
    if lower_name.endswith('.docx'):
        return extract_text_from_docx(file_bytes)
    elif lower_name.endswith('.rtf'):
        return extract_text_from_rtf(file_bytes)
    elif lower_name.endswith('.pdf'):
        return extract_text_from_pdf(file_bytes)
    else:
        raise ValueError(f"Nepodporovaný formát souboru: {filename}. Povoleno je pouze .docx, .rtf a .pdf")
