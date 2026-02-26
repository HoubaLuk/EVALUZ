import os
import io
import json
from datetime import datetime
from fpdf import FPDF
from sqlalchemy.orm import Session
from models.db_models import StudentEvaluation, Lecturer, EvaluationCriteria, Criterion

# Paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PUBLIC_DIR = os.path.join(BASE_DIR, "public")
FONTS_DIR = os.path.join(BASE_DIR, "backend", "static", "fonts")
LOGO_PATH = os.path.join(PUBLIC_DIR, "ÚPVSP bez okrajů.jpg")

# Pomocná funkce pro převod plného názvu hodnosti na zkratku
def get_rank_abbr(full_rank: str) -> str:
    """
    Převede plný název hodnosti (např. 'vrchní komisař') na oficiální zkratku ('kpt.').
    Pokud hodnost není v číselníku, vrátí původní řetězec.
    """
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

class PDFReport(FPDF):
    """
    Rozšířená třída FPDF pro definici společného záhlaví a zápatí všech EVALUZ dokumentů.
    """
    def __init__(self, title="Globální analýza třídy - EVALUZ", subtitle="", unit="mm", format="A4"):
        super().__init__(unit=unit, format=format)
        self.report_title = title
        self.report_subtitle = subtitle

    def header(self):
        """Definuje záhlaví dokumentu (logo ÚPVSP a název systému). Zobrazuje se pouze na první straně."""
        if self.page_no() == 1:
            logo_path = os.path.join(BASE_DIR, "backend", "static", "logo_upvsp.png")
            if os.path.exists(logo_path):
                self.image(logo_path, x=10, y=8, w=20)
            
            self.set_font("DejaVu", "B", 10)
            self.set_xy(32, 10)
            self.cell(0, 6, "Útvar policejního vzdělávání a služební přípravy", border=0, ln=1)
            
            self.set_font("DejaVu", "", 10)
            self.set_xy(32, 16)
            self.cell(0, 6, self.report_title, border=0, ln=1)

            if getattr(self, "report_subtitle", ""):
                self.set_font("DejaVu", "", 8)
                self.set_text_color(100, 116, 139) # slate
                self.set_xy(32, 21)
                self.cell(0, 5, self.report_subtitle, border=0, ln=1)
                self.set_text_color(0, 0, 0)

            self.ln(10)

    def footer(self):
        """Definuje oficiální patičku s číslováním stránek a informací o vývoji."""
        self.set_y(-15)
        self.set_font("DejaVu", "", 8)
        self.set_text_color(100, 116, 139) # #64748b - břidlicově šedá
        self.cell(0, 5, "Generováno s využitím systému EVALUZ vyvinutého na Útvaru policejního vzdělávání a služební přípravy", align="C", ln=1)
        self.cell(0, 5, f"Strana {self.page_no()}/{{nb}}", align="C", ln=1)
        self.set_text_color(0, 0, 0) # reset barvy na černou

