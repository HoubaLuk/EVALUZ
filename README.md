# HERMES - AI Evaluátor úředních záznamů ÚPVSP

Profesionální nástroj pro automatizované vyhodnocování policejních záznamů podle § 40 zákona o policii. Projekt HERMES využívá pokročilé jazykové modely (LLM) pro asistenci lektorům při hodnocení kvality a právní věcnosti studentských prací.

## 🚀 Klíčové funkce

*   **Inteligentní precizace kritérií:** Sokratovský dialog s AI pro extrakci a definici hodnotících kritérií z textového zadání.
*   **AI Evaluace studentských prací:** Automatizované čtení a hodnocení nahraných dokumentů (.docx, .pdf) s detailní pedagogickou zpětnou vazbou.
*   **Globální analýza třídy:** Interaktivní dashboard s heatmapou úspěšnosti v jednotlivých kritériích (K1-K25) a agregací nejčastějších chyb.
*   **Profesionální exporty:** Generování datových přehledů v Excelu a komplexních PDF reportů v designu HERMES pro vedení.

## 🛠 Tech Stack

*   **Frontend:** React 18, Vite, TypeScript, Tailwind CSS, Lucide Icons, Recharts.
*   **Backend:** Python 3.10+, FastAPI, SQLAlchemy (SQLite), FPDF2, Pandas.
*   **AI:** Integrace s LLM (přes OpenRouter nebo lokální vLLM API).

## 💻 Spuštění projektu (Run Locally)

### Prerekvizity
*   Node.js (v16+)
*   Python (v3.10+)

### 1. Frontend
```bash
# Instalace závislostí
npm install

# Spuštění vývojového serveru
npm run dev
```

### 2. Backend
```bash
# Přechod do složky backend (pokud existuje samostatný venv, aktivujte jej)
# Např.: source .venv/bin/activate

# Instalace Python závislostí
pip install -r backend/requirements.txt

# Spuštění backend serveru (uvicorn)
python backend/main.py
```

### 3. Konfigurace
1.  Vytvořte soubor `.env` v kořenovém adresáři (viz `.env.example`).
2.  Nastavte `GEMINI_API_KEY` nebo `OPENROUTER_API_KEY` (podle typu providera použitém v backendu).

## 📄 Licence
Tento software je vyvíjen pro interní účely ÚPVSP. Všechna práva vyhrazena.
