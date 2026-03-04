# EVALUZ

**Systém pro inteligentní vyhodnocování úředních záznamů pomocí AI**

EVALUZ je moderní webová aplikace navržená pro automatizaci a zefektivnění procesu hodnocení úředních záznamů (ÚZ) v prostředí policejního vzdělávání. Využívá pokročilé modely velkých jazykových modelů (LLM) k analýze textu, extrakci identity a ověřování splnění definovaných kritérií.

---

## 🏗 Architektura systému

Aplikace je postavena na dekomponované architektuře oddělující klientskou část (Frontend) a serverovou část (Backend) s asynchronním zpracováním úloh.

### 1. Frontend (Klientská část)
*   **Framework**: [React 18](https://reactjs.org/) s [TypeScriptem](https://www.typescriptlang.org/).
*   **Build Tool**: [Vite](https://vitejs.dev/) pro bleskový vývoj a optimalizovaný produkční build.
*   **Styling**: Vanilla CSS s moderními proměnnými, doplněno o [Lucide React](https://lucide.dev/) pro ikonografii.
*   **Stav**: Komponentová architektura s využitím `Context API` (pro globální dialogy a autentizaci) a `useState/useEffect`.
*   **Komunikace**: 
    *   **REST API**: Pro běžné CRUD operace (správa tříd, scénářů, načítání výsledků).
    *   **WebSockets**: Pro real-time sledování stavu asynchronního vyhodnocování (frontend okamžitě reaguje na změny stavu ve frontě na serveru).

### 2. Backend (Serverová část)
*   **Framework**: [FastAPI](https://fastapi.tiangolo.com/) (Python 3.10+).
*   **Databáze**: [SQLite](https://www.sqlite.org/) (produkčně připraveno pro PostgreSQL pomocí SQLAlchemy).
*   **Asynchronní zpracování**: 
    *   Vlastní implementace `EvaluationQueue` využívající `asyncio.Queue`.
    *   Semaphore-based throttling (omezení souběžných volání LLM pro stabilitu).
*   **Zabezpečení**: JWT (JSON Web Tokens) autentizace pro lektory.

### 3. AI & Data Processing Layer
*   **LLM Integrace**: Rozhraní kompatibilní s OpenAI API (podpora pro vLLM, OpenRouter, Azure OpenAI).
*   **Parser dokumentů**: 
    *   **PyMuPDF (fitz)**: Pro vysoce stabilní extrakci textu z PDF.
    *   **python-docx**: Pro zpracování Microsoft Word dokumentů.
    *   **striprtf**: Pro RTF formáty.
*   **Extrakce identity**: Hybridní přístup využívající Regex (regulární výrazy) a LLM pro spolehlivé rozpoznání jmen, hodností a útvarů i z nekvalitních skenů.

---

## 🌟 Klíčové funkcionality

### 📝 Správa kritérií a scénářů
*   Vytváření "Modelových situací" (Scénářů).
*   Nahrávání nebo manuální editace hodnotících kritérií v Markdown formátu.
*   Možnost generování kritérií pomocí AI.

### 📂 Inteligentní Import (Sync)
*   **Sync ÚZ v PC**: Unikátní funkce přímé synchronizace lokální složky se serverem přes File System Access API.
*   **Fast-Scan**: Okamžitá extrakce jmen studentů při importu (LLM analyzuje pouze signatury dokumentů pro úsporu tokenů).

### 🤖 Asynchronní Evaluace (v2.0)
*   **Paralelní fronta**: Možnost nechat vyhodnocovat desítky studentů najednou na pozadí.
*   **Real-time status**: Uživatel vidí stavy `Čeká ve frontě` -> `Zpracovává se` -> `Hotovo`.
*   **Stop tlačítko**: Možnost okamžitého přerušení celého procesu.

### 📊 Globální analýza a exporty
*   **Heatmapa úspěšnosti**: Vizualizace, ve kterých kritériích třída nejvíce chybuje.
*   **AI Pedagogický vhled**: LLM analyzuje výsledky celé třídy a navrhuje lektorovi, na co se zaměřit v příští výuce.
*   **Exporty**: Generování profesionálních PDF reportů (přes `fpdf2`) a Excelových tabulek se všemi body.

---

## 🛠 Instalace a spuštění

### Prerekvizity
*   Node.js (v18+)
*   Python (3.10+)

### 1. Backend (Server)
```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

### 2. Frontend (Klient)
```bash
npm install
npm run dev
```

---

## 🛡 Bezpečnost a soukromí
*   **Databáze: PostgreSQL 17**: Aplikace používá jako výchozí robustní databázový server PostgreSQL 17 (nainstalovaný lokálně přes Homebrew). Databáze `evaluz_db` běží jako systémová služba a automaticky startuje spolu s počítačem.
    *   **Přístupové údaje** jsou uchovány v souboru `backend/.env` (není součástí Git repozitáře).
    *   **Přechod na centrální server** (produkce): Stačí změnit `DATABASE_URL` v souboru `.env`.
*   **Air-gapped provoz**: Navrženo pro provoz v izolovaných sítích při napojení na lokální instanci LLM (např. vLLM běžící na GPU serveru v rámci intranetu).
*   **Data v bezpečí**: Veškeré texty a analýzy jsou pod plnou kontrolou provozovatele, data neodcházejí do veřejných cloudů (při použití interního modelu).


---
*Vyvinuto jako specializovaný nástroj pro zefektivnění kontroly úředních záznamů.*