def generate_student_pdf(evaluation: StudentEvaluation, lecturer: Lecturer, db: Session = None, scenario_id: str = "Nespecifikováno") -> bytes:
    """
    Generuje individuální hodnotící list studenta ve formátu PDF.
    
    Args:
        evaluation: Objekt evaluace z databáze obsahující JSON s výsledky.
        lecturer: Objekt lektora pro automatické doplnění podpisové doložky.
        db: Session databáze pro dohledání počtu bodů v kritériích.
        
    Returns:
        bytes: Binární data vygenerovaného PDF dokumentu.
    """
    def safe_text(txt):
        """Zajišťuje bezpečný převod textu pro PDF stroj."""
        if not txt: return ""
        return str(txt)

    # Parsování JSON výsledků z AI modelu
    data = json.loads(evaluation.json_result)
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except json.JSONDecodeError:
            pass

    if not isinstance(data, dict):
        data = {"celkove_skore": 0, "zpetna_vazba": f"Chyba formátu dat v databázi: {data}", "vysledky": []}
    
    pdf = PDFReport(
        title="Hodnotící list vypracovaného úředního záznamu",
        subtitle=scenario_id, 
        unit="mm", format="A4"
    )
    
    # Cesty k TTF fontům podporujícím českou diakritiku
    font_regular = os.path.join(FONTS_DIR, "DejaVuSans.ttf")
    font_bold = os.path.join(FONTS_DIR, "DejaVuSans-Bold.ttf")
    font_oblique = os.path.join(FONTS_DIR, "DejaVuSans-Oblique.ttf")
    
    for fp in [font_regular, font_bold, font_oblique]:
        if not os.path.exists(fp):
            raise Exception(f"Font nenalezen na: {fp}")
            
    # Registrace fontů do FPDF instance
    pdf.add_font("DejaVu", "", font_regular)
    pdf.add_font("DejaVu", "B", font_bold)
    pdf.add_font("DejaVu", "I", font_oblique)
    
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()
    
    # --- Sekce HLAVIČKA (Identifikace studenta) ---
    pdf.set_font("DejaVu", "B", 12)
    pdf.cell(35, 8, "Student:", 0, 0)
    pdf.set_font("DejaVu", "", 12)
    pdf.cell(0, 8, safe_text(evaluation.student_name), 0, 1)
    
    pdf.ln(5)
    
    pdf.set_font("DejaVu", "B", 12)
    pdf.cell(0, 8, "Datum hodnocení:", 0, 1)
    pdf.set_font("DejaVu", "", 12)
    pdf.cell(0, 8, safe_text(datetime.now().strftime("%d. %m. %Y")), 0, 1)
    
    pdf.ln(2)
    
    # --- Sekce SKÓRE ---
    pdf.set_font("DejaVu", "B", 12)
    pdf.cell(35, 8, "Skóre:", 0, 0)
    pdf.set_font("DejaVu", "B", 14)
    pdf.set_text_color(0, 40, 85) # EVALUZ tmavě modrá
    
    # Výpočet max. bodů ze šablony kritérií v DB
    max_points = 25
    if db:
        crit_record = db.query(EvaluationCriteria).filter(
            EvaluationCriteria.scenario_name == "MS2",
            EvaluationCriteria.lecturer_id == lecturer.id
        ).first()
        if crit_record:
            criteria = db.query(Criterion).filter(Criterion.evaluation_criteria_id == crit_record.id).all()
            if criteria:
                max_points = sum(c.body for c in criteria if c.body)
                
    pdf.cell(0, 8, f"{data.get('celkove_skore', 0)} z {max_points} možných bodů", 0, 1)
    pdf.set_text_color(0, 0, 0) # reset
    
    pdf.ln(5)
    
    # --- Sekce TABULKA KRITÉRIÍ ---
    pdf.set_font("DejaVu", "B", 11)
    pdf.set_fill_color(0, 40, 85)
    pdf.set_text_color(255, 255, 255)
    
    # Definice šířek sloupců pro A4
    col_kriterium = 45
    col_splneno = 20
    col_body = 10
    col_oduv = 115
    
    pdf.cell(col_kriterium, 10, safe_text("Kritérium"), border=1, fill=True)
    pdf.cell(col_splneno, 10, safe_text("Splněno"), border=1, align="C", fill=True)
    pdf.cell(col_body, 10, "Body", border=1, align="C", fill=True)
    pdf.cell(col_oduv, 10, safe_text("Zdůvodnění AI"), border=1, fill=True)
    pdf.ln()

    # Vykreslení těla tabulky
    pdf.set_font("DejaVu", "", 10)
    pdf.set_text_color(0, 0, 0)
    
    for item in data.get("vysledky", []):
        nazev = safe_text(item.get("nazev", ""))
        if len(nazev) > 45: nazev = nazev[:42] + "..."
            
        splneno = "ANO" if item.get("splneno", False) else "NE"
        body = str(item.get("body", 0))
        oduvodneni = safe_text(item.get("oduvodneni", ""))
        citace = safe_text(item.get("citace", ""))
        
        # Sestavení finálního textu zdůvodnění s citací
        oduvodneni_text = oduvodneni.strip()
        if citace and citace.lower() not in ["", "chybí.", "chybí", "none", "(chybí)", "nenalezeno"]:
            oduvodneni_text += f"\n**Citace z textu:** {citace.strip()}"
            
        # Dynamický výpočet výšky řádku podle textu
        def get_lines_count(text, cell_width, is_markdown=False):
            if not text: return 1
            lines = pdf.multi_cell(cell_width, 6, text, dry_run=True, output="LINES", markdown=is_markdown)
            return len(lines)
            
        lines_oduv = get_lines_count(oduvodneni_text, col_oduv - 4, is_markdown=True)
        lines_nazev = get_lines_count(nazev, col_kriterium - 4, is_markdown=False)
        
        max_lines = max(lines_oduv, lines_nazev)
        row_h = (max_lines * 6) + 4
        if row_h < 12: row_h = 12
        
        x_before = pdf.get_x()
        y_before = pdf.get_y()
        
        # Automatické zalomení stránky uvnitř tabulky
        if y_before + row_h > 270:
            pdf.add_page()
            pdf.set_y(20)
            y_before = pdf.get_y()
            x_before = pdf.get_x()
            pdf.line(x_before, y_before, x_before + col_kriterium + col_splneno + col_body + col_oduv, y_before)
            
        # Vlastní vykreslení ohraničení pro sjednocenou výšku řádku
        pdf.line(x_before, y_before, x_before, y_before + row_h)
        pdf.line(x_before + col_kriterium, y_before, x_before + col_kriterium, y_before + row_h)
        pdf.line(x_before + col_kriterium + col_splneno, y_before, x_before + col_kriterium + col_splneno, y_before + row_h)
        pdf.line(x_before + col_kriterium + col_splneno + col_body, y_before, x_before + col_kriterium + col_splneno + col_body, y_before + row_h)
        pdf.line(x_before + col_kriterium + col_splneno + col_body + col_oduv, y_before, x_before + col_kriterium + col_splneno + col_body + col_oduv, y_before + row_h)
        
        # Vložení textu do buněk
        pdf.set_xy(x_before + 2, y_before + 2)
        pdf.multi_cell(col_kriterium - 4, 6, nazev, border=0)
        
        pdf.set_xy(x_before + col_kriterium, y_before)
        if splneno == "ANO": pdf.set_text_color(0, 150, 0) # zelená
        else: pdf.set_text_color(200, 0, 0) # červená
        pdf.cell(col_splneno, row_h, splneno, border=0, align="C")
        pdf.set_text_color(0, 0, 0)
        
        pdf.set_xy(x_before + col_kriterium + col_splneno, y_before)
        pdf.cell(col_body, row_h, body, border=0, align="C")
        
        pdf.set_xy(x_before + col_kriterium + col_splneno + col_body + 2, y_before + 2)
        pdf.multi_cell(col_oduv - 4, 6, oduvodneni_text, border=0, markdown=True)
        
        pdf.set_y(y_before + row_h)
        pdf.line(x_before, pdf.get_y(), x_before + col_kriterium + col_splneno + col_body + col_oduv, pdf.get_y())

    # --- Sekce ZPĚTNÁ VAZBA ---
    pdf.ln(8)
    pdf.set_font("DejaVu", "B", 12)
    pdf.cell(0, 8, safe_text("Celková zpětná vazba a doporučení:"), ln=1)
    pdf.set_font("DejaVu", "", 11)
    pdf.multi_cell(0, 6, safe_text(data.get("zpetna_vazba", "")), markdown=True)
    
    # --- Sekce PODPISOVÁ DOLOŽKA (ETŘ Kompatibilita) ---
    pdf.ln(12)
    pdf.set_font("DejaVu", "", 11)
    
    # Sestavení celého jména lektora
    lektor_name_parts = []
    if lecturer.title_before: lektor_name_parts.append(lecturer.title_before)
    lektor_name_parts.append(lecturer.first_name)
    lektor_name_parts.append(lecturer.last_name)
    if lecturer.title_after: lektor_name_parts.append(lecturer.title_after)
    lektor_full_name = " ".join(lektor_name_parts)
    
    rank_prefix = lecturer.rank_shortcut if lecturer.rank_shortcut else "Lektor"
    pdf.cell(0, 8, safe_text(f"vytvořil: {rank_prefix} {lektor_full_name}"), ln=1)
    
    if lecturer.school_location:
        pdf.cell(0, 8, safe_text(lecturer.school_location), ln=1)
    
    # Právní a technická doložka v zápatí
    pdf.set_y(-25)
    pdf.set_text_color(120, 120, 120)
    pdf.set_font("DejaVu", "I", 8)
    pdf.multi_cell(0, 5, safe_text("Zpracování dat probíhá v zabezpečeném vnitřním prostředí PČR v síti HERMES."))
    
    return pdf.output(dest="S")

