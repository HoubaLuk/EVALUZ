# EVALUZ (v3.1.1 - Air-Gap Robust)

**Systém pro inteligentní vyhodnocování úředních záznamů pomocí AI**

EVALUZ je specializovaná platforma pro automatizovanou analýzu úředních záznamů v policejním prostředí. Projekt kombinuje moderní webové technologie s LLM modely pro dosažení maximální efektivity při kontrole metodických postupů.

---

## 📖 Dokumentace

Pro detailní pochopení systému, jeho architektury a historie vývoje navštivte:
👉 **[Technická dokumentace (Enterprise-grade)](file:///Users/lukashribnak/Vyhodnocov%C3%A1n%C3%AD%20%C3%9AZ%20pomoc%C3%AD%20AI/Vyhodnocov-n-Z/docs/TECHNICAL_DOCUMENTATION.md)**

---

## 🏗 Architektura ve zkratce

- **Frontend**: React + Vite + TypeScript. (Build: `npm run build`)
- **Backend**: FastAPI (Python 3.10+). Asynchronní fronta úloh pro LLM evaluaci.
- **Databáze**: PostgreSQL 17 (produkční) / SQLite (vývojová).
- **AI Vrstva**: Podpora pro vLLM (OpenRouter), Reasoning modely (Qwen 3.5, DeepSeek).

---

## ❄️ Air-Gapped Instalace (Bez přístupu k internetu)

Tato verze je speciálně optimalizována pro nasazení v uzavřených sítích policejních intranetů. Obsahuje kritické opravy pro:
- **Zero-Config DB:** Automatické zakládání výchozích tříd (řeší chybu `ForeignKeyViolation`).
- **LM Studio Compatibility:** Opravena chyba 400 při vynucování JSON formátu u lokálních LLM.
- **HTTP/SSL Support:** Inteligentní detekce nezabezpečeného připojení (HTTP) s varováním pro HDD Sync.
- **Unicode Normalization:** Robustní párování jmen souborů (Mac NFD vs Linux NFC).

Technikovi stačí připravit instalační balíček:

### 1. Metoda: Docker (Doporučeno pro Air-Gapped)
Tato metoda je nejrobustnější, protože přenášíte celé "kontejnery" se všemi závislostmi.

**Na stroji s internetem:**
1. Sestavte obrazy: `docker-compose build`
2. Exportujte obrazy do souboru:
   ```bash
   docker save -o evaluz_images.tar evaluz_frontend evaluz_backend postgres:15-alpine
   ```

**Na cílovém stroji (offline):**
1. Importujte obrazy: `docker load -i evaluz_images.tar`
2. Spusťte systém: `docker-compose up -d`

---

### 2. Metoda: Ruční instalace (Python + Build)
Pokud nemůžete použít Docker, připravte si balíček ručně:

**Na stroji s internetem:**
1. Backend (závislosti):
   ```bash
   cd backend && mkdir vendor
   pip download -d ./vendor -r requirements.txt
   ```
2. Frontend (sestavení):
   ```bash
   npm install && npm run build
   ```

**Na cílovém stroji (offline):**
1. Instalace backendu: `pip install --no-index --find-links=./vendor -r requirements.txt`
2. Přeneste složku `dist/` a servírujte ji.

---

## 🚀 Standardní start (Online)

### 1. Backend
```bash
cd backend
# Nastavte .env soubor s DATABASE_URL a API klíči
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python main.py
```

### 2. Frontend
```bash
npm install
npm run dev
```

---

## 🛡 Bezpečnost a soukromí
Systém je navržen pro provoz v uzavřených sítích. Data neodcházejí mimo infrastrukturu při použití lokálních modelů.

**Ochrana proti Prompt Injection:**
Aplikace nevyužívá žádný black-box "safety model", který by mohl cenzurovat policejní texty. Místo toho je bezpečnost zajištěna architektonicky na úrovni jádra (Hardcoded System Prompts). Studentův předložený text (ÚZ) je modelu vizuálně separován jako čistá "data string" proměnná (`report_text`) pod jasnou instrukcí "VYHODNOŤ JEN TOTO". Model nesmí spouštět z textu žádné příkazy. Tím je efektivně minimalizováno riziko infikace přesvědčením LLM stroje, aby ignoroval metodiku.

---

## 🧠 Funkce LLM vs. Algoritmická analytika
Je důležité pochopit rozdělení rolí:
1.  **Role LLM (Umělé inteligence):** Slouží výhradně jako "čtenář". Její prací je extrahovat identitu podle vzorů a porovnat text ÚZ s markdown kritérii od lektora. Vrací holá fakta o tom, co v textu je a není (boolean/body).
2.  **Role Backend Analytiky (Algoritmické):** Samotná třídní analytika (celková úspěšnost, průměry bodů, detekce pádů) NENÍ počítána umělou inteligencí. Jde o tvrdou, neomylnou matematiku naprogramovanou v Pythonu agregující data ze stovek JSON struktur. LLM ve fázi 3 dostává už hotová a vypočítaná tvrdá data (procenta atd.) a jeho jedinou funkcí je přečíst si je a napsat k nim "manažerské shrnutí a doporučení" v lidské řeči. Nepočítá příklady.

---
*Evaluz - Inteligentní pomocník pro lektory ÚPVSP.*
