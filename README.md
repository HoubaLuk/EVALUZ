# EVALUZ

**Systém pro inteligentní vyhodnocování úředních záznamů pomocí AI**

EVALUZ je specializovaná platforma pro automatizovanou analýzu úředních záznamů v policejním prostředí. Projekt kombinuje moderní webové technologie s LLM modely pro dosažení maximální efektivity při kontrole metodických postupů.

---

## 📖 Dokumentace

Pro detailní pochopení systému, jeho architektury a historie vývoje navštivte:
👉 **[Technická dokumentace (Enterprise-grade)](file:///Users/lukashribnak/Vyhodnocov%C3%A1n%C3%AD%20%C3%9AZ%20pomoc%C3%AD%20AI/Vyhodnocov-n-Z/docs/TECHNICAL_DOCUMENTATION.md)**

---

## 🏗 Architektura ve zkratce

- **Frontend**: React 18 + Vite + TypeScript. Real-time komunikace přes WebSockets.
- **Backend**: FastAPI (Python 3.10+). Asynchronní fronta úloh pro LLM evaluaci.
- **Databáze**: PostgreSQL 17 (produkční standard).
- **AI Vrstva**: Univerzální rozhraní pro vLLM, Google Gemini a další providerery.

---

## 🚀 Rychlý start

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
Systém je navržen pro provoz v uzavřených sítích (On-premise / Air-gapped). Data neodcházejí mimo infrastrukturu při použití lokálních modelů. Veškeré citlivé konfigurace jsou uloženy v šifrované DB nebo lokálním `.env`.

---
*Evaluz - Inteligentní pomocník pro lektory ÚPVSP.*