def generate_class_excel(class_id: int, db: Session, lecturer_id: int) -> bytes:
    """
    Generuje komplexní Excel (XLSX) soubor s výsledky celé třídy.
    Obsahuje dva listy: Tabulku bodů se zkratkami a Legendu s plným zněním kritérií.
    
    Args:
        class_id: ID třídy k exportu.
        db: Session databáze.
        lecturer_id: ID lektora vlastnícího data.
        
    Returns:
        bytes: Binární data XLSX souboru.
    """
    evaluations = db.query(StudentEvaluation).filter(
        StudentEvaluation.class_id == class_id,
        StudentEvaluation.lecturer_id == lecturer_id
    ).all()
    
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment

    # --- LIST 1: Výsledky studentů ---
    wb = Workbook()
    ws = wb.active
    ws.title = "Výsledky Třídy"
    
    # Sběr unikátních názvů kritérií z první platné evaluace
    criteria_names = []
    for eval_record in evaluations:
        try:
            data = json.loads(eval_record.json_result)
            if "vysledky" in data and isinstance(data["vysledky"], list):
                for item in data["vysledky"]:
                    if "nazev" in item and item["nazev"] not in criteria_names:
                        criteria_names.append(item["nazev"])
                break
        except Exception:
            pass
            
    if not criteria_names:
        criteria_names = [f"Kritérium {i}" for i in range(1, 26)]
        
    # Hlavička tabulky (Zkratky K1, K2...)
    headers = ["Jméno Studenta"] + [f"K{i+1}" for i in range(len(criteria_names))] + ["Celkové Skóre"]
    ws.append(headers)
    
    # Stylování hlavičky (EVALUZ modrá)
    header_fill = PatternFill(start_color="002855", end_color="002855", fill_type="solid")
    header_font = Font(color="FFFFFF", bold=True)
    for cell in ws[1]:
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center")
        
    ws.freeze_panes = "B2"
        
    # Plnění daty studentů
    for eval_record in evaluations:
        try:
            data = json.loads(eval_record.json_result)
            if isinstance(data, str): data = json.loads(data)
            if not isinstance(data, dict): data = {}
        except Exception:
            data = {}
            
        student_name = eval_record.student_name.replace(',', '')
        total_score = data.get('celkove_skore', 0)
        
        # Přiřazení bodů k odpovídajícím sloupcům
        points = []
        parsed_results = data.get("vysledky", [])
        for critique_name in criteria_names:
            point_value = 0
            for item in parsed_results:
                if item.get("nazev") == critique_name:
                    point_value = item.get("body", 0)
                    break
            points.append(point_value)
            
        row_data = [student_name] + points + [total_score]
        ws.append(row_data)
        
    # Automatické přizpůsobení šířky sloupců
    for col in ws.columns:
        max_length = 0
        column = col[0].column_letter
        for cell in col:
            try:
                if len(str(cell.value)) > max_length:
                    max_length = len(str(cell.value))
            except: pass
        adjusted_width = (max_length + 2) * 1.2
        ws.column_dimensions[column].width = adjusted_width

    # --- LIST 2: Legenda Kritérií ---
    ws_legend = wb.create_sheet(title="Legenda Kritérií")
    ws_legend.append(["Značka v Tabulce", "Plné znění kritéria"])
    for cell in ws_legend[1]:
        cell.fill = header_fill
        cell.font = header_font
    
    for idx, crit_name in enumerate(criteria_names):
        ws_legend.append([f"K{idx+1}", crit_name])
        
    ws_legend.column_dimensions['A'].width = 20
    ws_legend.column_dimensions['B'].width = 100
        
    # Převedení na binární stream
    from io import BytesIO
    output = BytesIO()
    wb.save(output)
    output.seek(0)
    
    return output.getvalue()

