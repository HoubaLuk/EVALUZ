# ÚPVSP AI Evaluátor - Projektový Kontext a Architektura

## 1. Vize a Cíl Projektu
Aplikace slouží Útvaru policejního vzdělávání a služební přípravy (ÚPVSP). Cílem je automatizovat a standardizovat hodnocení "Úředních záznamů" (ÚZ) psaných policejními nováčky (ZOP). 
Cílem NENÍ nahradit lektora, ale ušetřit mu stovky hodin rutinní kontroly paragrafů a formalit.

## 2. Klíčové Principy (Neporušitelné)
- **Striktní On-Premise a Bezpečnost:** Z důvodu směrnice NIS2 a citlivosti dat se aplikace nesmí připojovat k žádným cloudovým LLM (žádné OpenAI, Claude, Google API). 
- **Human-in-the-Loop:** Umělá inteligence je pouze asistent. Lektor má vždy možnost editovat body a zdůvodnění navržená AI, než je finálně uloží.
- **AI Act Compliance (Vysvětlitelnost):** Každé rozhodnutí AI musí být podloženo zdrojem. Proto má evaluace funkci "Zobrazit zdroj", která ukáže přesnou citaci z textu studenta.

## 3. Technologická Architektura (Plán)
- **Frontend (Aktuální stav):** React + Vite + TailwindCSS + shadcn/ui. Rozděleno do komponent.
- **Backend (Plánováno):** Python + FastAPI. Bude řešit extrakci textu z .docx souborů studentů a orchestraci promptů. RAG (Retrieval-Augmented Generation) záměrně nevyužíváme, je to zbytečný overkill. Vše se řeší in-context.
- **LLM Engine (Plánováno):** vLLM běžící lokálně na GPU NVIDIA L40S. Použitý model: řada Qwen3 (32B+), případně doplněno o modely rodiny Gemma.

## 4. Logika a Flow Aplikace (3 Fáze)
1. **Záložka 1 - Precizace kritérií:** Lektor vede Sokratovský dialog s AI. AI z něj vytáhne detaily (přesná znění paragrafů) a vygeneruje strukturovaný JSON/Markdown s hodnotícími kritérii.
2. **Záložka 2 - Evaluace ÚZ:** "Srdce aplikace". Lektor nahraje dávku .docx souborů. Backend je zpracuje přes vLLM na základě kritérií z Fáze 1 a vrátí JSON s obodováním. Frontend to zobrazí v interaktivní side-by-side tabulce.
3. **Záložka 3 - Analýza třídy:** Z JSON výstupů všech studentů provede AI agregaci chyb a navrhne pedagogická doporučení a myšlenkovou mapu pro další výuku.
4. **Administrace (Modal):** Skryté centrum pro správu systémových "Super-Promptů" a konfiguraci připojení na lokální vLLM API (Endpoint, API klíč, Model ID).
