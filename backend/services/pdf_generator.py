import os
import io
import json
from datetime import datetime
from fpdf import FPDF
from sqlalchemy.orm import Session
from models.db_models import StudentEvaluation, Lecturer

# Paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PUBLIC_DIR = os.path.join(BASE_DIR, "public")
LOGO_PATH = os.path.join(PUBLIC_DIR, "ÚPVSP bez okrajů.jpg")

# Rank abbreviation mapping logic
def get_rank_abbr(full_rank: str) -> str:
    mapping = {
        "referent": "rtn.",
        "vrchní referent": "stržm.",
        "asistent": "nstržm.",
        "vrchní asistent": "pprap.",
        "inspektor": "prap.", 
        "komisař": "por.",
        "vrchní komisař": "kpt."
    }
    return mapping.get(full_rank.lower().strip(), full_rank)

# Placeholder prozatímní data lektora
LEKTOR_RANK = "komisař"
LEKTOR_NAME = "Jan Novák"

class PDFReport(FPDF):
    def header(self):
        if os.path.exists(LOGO_PATH):
            self.image(LOGO_PATH, x=10, y=8, w=30)
        self.set_font("helvetica", "B", 16)
        self.cell(40) # move right
        
        # Helper pro odstranění diakritiky v záhlaví
        import unicodedata
        def s(txt):
            n = unicodedata.normalize('NFD', str(txt))
            return ''.join(c for c in n if unicodedata.category(c) != 'Mn').encode('ascii', errors='replace').decode('ascii')
            
        self.cell(0, 10, s("HODNOTÍCÍ LIST STUDENTA (ÚPVSP)"), border=0, ln=1, align="C")
        self.set_font("helvetica", "I", 10)
        self.cell(40)
        self.cell(0, 10, s("Hodnoceni generovano za podpory AI Asistenta"), border=0, ln=1, align="C")
        self.ln(10)

    def footer(self):
        self.set_y(-15)
        self.set_font("helvetica", "I", 8)
        self.cell(0, 10, f"Strana {self.page_no()}/{{nb}}", 0, 0, "C")

