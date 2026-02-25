# Vyhodnocování ÚZ pomocí AI (Evaluátor ÚZ)

Specializovaný nástroj pro lektory ÚPVSP určený k automatizovanému vyhodnocování úředních záznamů podle § 40 zákona o policii.

## 🚀 Klíčové funkce

*   **Inteligentní extrakce hodnotících kritérií:** Automatické získání kritérií z PDF zadání pomocí AI.
*   **AI hodnocení studentských prací:** Objektivní posouzení záznamů s individuální pedagogickou zpětnou vazbou pro každého studenta.
*   **Globální analýza třídy:** Dashboard s heatmapou úspěšnosti (K1-K25) a přehledem nejčastějších chyb.
*   **Export výsledků:** Generování přehledů v Excelu a profesionálních PDF reportů v designu systému HERMES.

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
