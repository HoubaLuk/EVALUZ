# EVALUZ: Asistent pro vyhodnocování úředních záznamů v ZOP

Specializovaný nástroj pro lektory určený k automatizovanému vyhodnocování úředních záznamů podle § 40 zákona o policii.

## 🚀 Klíčové funkce

*   **Inteligentní extrakce hodnotících kritérií:** Automatické získání kritérií z PDF zadání pomocí AI.
*   **AI hodnocení studentských prací:** Objektivní posouzení záznamů s individuální pedagogickou zpětnou vazbou.
*   **Man-in-the-Loop (Lektorské korekce):** Možnost ručního zásahu lektora do bodového hodnocení a zpětné vazby s okamžitou aktualizací statistik.
*   **Deterministická Analytika:** Statistické výpočty (K1-K25) probíhají exaktně v Pythonu, nikoliv v LLM, což zaručuje 100% matematickou správnost.
*   **Globální analýza třídy:** Dashboard s heatmapou úspěšnosti, distribučními grafy a AI doporučeními.
*   **Export výsledků:** Generování profesionálních PDF reportů a Excelových přehledů.

## 🛠 Tech Stack

*   **Frontend:** React (Vite), TypeScript, Tailwind CSS
*   **Backend:** Python (FastAPI), SQLite, FPDF2
*   **AI Engine:** Integrace LLM přes OpenRouter (vLLM kompatibilní)

## 💻 Instalace a spuštění

### 1. Frontend
```bash
# Instalace závislostí
npm install

# Spuštění vývojového serveru
npm run dev
```

### 2. Backend
```bash
# Vytvoření virtuálního prostředí
python -m venv .venv
source .venv/bin/activate  # Pro Windows: .venv\Scripts\activate

# Instalace závislostí
pip install -r backend/requirements.txt

# Spuštění backendu
cd backend
python main.py
```
*Poznámka: Alternativně lze spustit přes `uvicorn main:app --reload` přímo ze složky backend.*

### 3. Konfigurace
Nastavte potřebné klíče v souboru `.env` podle přiloženého `.env.example`.

## 📄 Licence
Projekt je určen pro interní potřeby ÚPVSP. Všechna práva vyhrazena.