def generate_student_pdf(evaluation: StudentEvaluation, lecturer: Lecturer) -> bytes:
    """
    Generuje PDF report pro konkrétní evaluaci studenta pomocí fpdf2 s oficiálním formátováním.
    Využívá dynamická data lektora pro podpisovou doložku.
    """
    def safe_text(txt):
        if not txt: return ""
        import unicodedata
        # Zajištění, aby text prošel přes FPDF helvetica bez UnicodeEncodeError
        normalized = unicodedata.normalize('NFD', str(txt))
        ascii_text = ''.join(c for c in normalized if unicodedata.category(c) != 'Mn')
        # Pro jistotu nahradit ještě znaky, které zbyly a nejsou ASCII tisknutelné
        return ascii_text.encode('ascii', errors='replace').decode('ascii')

    data = json.loads(evaluation.json_result)
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except json.JSONDecodeError:
            pass # Ponecháme to jako string a odchytíme dole

    if not isinstance(data, dict):
        data = {"celkove_skore": 0, "zpetna_vazba": f"Chyba formátu dat v databázi: {data}", "vysledky": []}
    
    pdf = PDFReport()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()
    
    # Metadata sekce
    pdf.set_font("helvetica", "B", 12)
    pdf.cell(35, 8, "Student:", 0, 0)
    pdf.set_font("helvetica", "", 12)
    pdf.cell(75, 8, safe_text(evaluation.student_name), 0, 0)
    
    pdf.set_font("helvetica", "B", 12)
    pdf.cell(40, 8, "Datum hodnocení:", 0, 0)
    pdf.set_font("helvetica", "", 12)
    pdf.cell(0, 8, safe_text(datetime.now().strftime("%d. %m. %Y")), 0, 1)
    
    pdf.set_font("helvetica", "B", 12)
    pdf.cell(35, 8, "Skóre:", 0, 0)
    pdf.set_font("helvetica", "B", 14)
    # Tmavě modrá barva pro skóre
    pdf.set_text_color(0, 40, 85)
    pdf.cell(0, 8, f"{data.get('celkove_skore', 0)} bodu", 0, 1)
    pdf.set_text_color(0, 0, 0) # reset
    
    pdf.ln(5)
    
    # Table Header
    pdf.set_font("helvetica", "B", 11)
    pdf.set_fill_color(0, 40, 85)
    pdf.set_text_color(255, 255, 255)
    
    col_kriterium = 45
    col_splneno = 20
    col_body = 15
    col_oduv = 110
    
    pdf.cell(col_kriterium, 10, safe_text("Kritérium"), border=1, fill=True)
    pdf.cell(col_splneno, 10, safe_text("Splněno"), border=1, align="C", fill=True)
    pdf.cell(col_body, 10, "Body", border=1, align="C", fill=True)
    pdf.cell(col_oduv, 10, safe_text("Zdůvodnění AI"), border=1, fill=True)
    pdf.ln()

    # Table Body
    pdf.set_font("helvetica", "", 10)
    pdf.set_text_color(0, 0, 0)
    
    for item in data.get("vysledky", []):
        nazev = safe_text(item.get("nazev", ""))
        # if too long, truncate slightly
        if len(nazev) > 45: nazev = nazev[:42] + "..."
            
        splneno = "ANO" if item.get("splneno", False) else "NE"
        body = str(item.get("body", 0))
        oduvodneni = safe_text(item.get("oduvodneni", ""))
        citace = safe_text(item.get("citace", ""))
        
        # Sestavení textu zdůvodnění a připojení citace, pokud existuje
        oduvodneni_text = oduvodneni
        if citace and citace.lower() not in ["", "chybí.", "chybí", "none", "(chybí)", "nenalezeno"]:
            oduvodneni_text += f"\n\nCitace z textu:\n\"{citace}\""
            
        # Výpočet přibližné výšky řádku na základě počtu znaků
        chars_per_line = 60
        lines_oduv = (len(oduvodneni_text) // chars_per_line) + 1 + oduvodneni_text.count('\n')
        lines_nazev = (len(nazev) // 25) + 1
        
        max_lines = max(lines_oduv, lines_nazev)
        row_h = (max_lines * 5) + 4
        if row_h < 12: row_h = 12
        
        x_before = pdf.get_x()
        y_before = pdf.get_y()
        
        # Odstránkování, pokud by se řádek nevešel
        if y_before + row_h > 270:
            pdf.add_page()
            y_before = pdf.get_y()
            x_before = pdf.get_x()
            
        # Nakreslení buněk-ohraničení
        pdf.rect(x_before, y_before, col_kriterium, row_h)
        pdf.rect(x_before + col_kriterium, y_before, col_splneno, row_h)
        pdf.rect(x_before + col_kriterium + col_splneno, y_before, col_body, row_h)
        pdf.rect(x_before + col_kriterium + col_splneno + col_body, y_before, col_oduv, row_h)
        
        # Vepsání obsahu Kritérium
        pdf.set_xy(x_before + 2, y_before + 2)
        pdf.multi_cell(col_kriterium - 4, 5, nazev, border=0)
        
        # Vepsání Splněno
        pdf.set_xy(x_before + col_kriterium, y_before)
        if splneno == "ANO": pdf.set_text_color(0, 150, 0)
        else: pdf.set_text_color(200, 0, 0)
        pdf.cell(col_splneno, row_h, splneno, border=0, align="C")
        pdf.set_text_color(0, 0, 0)
        
        # Vepsání Body
        pdf.set_xy(x_before + col_kriterium + col_splneno, y_before)
        pdf.cell(col_body, row_h, body, border=0, align="C")
        
        # Vepsání Zdůvodnění
        pdf.set_xy(x_before + col_kriterium + col_splneno + col_body + 2, y_before + 2)
        pdf.multi_cell(col_oduv - 4, 5, oduvodneni_text, border=0)
        
        pdf.set_y(y_before + row_h)

    # Zpětná vazba
    pdf.ln(8)
    pdf.set_font("helvetica", "B", 12)
    pdf.cell(0, 8, safe_text("Celková zpětná vazba a doporučení:"), ln=1)
    pdf.set_font("helvetica", "", 11)
    pdf.multi_cell(0, 6, safe_text(data.get("zpetna_vazba", "")))
    
    # Dialogový rámeček pro studenta
    pdf.ln(8)
    pdf.set_font("helvetica", "B", 11)
    pdf.cell(0, 8, safe_text("Vyjádření studenta k hodnocení:"), ln=1)
    # Nakreslí prázdný box
    pdf.rect(pdf.get_x(), pdf.get_y(), 190, 25)
    pdf.ln(30)
    
    # Podpisová doložka lektora a studenta
    pdf.set_font("helvetica", "", 11)
    
    # Sestavení jména s tituly
    lektor_name_parts = []
    if lecturer.title_before: lektor_name_parts.append(lecturer.title_before)
    lektor_name_parts.append(lecturer.first_name)
    lektor_name_parts.append(lecturer.last_name)
    if lecturer.title_after: lektor_name_parts.append(lecturer.title_after)
    lektor_full_name = " ".join(lektor_name_parts)
    
    # Prefix hodnosti
    rank_prefix = lecturer.rank_shortcut if lecturer.rank_shortcut else "Lektor"
    
    pdf.cell(100, 8, safe_text(f"vytvořil: {rank_prefix} {lektor_full_name}"), ln=0)
    pdf.cell(90, 8, safe_text("podpis studenta: _______________________"), ln=1, align="R")
    
    pdf.cell(100, 8, safe_text(f"dne: {datetime.now().strftime('%d. %m. %Y')}"), ln=0)
    pdf.cell(90, 8, safe_text("datum převzetí: _______________________"), ln=1, align="R")
    
    # Školní útvar (pokud je definován)
    if lecturer.school_location:
        pdf.cell(100, 8, safe_text(lecturer.school_location), ln=0)
        pdf.ln(8)
    
    # AI Act Citation Validation Footer
    pdf.set_y(-25)
    pdf.set_text_color(120, 120, 120)
    pdf.set_font("helvetica", "I", 8)
    pdf.multi_cell(0, 5, safe_text("AI Act Compliance: Podklady pro hodnocení na základě úředního záznamu byly uloženy k případnému přezkumu. Analýza textu probíhá v plně vzduchotěsném prostředí (On-Premise) pro zachování soukromí a datové bezpečnosti PČR."))
    
    return pdf.output(dest="S")

def generate_class_csv(class_id: int, db: Session, lecturer_id: int) -> str:
    """
    Generuje CSV export pro celou třídu určitého lektora.
    """
    evaluations = db.query(StudentEvaluation).filter(
        StudentEvaluation.class_id == class_id,
        StudentEvaluation.lecturer_id == lecturer_id
    ).all()
    
    if not evaluations:
        return "Jmeno,Skore,Hodnoceni_Hotovo\n"
        
    csv_lines = ["Jmeno_Studenta,Celkove_Skore,Zpetna_Vazba,Cas_Hodnoceni"]
    
    for eval_record in evaluations:
        try:
            data = json.loads(eval_record.json_result)
            if isinstance(data, str):
                data = json.loads(data)
            if not isinstance(data, dict):
                data = {}
        except Exception:
            data = {}
            
        name = eval_record.student_name.replace(',', '')
        score = data.get('celkove_skore', 0)
        zpetna = str(data.get('zpetna_vazba', '')).replace(',', ';').replace('\n', ' ')
        time_str = datetime.now().strftime("%Y-%m-%d %H:%M")
        
        csv_lines.append(f"{name},{score},{zpetna},{time_str}")
        
    return "\n".join(csv_lines)
