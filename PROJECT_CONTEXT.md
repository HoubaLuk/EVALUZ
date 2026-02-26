# Projektový Kontext - Evaluátor ÚZ

## 📅 Aktuální Stav
Modul **Analýza třídy**, **Man-in-the-Loop** (lektorské korekce) a **PDF Exporty** jsou dokončeny. Výpočty úspěšnosti jsou deterministické (Python) a UI je plně synchronizované se změnami scénářů.

## 1. Vize a Cíl
Automatizace vyhodnocování Úředních záznamů (ÚZ) na ÚPVSP. AI asistent pomáhá lektorům standardizovat hodnocení, přičemž lektor má vždy poslední slovo díky možnosti manuální editace.

## 2. Architektura
- **Frontend:** React + Vite + TypeScript (Optimistické UI).
- **Backend:** FastAPI (Python) + Deterministické výpočetní jádro.
- **Databáze:** SQLite (lokální persistence).
- **Exporty:** Excel (openpyxl) a PDF (fpdf2).

## 3. Implementované Moduly
- **Precizace:** Tvorba kritérií z PDF zadání.
- **Evaluace:** Hromadné AI vyhodnocování s možností ruční korekce lektorem.
- **Analýza:** Dashboard s heatmapou a pedagogickými vhledy (LLM interpretace exaktních dat).
