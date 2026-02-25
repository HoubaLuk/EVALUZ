# Projektový Kontext - Evaluátor ÚZ

## 📅 Aktuální Stav
Modul **Analýza třídy** a **PDF Exporty** jsou dokončeny, plně funkční a stabilní. Systém podporuje persistenci výsledků v SQLite a generování reportů v profesionálním designu.

## 1. Vize a Cíl
Automatizace vyhodnocování Úředních záznamů (ÚZ) na ÚPVSP. AI asistent pomáhá lektorům standardizovat hodnocení a šetřit čas při kontrole velkého množství prací.

## 2. Architektura
- **Frontend:** React + Vite + TypeScript.
- **Backend:** FastAPI (Python).
- **Databáze:** SQLite (lokální persistence).
- **Exporty:** Excel (pandas) a PDF (fpdf2).

## 3. Implementované Moduly
- **Precizace:** Sokratovský dialog pro tvorbu kritérií.
- **Evaluace:** Hromadné vyhodnocování ÚZ.
- **Analýza:** Dashboard, heatmapa výsledků a komplexní reporty.
