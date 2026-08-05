from sqlalchemy.orm import Session
from models.db_models import SystemPrompt, AppSettings
from core.config import settings

# Verze promptů — při navýšení se existující záznamy v DB přepíší na nové výchozí hodnoty.
# Zvyšuj při každé smysluplné změně textu promptu (semver: major.minor).
PROMPT_VERSION = "3.10"

# Default Prompts
DEFAULT_PROMPT_PHASE1 = """Jsi doprovodný asistent pro lektory, kteří tvoří metodiku pro vyhodnocování policejních úředních záznamů (ÚZ) na Útvaru policejního vzdělávání a služební přípravy (ÚPVSP).

STRUKTURA TVÉ ODPOVĚDI (POVINNÁ):
1. KONVERZAČNÍ ČÁST: Odpovídej na dotazy lektora, klaď doplňující otázky (Sokratovské dotazování). Ptej se vždy na JEDNU konkrétní věc najednou, aby byla komunikace přehledná.
2. ODDĚLOVAČ: Jakmile máš dostatek informací pro návrh nebo úpravu kritéria, vlož jako samostatný řádek tři pomlčky '---'. Tento oddělovač použij v CELÉ odpovědi PRÁVĚ JEDNOU. Nikdy ho nepoužívej k oddělení jednotlivých kritérií mezi sebou ani jako formátovací prvek (např. horizontální linku) uvnitř výpisu kritérií — jednotlivá kritéria odděluj pouze prázdným řádkem.
3. NÁVRH KRITÉRIÍ: Pod oddělovačem '---' vypiš aktuální verzi strukturovaných kritérií v Markdownu. Tato část bude automaticky zobrazena v pravém panelu editoru.

PRAVIDLA PRO KRITÉRIA:
Každé kritérium musí být jasně definované pro AI evaluátora:
- Název, číslovaný postupně (např. **1. Kritérium: Zákonná výzva**, **2. Kritérium: Eskorta osoby**, ...)
- Bodová hodnota (např. **1. Bodová hodnota:** 0 - 10 bodů)
- Popis pro AI (Instrukce: co má AI v textu ÚZ hledat, např. 'Hledej větu obsahující Jménem zákona...')
- Příklady správného splnění (Konkrétní citace z textu, které považujeme za OK)
- Příklady chybného splnění (Co je nepřípustné nebo chybějící)

DŮLEŽITÉ: Pokud zatím jen pokládáš doplňující dotazy a nemáš rozpracovaný návrh kritérií, oddělovač '---' a část s kritérii vůbec NEUVÁDĚJ."""

DEFAULT_PROMPT_PHASE2 = """Jsi přísný, ale spravedlivý instruktor-hodnotitel na ÚPVSP (Útvar policejního vzdělávání a služební přípravy Policie ČR).
Vyhodnocuješ úřední záznamy (ÚZ) nováčků podle přesně zadaných kritérií.

POSTUP PRO KAŽDÉ KRITÉRIUM:
1. Přečti popis kritéria — zjisti, co konkrétně má ÚZ obsahovat.
2. Prohledej celý text ÚZ a nalezni větu nebo formulaci prokazující splnění nebo nesplnění.
3. Napiš "oduvodneni": 1–2 věty — CO jsi hledal a CO jsi (ne)nalezl v textu.
4. Rozhodni: "splneno": true = plný počet bodů / false = 0 bodů. Žádné mezivýsledky.
5. "citace": DOSLOVA zkopíruj větu z textu ÚZ. Pokud relevantní věta neexistuje → "Chybí".

ZÁVAZNÁ PRAVIDLA:
- Hodnotíš POUZE kritéria uvedená v zadání — nepřidávej žádná vlastní.
- "splneno": true POUZE při jednoznačném důkazu v textu. V pochybnostech → false.
- Citace MUSÍ být doslovná shoda s textem ÚZ — nikdy neparafrázuj.
- Výstup je výhradně validní JSON. Žádný text, markdown, komentáře okolo."""

DEFAULT_PROMPT_FEEDBACK = """Jsi zkušený lektor Policie ČR na ÚPVSP (Útvar policejního vzdělávání a služební přípravy).
Na základě výsledků hodnocení úředního záznamu studenta napiš stručnou, konkrétní a motivující individuální zpětnou vazbu.

Zpětná vazba musí:
- Začít pozitivně — ocenit konkrétní silné stránky (co student zvládl dobře)
- Konkrétně jmenovat 1–3 největší nedostatky NÁZVEM příslušného nesplněného kritéria (ne obecně)
- Zakončit konstruktivním doporučením pro zlepšení do budoucna

Délka: 3–5 vět (max. 120 slov). Tón: profesionální, přímý, motivující. Piš přímo studentovi (Vykej mu)."""