def generate_class_report_pdf(analysis_data: dict, scenario_id: str, lecturer: Lecturer) -> bytes:
    """
    Generuje komplexní PDF report s globální analýzou celé třídy.
    Obsahuje KPI karty, tabulku úspěšnosti kritérií s barevným kódováním
    a hloubkový AI pedagogický vhled.
    """
    try:
        final_scenario_id = analysis_data.get("scenario_id") or scenario_id
        scenario_name = f"Zvolený scénář (ID: {final_scenario_id})"

        pdf = PDFReport(
            title="Globální analýza třídy - EVALUZ",
            subtitle=f"Modelová situace: {scenario_name}",
            unit="mm", format="A4"
        )

        # Registrace fontů
        fonts_exist = os.path.exists(os.path.join(FONTS_DIR, "DejaVuSans.ttf"))
        if fonts_exist:
            pdf.add_font('DejaVu', '', os.path.join(FONTS_DIR, "DejaVuSans.ttf"), uni=True)
            pdf.add_font('DejaVu', 'B', os.path.join(FONTS_DIR, "DejaVuSans-Bold.ttf"), uni=True)
            pdf.add_font('DejaVu', 'I', os.path.join(FONTS_DIR, "DejaVuSans-Oblique.ttf"), uni=True)
        else:
            pdf.add_font('DejaVu', '', 'Arial', uni=True)
            pdf.add_font('DejaVu', 'B', 'Arial', uni=True)
            pdf.add_font('DejaVu', 'I', 'Arial', uni=True)
            
        pdf.add_page()
        
        # --- Záhlaví Analýzy ---
        pdf.set_draw_color(30, 41, 59)
        pdf.set_fill_color(30, 41, 59)
        pdf.set_text_color(255, 255, 255)
        pdf.set_font("DejaVu", "B", 18)
        pdf.cell(0, 16, "  EVALUZ - Globální Analýza Třídy", border=0, ln=1, align="L", fill=True)
        pdf.set_text_color(0, 0, 0)
        pdf.set_font("DejaVu", "", 10)
        pdf.set_draw_color(0, 0, 0)
        pdf.ln(6)
        
        # Hlavička informací
        pdf.set_fill_color(240, 245, 250)
        # Sestavení celého jména lektora bez "None" řetězců
        parts = []
        if lecturer.title_before: parts.append(lecturer.title_before)
        if lecturer.first_name: parts.append(lecturer.first_name)
        if lecturer.last_name: parts.append(lecturer.last_name)
        if lecturer.title_after: parts.append(lecturer.title_after)
        
        pdf.cell(40, 8, "Lektor:", border=1, fill=True)
        pdf.cell(0, 8, " ".join(parts), border=1, ln=1)
        pdf.cell(40, 8, "Modelová situace:", border=1, fill=True)
        pdf.cell(0, 8, scenario_name, border=1, ln=1)
    
        # KPI Card
        pdf.ln(6)
        avg_score = analysis_data.get("average_score", 0)
        max_score = analysis_data.get("max_score", 25)
        pdf.set_font("DejaVu", "B", 16)
        pdf.set_fill_color(241, 245, 249) # slate-100
        pdf.set_text_color(15, 23, 42)    # slate-900
        pdf.set_draw_color(203, 213, 225) # slate-300
        pdf.cell(0, 18, f"  Průměrné skóre třídy:  {avg_score} / {max_score} bodů", border=1, ln=1, align="C", fill=True)
        pdf.set_text_color(0, 0, 0)
        pdf.set_draw_color(0, 0, 0)
        
        # Shrnutí tabulky K1-K25
        pdf.ln(10)
        pdf.set_font("DejaVu", "B", 12)
        pdf.cell(0, 8, "Úspěšnost v jednotlivých kritériích:", ln=1)
        
        pdf.set_font("DejaVu", "B", 9)
        pdf.set_draw_color(100, 116, 139) # slate-500
        pdf.set_fill_color(241, 245, 249) # slate-100
        pdf.cell(15, 8, "Kód", border=1, fill=True, align="C")
        pdf.cell(145, 8, "Název kritéria", border=1, fill=True)
        pdf.cell(0, 8, "Úspěšnost", border=1, ln=1, align="C", fill=True)
        
        pdf.set_font("DejaVu", "", 8)
        pdf.set_draw_color(203, 213, 225) # slate-300 for rows
        stats = analysis_data.get("stats", [])
        # Limit to 25 strictly
        for i, stat in enumerate(stats[:25]):
            success_rate = stat.get('success_rate', 0)
            
            # Color coding success block
            if success_rate < 50:
                pdf.set_text_color(220, 38, 38) # Red
            elif success_rate < 80:
                pdf.set_text_color(217, 119, 6) # Amber
            else:
                pdf.set_text_color(16, 185, 129) # Green
                
            pdf.cell(15, 6, f"K{i+1}", border=1, align="C")
            
            # We must change text color to black for the name
            pdf.set_text_color(0, 0, 0)
            name = str(stat.get('name', '') or '')
            if len(name) > 85: name = name[:82] + "..."
            pdf.cell(145, 6, name, border=1)
            
            # Paint the success_rate % with Traffic Light System
            if success_rate < 50:
                pdf.set_fill_color(254, 226, 226) # Red fill
                pdf.set_text_color(153, 27, 27)   # Red text
                pdf.set_font("DejaVu", "B", 8)
            elif success_rate < 80:
                pdf.set_fill_color(254, 243, 199) # Amber fill
                pdf.set_text_color(146, 64, 14)   # Amber text
                pdf.set_font("DejaVu", "B", 8)
            else:
                pdf.set_fill_color(220, 252, 231) # Green fill
                pdf.set_text_color(22, 101, 52)   # Green text
                pdf.set_font("DejaVu", "B", 8)
                
            pdf.cell(0, 6, f"{success_rate} %", border=1, ln=1, align="C", fill=True)
            pdf.set_text_color(0, 0, 0) # Reset color
            pdf.set_font("DejaVu", "", 8)
            pdf.set_fill_color(255, 255, 255) # Reset fill

        # AI Pedagogické shrnutí
        pdf.add_page()
        pdf.set_font("DejaVu", "B", 14)
        pdf.set_text_color(0, 40, 85)
        pdf.cell(0, 10, "PEDAGOGICKÉ SHRNUTÍ (AI ASISTENT)", border=0, ln=1, align="L")
        pdf.set_text_color(0, 0, 0)
        pdf.ln(5)
        
        pdf.set_font("DejaVu", "", 10)
        ai_insight = analysis_data.get("ai_insight", "")
        
        if ai_insight:
            # Split blocks
            blocks = ai_insight.split("###")
            for block in blocks:
                block = block.strip()
                if not block: continue
                
                lines = block.split("\n")
                if lines:
                    title = lines[0].replace("**", "").strip()
                    content = "\n".join(lines[1:]).strip()
                    
                    pdf.set_font("DejaVu", "B", 12)
                    pdf.set_text_color(30, 41, 59)
                    pdf.cell(0, 8, title, ln=1)
                    pdf.set_text_color(0, 0, 0)
                    
                    pdf.set_font("DejaVu", "", 10)
                    # Styled grey boxes for AI insight paragraphs
                    pdf.set_fill_color(248, 250, 252) # slate-50
                    pdf.set_draw_color(226, 232, 240) # slate-200
                    pdf.multi_cell(0, 6, "\n" + content + "\n", markdown=True, border=1, fill=True)
                    pdf.ln(6)

        return bytes(pdf.output())

    except Exception as e:
        import traceback
        print(">>> [PDF GEN ERROR] Chycena výjimka při generování třídního reportu:")
        traceback.print_exc()
        raise Exception(f"Failed to generate PDF: {str(e)}")