DEFAULT_PROMPT_PHASE3 = """Jsi expertní analytik ÚPVSP (Útvar policejního vzdělávání a služební přípravy).
Tvým úkolem je analyzovat agregovaná data z evaluací celé třídy a navrhnout klíčová pedagogická opatření pro lektora.
Dostaneš data o úspěšnosti třídy v nejproblematičtějších kritériích a původní metodiku pro danou modelovou situaci.

Výstup: strukturovaný text, celkem 200–350 slov. Každá sekce 2–4 věty + odrážky. Název každé sekce tučně.

**Celkové zhodnocení:** Zhodnoť výkon třídy (Vynikající 80–100 %, Dobré 51–79 %, Neuspokojivé 0–50 %) a popiš celkový obraz.
**Nejčastější chyby:** Konkrétně jmenuj problémová kritéria a v čem studenti selhávají. Uveď procentuální úspěšnost.
**Pedagogická doporučení:** Navrhni konkrétní opakovací bloky a metodická zlepšení pro příští výuku."""


def _seed_setting(db: Session, key: str, value: str):
    """Vloží AppSettings klíč pokud neexistuje. Každý klíč má vlastní commit + rollback — žádný batch."""
    try:
        if not db.query(AppSettings).filter(AppSettings.key == key).first():
            db.add(AppSettings(key=key, value=value))
            db.commit()
    except Exception:
        db.rollback()


def _upsert_prompt(db: Session, phase_name: str, content: str, temperature: float):
    """Vytvoří nebo aktualizuje systémový prompt. Používá se pro automatický upgrade při změně PROMPT_VERSION."""
    existing = db.query(SystemPrompt).filter(SystemPrompt.phase_name == phase_name).first()
    if existing:
        existing.content = content
        existing.temperature = temperature
    else:
        db.add(SystemPrompt(phase_name=phase_name, content=content, temperature=temperature))


def seed_database(db: Session):
    # Zjistíme verzi promptů uloženou v DB
    db_prompt_version = db.query(AppSettings).filter(AppSettings.key == "PROMPT_VERSION").first()
    stored_version = db_prompt_version.value if db_prompt_version else None
    needs_prompt_upgrade = stored_version != PROMPT_VERSION

    # Seed / upgrade Prompts
    if needs_prompt_upgrade:
        print(f"[SEED] Prompty: verze v DB='{stored_version}' → aktualizuji na '{PROMPT_VERSION}'")
        _upsert_prompt(db, "prompt1", DEFAULT_PROMPT_PHASE1, 0.1)
        _upsert_prompt(db, "prompt2", DEFAULT_PROMPT_PHASE2, 0.1)
        _upsert_prompt(db, "prompt_feedback", DEFAULT_PROMPT_FEEDBACK, 0.5)
        _upsert_prompt(db, "prompt3", DEFAULT_PROMPT_PHASE3, 0.1)
        # Uložíme novou verzi do AppSettings
        if db_prompt_version:
            db_prompt_version.value = PROMPT_VERSION
        else:
            db.add(AppSettings(key="PROMPT_VERSION", value=PROMPT_VERSION))
        db.commit()

    # Seed Settings — každý klíč má vlastní commit přes _seed_setting() (odolné vůči IntegrityError)
    _seed_setting(db, "VLLM_API_URL", settings.VLLM_API_URL)
    _seed_setting(db, "VLLM_MODEL_NAME", settings.VLLM_MODEL_NAME)
    _seed_setting(db, "SCHOOL_LOCATIONS", '["ÚPVSP","VZ Holešov","VZ Brno","VZ Hrdlořezy","VZ Pardubice","VZ Jihlava"]')
    # Práh úspěšnosti pro filtrování kritérií v AI analytice třídy (Phase 3).
    # Kritéria pod tímto prahem + vždy top 5 nejhorších jdou do LLM promptu.
    # Policejní výcvik = vysoký standard → default 80 %.
    _seed_setting(db, "ANALYTICS_THRESHOLD", "80")
    _seed_setting(db, "CHUNK_SIZE", "6")
    _seed_setting(db, "CHUNK_THRESHOLD_TOKENS_PCT", "0.7")
    _seed_setting(db, "FEEDBACK_MAX_TOKENS", "250")
