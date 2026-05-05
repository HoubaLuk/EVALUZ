"""
MODUL: LLM ENGINE (AI JÁDRO)
Tento soubor je srdcem celé AI analýzy. Obsahuje logiku pro komunikaci s modely (vLLM, Google Gemini atd.),
přípravu promptů a následné čištění (parsování) odpovědí tak, aby z nich systém mohl vyčerpat data.
"""

import asyncio
import json
import logging
import os
import re
import time as _time
import httpx
from openai import AsyncOpenAI
from sqlalchemy.orm import Session
from core.config import settings
from models.db_models import AppSettings

logger = logging.getLogger("evaluz.llm")


# Adresář pro post-mortem dumpy LLM výstupů, které spadly při JSON parsování.
# V Dockeru je mountnut jako persistentní volume (./logs/llm_parse_errors).
LLM_PARSE_ERROR_DIR = "/app/logs/llm_parse_errors"


def _dump_raw_llm_output(prefix: str, raw: str, error: Exception) -> str:
    """Uloží syrový LLM výstup pro pozdější diagnostiku JSON parse erroru.

    Vrací cestu k uloženému souboru pro logování. Při selhání zápisu vrací popis chyby.
    """
    try:
        os.makedirs(LLM_PARSE_ERROR_DIR, exist_ok=True)
        # Sanitizace prefixu pro filename (jména studentů obsahují diakritiku, mezery, závorky).
        safe_prefix = re.sub(r'[^a-zA-Z0-9_\-]', '_', prefix)[:80] or "unknown"
        timestamp = int(_time.time())
        path = os.path.join(LLM_PARSE_ERROR_DIR, f"{timestamp}_{safe_prefix}.txt")
        with open(path, 'w', encoding='utf-8') as f:
            f.write(f"=== ERROR ===\n{type(error).__name__}: {error}\n")
            err_pos = getattr(error, 'pos', None)
            if isinstance(err_pos, int):
                f.write(f"position: char {err_pos}\n")
                start = max(0, err_pos - 50)
                end = min(len(raw), err_pos + 50)
                f.write(f"context: ...{raw[start:end]}...\n")
            f.write(f"\n=== RAW LLM OUTPUT ({len(raw)} chars) ===\n{raw}\n")
        return path
    except Exception as dump_err:
        return f"[dump failed: {dump_err}]"


_CRITERION_PREFIX_RE = re.compile(r'^\**\s*\d+\.\s*Krit[eé]rium\s*:?\s*', re.IGNORECASE)
# Person-suffix heuristika: poslední ` – ` (em-dash, en-dash, hyphen) následované
# vzorem dvou Velkých-slov (jméno + příjmení s českou diakritikou) až do konce.
# Aplikuje se POUZE na poslední segment, aby nepoškodila popisné pomlčky typu
# "Ztotožnění osoby – minimálně jméno, příjmení, datum narození".
_PERSON_SUFFIX_RE = re.compile(
    r'\s*[–—-]\s*[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][a-záčďéěíňóřšťúůýž]+'
    r'(?:\s+[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][a-záčďéěíňóřšťúůýž]+){1,3}\s*$'
)


def _canonicalize_criterion_name(name: str) -> str:
    """Vrací kanonickou (porovnávací) podobu názvu kritéria.

    Aplikuje:
    1) Strip prefixu `**N. Kritérium:`/`N. Kritérium:` (LLM někdy zkopíruje formát z promptu).
    2) Strip trailing `**` z markdown bold.
    3) Strip person-specific suffixu (poslední ` – Jméno Příjmení`) — heuristika pro multi-person ÚZ,
       kde model "personalizuje" generické kritérium jménem osoby z textu.
    4) Lower-case + strip whitespace.

    NEodstraňuje popisné pomlčky uprostřed (např. "minimálně jméno, příjmení, datum narození")
    — heuristika je kotvená na konec stringu (`$`).
    """
    if not isinstance(name, str):
        return ""
    s = _CRITERION_PREFIX_RE.sub('', name).strip()
    # Strip trailing markdown bold (`**`) — LLM někdy zkopíruje celé `**N. Kritérium: X**`
    s = re.sub(r'\*+\s*$', '', s).strip()
    # Iteruj: může být víc person-suffixů za sebou (např. "X – Jan Novák – Tadeáš Kadlec")
    while True:
        new_s = _PERSON_SUFFIX_RE.sub('', s).strip()
        if new_s == s:
            break
        s = new_s
    return s.lower().strip()


def _validate_and_fix_vysledky(
    parsed: dict,
    expected_criteria_names: list[str],
    prefix: str,
    expected_criteria_bodies: dict[str, int] | None = None,
) -> None:
    """FIX A: Kanonický match LLM výstupu vůči vstupním kritériím.

    Změna od v3.9.5 → 3.9.6:
    - Místo exact match kanonizace (strip prefix `N. Kritérium:`, strip person suffix `– Jan Novák`).
    - Zachovaná položka má normalizovaný `nazev` (odpovídající expected) pro UI konzistenci.
    - Původní LLM-vrácený název se ukládá do `_llm_actual_name` pro audit.

    Změna od v3.9.7 → 3.9.8:
    - Fronta místo dict: každé expected kritérium je nezávislá položka ve frontě.
      Pokud dvě kritéria sdílí stejný kanonický základ (VTOS: "Ztotožnění osoby – Kadlec"
      a "Ztotožnění osoby – Horáková" → oba canonical "ztotožnění osoby"), dřívější dict
      uložil jen jedno a druhé se "ztratilo" — nikdy se nepřidalo jako placeholder.
      Fronta (list) umožňuje mít N slotů pro N kritérií se stejným základem.
    - expected_criteria_bodies: body hodnota z DB se použije po matchování místo hodnoty
      z LLM. Model (Gemma4, qwen varianty) někdy vrátí splneno=true ale body=0, nebo
      špatnou bodovou hodnotu. DB je autoritativní zdroj pro body.

    Upravuje `parsed` in-place. Přepočítá celkove_skore.
    """
    from collections import defaultdict
    returned_results = parsed.get('vysledky', [])

    # Fronta: kanonický klíč → [expected_name_1, expected_name_2, ...] (FIFO)
    # Každé kritérium = samostatný slot — dvě kritéria se stejným základem = dva sloty.
    canonical_queue: dict[str, list[str]] = defaultdict(list)
    for n in expected_criteria_names:
        canon = _canonicalize_criterion_name(n)
        if canon:
            canonical_queue[canon].append(n)

    known = []
    unknown_names = []
    duplicate_names = []

    for v in returned_results:
        actual_name = v.get('nazev', '')
        canonical = _canonicalize_criterion_name(actual_name)

        if canonical_queue.get(canonical):
            # Pop ze fronty — každý slot spotřebuje jen jednu položku
            expected_name = canonical_queue[canonical].pop(0)
            if actual_name != expected_name:
                v['_llm_actual_name'] = actual_name
            v['nazev'] = expected_name

            # Normalizace body: autoritativní hodnota z DB (splneno=True), 0 (splneno=False).
            # Model nemůže ovlivnit počet bodů — body hodnota v DB je ground truth.
            if v.get('splneno', False):
                if expected_criteria_bodies and expected_name in expected_criteria_bodies:
                    v['body'] = expected_criteria_bodies[expected_name]
                # Pokud body z DB není k dispozici, ponecháme co model vrátil (fallback)
            else:
                v['body'] = 0

            known.append(v)
        elif canonical in canonical_queue:
            # Fronta pro tento canonical je prázdná → model vrátil kritérium vícekrát (multi-person).
            duplicate_names.append(actual_name)
        else:
            unknown_names.append(actual_name or '<bez názvu>')

    if unknown_names:
        logger.warning(f"{prefix}⚠ Odfiltrováno {len(unknown_names)} neznámých kritérií "
              f"(ani po kanonizaci): "
              f"{unknown_names[:3]}{'...' if len(unknown_names) > 3 else ''}")
    if duplicate_names:
        logger.info(f"{prefix}ℹ Multi-person duplikáty ({len(duplicate_names)} položek) — zachovávám jen první výskyt")

    # Chybějící = vše, co ve frontách zbývá (model je nevyhodnotil)
    missing = [name for slots in canonical_queue.values() for name in slots]
    if missing:
        logger.warning(f"{prefix}⚠ LLM vynechal {len(missing)} kritérií — doplňuji jako placeholdery: "
              f"{missing[:3]}{'...' if len(missing) > 3 else ''}")
        for name in missing:
            known.append({
                "nazev": name,
                "splneno": False,
                "body": 0,
                "oduvodneni": "⚠ Kritérium nebylo v odpovědi LLM. Vyžaduje manuální revizi nebo re-evaluaci.",
                "citace": "",
                "_llm_omitted": True,
            })

    # Seřadit výstup podle původního pořadí expected_criteria_names.
    # Model vrací kritéria v libovolném pořadí — bez řazení frontend očísluje
    # kritérium č. 18 jako "1." apod. Řazení zajistí, že 1. kritérium je vždy první.
    order_map = {name: i for i, name in enumerate(expected_criteria_names)}
    known.sort(key=lambda v: order_map.get(v.get('nazev', ''), len(expected_criteria_names)))

    parsed['vysledky'] = known
    # Přepočet celkove_skore — nespoléháme na model (může se spočítat špatně).
    parsed['celkove_skore'] = sum(
        v.get('body', 0) for v in known
        if isinstance(v.get('body'), (int, float)) and v.get('splneno', False)
    )
    # v3.9.10: Autoritativní max_skore = součet body všech očekávaných kritérií z DB.
    # Frontend má tedy jednoznačné max — ne počet kritérií, ne sum z vysledky (tam mají
    # nesplněná kritéria body=0 po normalizaci).
    if expected_criteria_bodies:
        parsed['max_skore'] = sum(expected_criteria_bodies.values())



def _sanitize_json_string_values(text: str) -> str:
    """
    Opravuje neescapované znaky uvnitř JSON řetězcových hodnot.

    Problém: model kopíruje věty z ÚZ do pole "citace" doslova, včetně uvozovek
    nebo literálních odřádkování, které rozbijí JSON strukturu.
    Typická chyba: 'Expecting "," delimiter' — model zapsal "Řekl: "Vstaňte!"" a
    parser ukončil string u první vnitřní uvozovky, pak narazil na text místo ','.

    Algoritmus:
    - Scannuje znak po znaku, při detekci otevírací " přejde do "string mode".
    - Uvnitř stringu každé " je potenciální konec — rozhodnutí se dělá look-aheadem:
      pokud za " (přeskočíme whitespace) následuje JSON strukturální znak ({[]},:),
      jde o konec stringu. Jinak jde o interní uvozovku → escapujeme na \".
    - Literální \\n, \\r, \\t uvnitř stringů jsou také escapovány.

    Volá se jako druhý pokus po selhání json.loads().
    """
    JSON_STRUCTURAL = frozenset('{[]},:')
    result = []
    i = 0
    n = len(text)

    while i < n:
        char = text[i]

        if char != '"':
            result.append(char)
            i += 1
            continue

        # Otevírací uvozovka — vstoupíme do string mode
        result.append('"')
        i += 1

        while i < n:
            c = text[i]

            if c == '\\' and i + 1 < n:
                next_char = text[i + 1]
                # Validní JSON escape sekvence: \" \\ \/ \b \f \n \r \t \uXXXX
                if next_char in '"\\/bfnrtu':
                    # Validní escape — zachovat beze změny
                    result.append(c)
                    result.append(next_char)
                    i += 2
                else:
                    # Osamocené zpětné lomítko — escapovat na \\
                    result.append('\\\\')
                    i += 1
            elif c == '"':
                # Potenciální konec stringu — look-ahead pro strukturální znak
                j = i + 1
                while j < n and text[j] in ' \t\r\n':
                    j += 1
                if j >= n or text[j] in JSON_STRUCTURAL:
                    # Legitimní konec stringu (následuje ,  :  }  ]  atd.)
                    break
                elif text[j] == '"':
                    # Další " — zjistíme, zda jde o začátek dalšího JSON klíče ("key":)
                    # Typický případ: model vynechal čárku a hned napsal další key-value pár.
                    k = j + 1
                    while k < n and text[k] not in ('"', '\n', '\r'):
                        k += 1
                    if k < n and text[k] == '"':
                        # Máme uzavírací " pro případný klíč — ověříme, že za ním je ':'
                        m = k + 1
                        while m < n and text[m] in ' \t':
                            m += 1
                        if m < n and text[m] == ':':
                            # Vzor "key": → aktuální " je skutečný konec hodnoty
                            break
                    # Jinak jde o uvozovku uvnitř hodnoty → escapovat
                    result.append('\\"')
                    i += 1
                else:
                    # Interní neescapovaná uvozovka → escapovat
                    result.append('\\"')
                    i += 1
            elif c == '\n':
                result.append('\\n')
                i += 1
            elif c == '\r':
                result.append('\\r')
                i += 1
            elif c == '\t':
                result.append('\\t')
                i += 1
            else:
                # Kontrolní znaky (0x00–0x1F, kromě již zachycených \n \r \t) → \uXXXX
                if ord(c) < 0x20:
                    result.append(f'\\u{ord(c):04x}')
                else:
                    result.append(c)
                i += 1

        result.append('"')
        i += 1  # přeskočit uzavírající uvozovku

    return ''.join(result)



async def _llm_call_with_overflow_retry(client, kwargs: dict, prefix: str) -> object:
    """
    Provede LLM volání; při HTTP 400 'context length exceeded' zredukuje
    max_tokens na hodnotu, která se do okna vejde, a zkusí to znovu.
    """
    try:
        return await client.chat.completions.create(**kwargs)
    except Exception as e:
        err = str(e)
        if "maximum context length" in err:
            m = re.search(
                r"maximum context length is (\d+).*?(\d+) in the messages",
                err, re.DOTALL
            )
            if m:
                limit = int(m.group(1))
                input_tokens = int(m.group(2))
                safe_tokens = max(512, limit - input_tokens - 300)
                logger.warning(f"{prefix}Context overflow ({input_tokens}+{kwargs['max_tokens']}>{limit})"
                      f" — retry s max_tokens={safe_tokens}")
                retry_kwargs = {**kwargs, "max_tokens": safe_tokens}
                return await client.chat.completions.create(**retry_kwargs)
        raise


def _resolve_platform(platform: str, api_url: str) -> str:
    """
    Vrátí skutečnou platformu na základě URL — URL má přednost před nastavením.
    Chrání před špatnou konfigurací (např. platform=vllm + OpenRouter URL).
    """
    if "openrouter.ai" in api_url:
        return "openrouter"
    if "openai.com" in api_url:
        return "openai"
    return platform  # vllm, ollama, lmstudio


def _build_llm_kwargs(platform: str, enable_thinking: bool, context_window: int, response_format_json: bool) -> dict:
    """
    Vrátí platform-specifické extra kwargs pro OpenAI client.
    - vllm: extra_body s enable_thinking (proprietární parametr vLLM serveru)
    - ollama: extra_body s num_ctx (kontextové okno)
    - openrouter / openai / lmstudio: žádné extra parametry
    """
    extra = {}
    if response_format_json:
        extra["response_format"] = {"type": "json_object"}
    if platform == "vllm":
        extra["extra_body"] = {
            "enable_thinking": enable_thinking,
            "chat_template_kwargs": {"enable_thinking": enable_thinking}
        }
    elif platform == "openrouter":
        extra["extra_body"] = {
            "reasoning": {"enabled": enable_thinking},
            "chat_template_kwargs": {"enable_thinking": enable_thinking},
        }
    elif platform == "ollama":
        extra["extra_body"] = {"num_ctx": context_window}
    # openai, lmstudio — žádné proprietární extra_body
    return extra

PLATFORM_CONTEXT_DEFAULTS: dict[str, int] = {
    "vllm": 131072,
    "openrouter": 8192,
    "ollama": 8192,
    "openai": 128000,
    "lmstudio": 8192,
}


def _estimate_tokens(text: str) -> int:
    """Odhadne počet tokenů podle délky textu (~3,5 znaku/token pro češtinu)."""
    return max(1, int(len(text) / 3.5))


def _get_setting(db: "Session", key: str, default: str) -> str:
    """Čte AppSettings z DB; pokud klíč neexistuje nebo je prázdný, vrátí default."""
    row = db.query(AppSettings).filter(AppSettings.key == key).first()
    if row and row.value:
        return row.value
    return default


CRITERIA_DELIMITER = "#############"
"""Unikátní oddělovač jednotlivých kritérií v promptu (od v3.9.6).

Použit z `evaluate.py` při sestavování `criteria_str` a v `_split_criteria_chunks`.
Volba `#############` je záměrně netypická — nemá kolizi s běžným textem ÚZ ani s markdown
syntaxí. Modelu poskytuje jasný signál "tady je další kritérium", což snižuje pravděpodobnost,
že kritéria splete dohromady nebo přidá vlastní.

Zpětná kompatibilita: pokud markdown delimiter neobsahuje (legacy data), parser
sáhne po regexovém fallbacku na `**N. Kritérium`.
"""


def _split_criteria_chunks(criteria_markdown: str, chunk_size: int = 6) -> list[str]:
    """
    Splits criteria markdown into chunks of at most chunk_size criteria each.

    Primary strategy (od v3.9.6): split podle delimiteru `#############`.
    Sekundární strategie (legacy): split podle číslovaných header `**N. Kritérium`.
    Fallback: blank-line split.
    """
    # Primary: delimiter-based split (od v3.9.6)
    if CRITERIA_DELIMITER in criteria_markdown:
        parts = [p.strip() for p in criteria_markdown.split(CRITERIA_DELIMITER) if p.strip()]
        if parts:
            join_str = f'\n\n{CRITERIA_DELIMITER}\n\n'
            return [join_str.join(parts[i:i + chunk_size])
                    for i in range(0, len(parts), chunk_size)]

    # Legacy: regex lookahead na **N. Kritérium
    parts = re.split(r'\n+(?=\*\*\d+\.\s*Kritérium)', criteria_markdown)
    criteria_blocks = [p.strip() for p in parts if re.match(r'\*\*\d+\.\s*Kritérium', p.strip())]
    if not criteria_blocks:
        blocks = [b.strip() for b in criteria_markdown.strip().split('\n\n') if b.strip()]
        return ['\n\n'.join(blocks[i:i + chunk_size]) for i in range(0, len(blocks), chunk_size)]
    return ['\n\n---\n\n'.join(criteria_blocks[i:i + chunk_size])
            for i in range(0, len(criteria_blocks), chunk_size)]


async def _evaluate_chunk(
    client, chunk_criteria: str, report_text: str,
    system_prompt: str, platform: str, enable_thinking: bool,
    context_window: int, max_tokens: int, top_p: float,
    presence_penalty: float, frequency_penalty: float,
    model_name: str, prefix: str, chunk_idx: int
) -> dict:
    """Evaluates one chunk of criteria. Returns partial dict with 'identita' and 'vysledky'."""
    # Adaptivní max_tokens: 500 tokenů/kritérium + 300 overhead (identita + JSON struktura).
    # Původní hodnota 350 byla kalibrovaná na anglickou tokenizaci (~2,5 zn/token).
    # Česká diakritika tokenizuje hustěji (~1,5–1,7 zn/token), takže 350 nestačilo pro
    # obsahově bohaté ÚZ (dialog, právní citace) — model narazil na limit a vLLM JSON mode
    # truncoval výstup uprostřed 4. kritéria, což způsobovalo JSON parse error (22/25 kritérií).
    # 500 tokenů/kritérium = přibližně 750–850 znaků na kritérium → dostatečná rezerva.
    # Spočítej kritéria: primárně podle delimiteru (v3.9.6+), fallback na header regex.
    if CRITERIA_DELIMITER in chunk_criteria:
        n_criteria = chunk_criteria.count(CRITERIA_DELIMITER) + 1
    else:
        n_criteria = len(re.findall(r'\*\*\d+\.\s*Kritérium', chunk_criteria)) or 1
    chunk_max_tokens = min(max_tokens, n_criteria * 500 + 300)

    user_prompt = f"""DŮLEŽITÉ: Výstupem tvé odpovědi musí být výhradně validní JSON — žádný jiný text, markdown ani komentáře.
Vyhodnoť PRÁVĚ {n_criteria} kritérií uvedených níže — ne méně, ne více.
Jednotlivá kritéria jsou oddělena řetězcem `{CRITERIA_DELIMITER}`. Vrať přesně tolik položek
v poli `vysledky`, kolik je kritérií. Každé kritérium hodnotíš JEN JEDNOU, i když se v textu
ÚZ vyskytuje více osob — kritéria se týkají hlavního subjektu zákroku, ne vedlejších osob.
Do pole `nazev` zkopíruj DOSLOVA název kritéria z hlavičky (text za "Kritérium:" do konce řádku),
bez přidávání jmen osob nebo jiného kontextu.

### KRITÉRIA K VYHODNOCENÍ:
{chunk_criteria}

### TEXT ÚŘEDNÍHO ZÁZNAMU (ÚZ):
{report_text}

Požadovaná struktura JSON odpovědi:
{{
    "identita": {{
        "hodnost": "prap.",
        "jmeno": "Jan",
        "prijmeni": "Novák"
    }},
    "vysledky": [
        {{
            "nazev": "název kritéria (doslovně z hlavičky, bez čísla a bez jmen osob)",
            "splneno": true/false,
            "body": počet_bodů,
            "oduvodneni": "1–2 věty: co jsi hledal a co jsi (ne)nalezl",
            "citace": "doslovná věta z textu ÚZ nebo Chybí"
        }}
    ]
}}
"""

    use_json_mode = platform in ("vllm", "openai")
    kwargs = {
        "model": model_name,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.1,
        "top_p": top_p,
        "presence_penalty": presence_penalty,
        "frequency_penalty": frequency_penalty,
        "max_tokens": chunk_max_tokens,
    }
    kwargs.update(_build_llm_kwargs(platform, enable_thinking, context_window, use_json_mode))

    chunk_prefix = f"{prefix}[chunk {chunk_idx}] "
    logger.info(f"{chunk_prefix}n_criteria={n_criteria}, max_tokens={chunk_max_tokens}")

    async def _call_and_parse(call_kwargs: dict, attempt_label: str) -> dict:
        response = await _llm_call_with_overflow_retry(client, call_kwargs, chunk_prefix)
        msg_content = response.choices[0].message.content or ""
        raw = msg_content.strip()
        reasoning = getattr(response.choices[0].message, 'reasoning', None)
        logger.info(f"{chunk_prefix}[{attempt_label}] content_len={len(raw)}, reasoning_len={len(reasoning) if reasoning else 0}")

        clean_text = re.sub(r"<(think|thought)>.*?(</\1>|$)", "", raw, flags=re.DOTALL | re.IGNORECASE).strip()
        s = clean_text.find('{')
        e = clean_text.rfind('}')
        if s == -1 or e == -1 or s > e:
            logger.error(f"{chunk_prefix}[{attempt_label}] CRITICAL: JSON nenalezen")
            return {"identita": {}, "vysledky": []}

        json_slice = clean_text[s:e + 1]
        try:
            return json.loads(json_slice)
        except json.JSONDecodeError as err:
            if logger.isEnabledFor(logging.DEBUG):
                dump_path = _dump_raw_llm_output(f"{chunk_prefix}{attempt_label}", json_slice, err)
                logger.debug(f"{chunk_prefix}[{attempt_label}] raw dump: {dump_path}")
            logger.warning(f"{chunk_prefix}[{attempt_label}] JSON parse error: {err} — sanitizace stringů")
            sanitized = _sanitize_json_string_values(json_slice)
            try:
                result = json.loads(sanitized)
                logger.info(f"{chunk_prefix}[{attempt_label}] JSON opraven sanitizací ✓")
                return result
            except json.JSONDecodeError:
                logger.error(f"{chunk_prefix}[{attempt_label}] sanitizace nestačila — chunk selhal")
                raise ValueError(f"Chunk {chunk_idx}: model nevrátil validní JSON.")

    parsed = await _call_and_parse(kwargs, "try1")
    logger.info(f"{chunk_prefix}{len(parsed.get('vysledky', []))} kritérií OK")
    return parsed


async def _generate_individual_feedback(
    merged: dict,
    db,
    client,
    platform: str,
    model_name: str,
    enable_thinking: bool,
    context_window: int,
    top_p: float,
    presence_penalty: float,
    frequency_penalty: float,
    prefix: str
) -> str:
    """
    Generuje individuální zpětnou vazbu pro studenta na základě sloučených výsledků evaluace.
    Samostatné LLM volání po merge — lektor dostane personalizované shrnutí bez ohledu na chunking.
    Prompt se načítá z DB (phase_name='prompt_feedback') — konfigurovatelný v Administraci.
    """
    from models.db_models import SystemPrompt as _SystemPrompt
    prompt_record = db.query(_SystemPrompt).filter(_SystemPrompt.phase_name == "prompt_feedback").first()
    if not prompt_record or not prompt_record.content.strip():
        logger.info(f"{prefix}[feedback] Prompt 'prompt_feedback' nenalezen v DB — zpětná vazba přeskočena")
        return ""

    system_prompt = prompt_record.content
    temperature = prompt_record.temperature if prompt_record.temperature is not None else 0.5

    identita = merged.get("identita", {})
    student_name = " ".join(filter(None, [
        identita.get("hodnost", ""), identita.get("jmeno", ""), identita.get("prijmeni", "")
    ])).strip() or "Student"
    celkove_skore = merged.get("celkove_skore", 0)
    vysledky = merged.get("vysledky", [])

    splnena = [v["nazev"] for v in vysledky if v.get("splneno")]
    nesplnena = [v["nazev"] for v in vysledky if not v.get("splneno")]

    user_content = (
        f"Student: {student_name}\n"
        f"Celkové skóre: {celkove_skore} bodů\n"
        f"Splněná kritéria ({len(splnena)}): {', '.join(splnena) if splnena else 'žádné'}\n"
        f"Nesplněná kritéria ({len(nesplnena)}): {', '.join(nesplnena) if nesplnena else 'žádné'}\n\n"
        f"Napiš individuální zpětnou vazbu pro tohoto studenta."
    )

    from models.db_models import AppSettings as _AppSettings
    db_fb_tokens = db.query(_AppSettings).filter(_AppSettings.key == "FEEDBACK_MAX_TOKENS").first()
    fb_max_tokens = int(db_fb_tokens.value) if db_fb_tokens and db_fb_tokens.value else 250

    kwargs = {
        "model": model_name,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content}
        ],
        "temperature": temperature,
        "top_p": top_p,
        "presence_penalty": presence_penalty,
        "frequency_penalty": frequency_penalty,
        "max_tokens": fb_max_tokens,
    }
    kwargs.update(_build_llm_kwargs(platform, enable_thinking, context_window, response_format_json=False))

    est_fb = _estimate_tokens(system_prompt + user_content)
    logger.info(f"{prefix}[feedback] Generuji zpětnou vazbu — input ~{est_fb} tokenů, max_tokens={fb_max_tokens} ({len(splnena)} splněno, {len(nesplnena)} nesplněno)...")
    _t0_fb = _time.monotonic()
    try:
        response = await _llm_call_with_overflow_retry(client, kwargs, f"{prefix}[feedback] ")
        feedback = (response.choices[0].message.content or "").strip()
        feedback = re.sub(r"<(think|thought)>.*?(</\1>|$)", "", feedback, flags=re.DOTALL | re.IGNORECASE).strip()
        logger.info(f"{prefix}[feedback] OK — {len(feedback)} znaků, trvalo {_time.monotonic()-_t0_fb:.1f}s")
        return feedback
    except Exception as e:
        logger.error(f"{prefix}[feedback] Chyba při generování: {e}")
        return ""


async def generate_feedback_for_record(merged: dict, db: Session, student_log_prefix: str = "") -> str:
    """
    Veřejný wrapper: načte LLM nastavení z DB, vytvoří klienta a vygeneruje zpětnou vazbu.
    Voláno z evaluate.py jako background asyncio task po EVAL_SUCCESS.
    """
    db_url = db.query(AppSettings).filter(AppSettings.key == "VLLM_API_URL").first()
    db_key = db.query(AppSettings).filter(AppSettings.key == "VLLM_API_KEY").first()
    db_phase_model = db.query(AppSettings).filter(AppSettings.key == "MODEL_PHASE2").first()
    db_global_model = db.query(AppSettings).filter(AppSettings.key == "VLLM_MODEL_NAME").first()
    db_phase_thinking = db.query(AppSettings).filter(AppSettings.key == "THINKING_PHASE2").first()
    db_global_thinking = db.query(AppSettings).filter(AppSettings.key == "VLLM_ENABLE_THINKING").first()
    db_platform = db.query(AppSettings).filter(AppSettings.key == "LLM_PLATFORM").first()
    db_top_p = db.query(AppSettings).filter(AppSettings.key == "VLLM_TOP_P").first()
    db_presence = db.query(AppSettings).filter(AppSettings.key == "VLLM_PRESENCE_PENALTY").first()
    db_freq = db.query(AppSettings).filter(AppSettings.key == "VLLM_FREQUENCY_PENALTY").first()
    db_context = db.query(AppSettings).filter(AppSettings.key == "LLM_CONTEXT_WINDOW").first()

    api_url = db_url.value if db_url and db_url.value else ""
    model_name = (db_phase_model.value if db_phase_model and db_phase_model.value else "") or (db_global_model.value if db_global_model and db_global_model.value else "")
    api_key = db_key.value if db_key and db_key.value else ""
    thinking_value = (db_phase_thinking.value if db_phase_thinking and db_phase_thinking.value else "") or (db_global_thinking.value if db_global_thinking and db_global_thinking.value else "true")
    enable_thinking = (thinking_value.lower() == "true")
    raw_platform = db_platform.value if db_platform and db_platform.value else "vllm"
    top_p = float(db_top_p.value) if db_top_p and db_top_p.value else 0.95
    presence_penalty = float(db_presence.value) if db_presence and db_presence.value else 0.0
    frequency_penalty = float(db_freq.value) if db_freq and db_freq.value else 0.0
    context_window = int(db_context.value) if db_context and db_context.value else None

    if not api_url or not model_name:
        logger.warning(f"[FEEDBACK] LLM konfigurace chybí — zpětná vazba přeskočena")
        return ""

    if "openrouter.ai" in api_url and not api_url.endswith("/api/v1"):
        api_url = "https://openrouter.ai/api/v1"

    platform = _resolve_platform(raw_platform, api_url)
    prefix = f"[LOG - {student_log_prefix}] " if student_log_prefix else ""

    client = AsyncOpenAI(
        base_url=api_url,
        api_key=api_key or "sk-no-key-required",
        default_headers={"Authorization": f"Bearer {api_key}"} if api_key else None,
        http_client=httpx.AsyncClient(timeout=300.0)
    )
    return await _generate_individual_feedback(
        merged, db, client, platform, model_name, enable_thinking,
        context_window, top_p, presence_penalty, frequency_penalty, prefix
    )


def _merge_chunk_results(chunk_results: list[dict]) -> dict:
    """Merges partial chunk results into one evaluation dict."""
    all_vysledky = []
    identita = {}
    json_repaired = False
    for result in chunk_results:
        if not identita and result.get("identita"):
            identita = result["identita"]
        all_vysledky.extend(result.get("vysledky", []))
        if result.get('_json_repaired'):
            json_repaired = True
    # Normalizace: body=0 pro nesplněná kritéria (model může vrátit body>0 i pro splneno=false).
    for e in all_vysledky:
        if not e.get('splneno', False):
            e['body'] = 0
    # Přepočet skóre z vysledky — model si může celkove_skore spočítat chybně.
    total_score = sum(
        e.get("body", 0) for e in all_vysledky
        if isinstance(e.get("body"), (int, float)) and e.get("splneno", False)
    )
    merged = {
        "identita": identita,
        "vysledky": all_vysledky,
        "celkove_skore": total_score,
        "zpetna_vazba": "",
    }
    if json_repaired:
        merged['_json_repaired'] = True
    return merged


async def evaluate_report(report_text: str, criteria_markdown: str, system_prompt: str, db: Session, scenario_id: str = None, student_log_prefix: str = "", lecturer_id: int = None, expected_criteria_names: list[str] = None, expected_criteria_bodies: dict[str, int] | None = None) -> dict:
    """
    HLAVNÍ FUNKCE PRO EVALUACI (Fáze 2).
    Bere text studenta a zadaná kritéria, posílá je modelu a vrací vyčištěný JSON výsledek.
    """
    
    # 1. NAČTENÍ NASTAVENÍ: Vše se bere z databáze (z Administrace), aby uživatel mohl měnit modely za běhu.
    db_url = db.query(AppSettings).filter(AppSettings.key == "VLLM_API_URL").first()
    db_key = db.query(AppSettings).filter(AppSettings.key == "VLLM_API_KEY").first()
    
    # Per-task model: try MODEL_PHASE2 first, then fall back to global VLLM_MODEL_NAME
    db_phase_model = db.query(AppSettings).filter(AppSettings.key == "MODEL_PHASE2").first()
    db_global_model = db.query(AppSettings).filter(AppSettings.key == "VLLM_MODEL_NAME").first()
    
    # Per-task thinking: try THINKING_PHASE2 first, then fall back to global VLLM_ENABLE_THINKING
    db_phase_thinking = db.query(AppSettings).filter(AppSettings.key == "THINKING_PHASE2").first()
    db_global_thinking = db.query(AppSettings).filter(AppSettings.key == "VLLM_ENABLE_THINKING").first()
    
    api_url = db_url.value if db_url and db_url.value else ""
    model_name = (db_phase_model.value if db_phase_model and db_phase_model.value else "") or (db_global_model.value if db_global_model and db_global_model.value else "")
    api_key = db_key.value if db_key and db_key.value else ""
    
    enable_thinking = True
    thinking_value = (db_phase_thinking.value if db_phase_thinking and db_phase_thinking.value else "") or (db_global_thinking.value if db_global_thinking and db_global_thinking.value else "true")
    enable_thinking = (thinking_value.lower() == 'true')
    
    db_platform = db.query(AppSettings).filter(AppSettings.key == "LLM_PLATFORM").first()
    db_top_p = db.query(AppSettings).filter(AppSettings.key == "VLLM_TOP_P").first()
    db_presence = db.query(AppSettings).filter(AppSettings.key == "VLLM_PRESENCE_PENALTY").first()
    db_freq = db.query(AppSettings).filter(AppSettings.key == "VLLM_FREQUENCY_PENALTY").first()
    db_context = db.query(AppSettings).filter(AppSettings.key == "LLM_CONTEXT_WINDOW").first()
    db_max_tokens = db.query(AppSettings).filter(AppSettings.key == "VLLM_MAX_TOKENS").first()
    
    raw_platform = db_platform.value if db_platform and db_platform.value else "vllm"
    top_p = float(db_top_p.value) if db_top_p and db_top_p.value else 0.95
    presence_penalty = float(db_presence.value) if db_presence and db_presence.value else 0.0
    frequency_penalty = float(db_freq.value) if db_freq and db_freq.value else 0.0
    context_window = int(db_context.value) if db_context and db_context.value else None
    max_tokens = int(db_max_tokens.value) if db_max_tokens and db_max_tokens.value else 4096

    if not api_url or not model_name:
        raise ValueError("LLM konfigurace (URL nebo Model) chybí v databázi. Nastavte je v Administraci.")

    # Normalizace OpenRouter URL
    if "openrouter.ai" in api_url and not api_url.endswith("/api/v1"):
        api_url = "https://openrouter.ai/api/v1"

    # Skutečná platforma (URL má přednost před nastavením)
    platform = _resolve_platform(raw_platform, api_url)

    prefix = f"[LOG - {student_log_prefix}] " if student_log_prefix else ""
    logger.info(f"{prefix}LLM volání: platform={platform}, url={api_url}, model={model_name}")

    client = AsyncOpenAI(
        base_url=api_url,
        api_key=api_key or "sk-no-key-required",
        default_headers={"Authorization": f"Bearer {api_key}"} if api_key else None,
        http_client=httpx.AsyncClient(timeout=300.0)
    )

    strict_system_prompt = system_prompt

    # ADAPTIVNÍ CHUNKING: pokud celý prompt + ÚZ + kritéria + max_tokens vejde do kontextového okna,
    # pošleme vše v jednom volání (méně HTTP roundtripů, méně chyb merge).
    # Pro modely s 8k kontextem (legacy OpenRouter) chunking zůstane aktivní.
    chunk_size = int(_get_setting(db, "CHUNK_SIZE", "6"))
    threshold_pct = float(_get_setting(db, "CHUNK_THRESHOLD_TOKENS_PCT", "0.7"))
    ctx = context_window or PLATFORM_CONTEXT_DEFAULTS.get(platform, 8192)
    budget = int(ctx * threshold_pct)
    est = _estimate_tokens(strict_system_prompt + report_text + criteria_markdown) + max_tokens
    logger.info(f"{prefix}Token odhad: est={est}, budget={budget} ({threshold_pct*100:.0f}% z ctx={ctx}) → {'single-call' if est <= budget else f'chunking ({chunk_size}/chunk)'}")
    chunks = [criteria_markdown] if est <= budget else _split_criteria_chunks(criteria_markdown, chunk_size)
    if len(chunks) > 1:
        logger.info(f"{prefix}Chunking: {len(chunks)} chunks á max {chunk_size} kritérií — asyncio.gather")
        _t0_chunks = _time.monotonic()
        tasks = [
            _evaluate_chunk(
                client=client,
                chunk_criteria=chunk,
                report_text=report_text,
                system_prompt=strict_system_prompt,
                platform=platform,
                enable_thinking=enable_thinking,
                context_window=context_window,
                max_tokens=max_tokens,
                top_p=top_p,
                presence_penalty=presence_penalty,
                frequency_penalty=frequency_penalty,
                model_name=model_name,
                prefix=prefix,
                chunk_idx=i + 1,
            )
            for i, chunk in enumerate(chunks)
        ]
        chunk_results = await asyncio.gather(*tasks)
        merged = _merge_chunk_results(list(chunk_results))
        logger.info(f"{prefix}Chunking hotov za {_time.monotonic()-_t0_chunks:.1f}s — {len(merged['vysledky'])} kritérií, skóre={merged['celkove_skore']}")
        if expected_criteria_names:
            _validate_and_fix_vysledky(merged, expected_criteria_names, prefix, expected_criteria_bodies)
        merged["zpetna_vazba"] = ""
        return merged

    # 2. PŘÍPRAVA PROMPTU: Tady dáváme modelu přesné instrukce, jak má JSON vypadat.
    # Používáme F-stringy pro vložení textu ÚZ a kritérií přímo do pokynů.
    n_criteria_total = len(expected_criteria_names) if expected_criteria_names else (
        criteria_markdown.count(CRITERIA_DELIMITER) + 1 if CRITERIA_DELIMITER in criteria_markdown else 0
    )
    user_prompt = f"""
    ### SEZNAM KRITÉRIÍ K VYHODNOCENÍ (TOTO JSOU JEDINÉ POLOŽKY, KTERÉ CHCI V JSONU):
    {criteria_markdown}

    ### TEXT ÚŘEDNÍHO ZÁZNAMU (ÚZ) K VYHODNOCENÍ:
    {report_text}

    Jednotlivá kritéria jsou oddělena řetězcem `{CRITERIA_DELIMITER}`. Vrať PRÁVĚ {n_criteria_total or 'tolik'} položek
    v poli `vysledky` — pro každé kritérium z výše uvedeného seznamu jednu položku, ne víc, ne méně.
    Každé kritérium hodnotíš JEN JEDNOU, i když se v textu ÚZ vyskytuje více osob — kritéria se týkají
    hlavního subjektu zákroku (osoby, která je předmětem služebního úkonu), ne vedlejších osob.
    Do pole `nazev` zkopíruj DOSLOVA název kritéria z hlavičky (text za "Kritérium:" do konce řádku),
    bez přidávání jmen osob nebo jiného kontextu z textu ÚZ.

    Požadovaná struktura JSON odpovědi (identita je POVINNÁ):
    Vždy přesně identifikuj PŘÍJMENÍ (to bude sloužit jako hlavní řadící klíč).
    {{
        "identita": {{
            "hodnost": "prap.",
            "jmeno": "Jan",
            "prijmeni": "Novák"
        }},
        "vysledky": [
            {{
                "nazev": "název kritéria (doslovně z hlavičky, bez čísla a bez jmen osob)",
                "splneno": true/false,
                "body": počet_bodů,
                "oduvodneni": "tvůj proces myšlení a zdůvodnění zde",
                "citace": "přesná věta z textu dokazující splnění/nesplnění"
            }}
        ],
        "celkove_skore": celkový_součet_bodů,
        "zpetna_vazba": "celkové shrnutí a doporučení pro studenta"
    }}
    
    IMPORTANT: Výsledkem tvé odpovědi MUSÍ být validní JSON! 
    NEPIŠ ŽÁDNÝ JINÝ TEXT OKOLO, ŽÁDNÉ VYSVĚTLIVKY ANI MARKDOWN BLOKY (např. ```json).
    """

    if logger.isEnabledFor(logging.DEBUG): logger.debug(f"{prefix}FINAL PROMPT TO LLM:\n{user_prompt}\n<<< END OF PROMPT")

    try:
        kwargs = {
            "model": model_name,
            "messages": [
                {"role": "system", "content": strict_system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            "temperature": 0.1, # Low temperature for analytical consistency
            "top_p": top_p,
            "presence_penalty": presence_penalty,
            "frequency_penalty": frequency_penalty,
            "max_tokens": max_tokens
        }

        # JSON mode: vLLM a OpenAI ho podporují spolehlivě; OpenRouter/Ollama/LM Studio ne
        use_json_mode = platform in ("vllm", "openai")
        kwargs.update(_build_llm_kwargs(platform, enable_thinking, context_window, use_json_mode))
            
        # Voláme model (s automatickým retry při context overflow).
        _t0_llm = _time.monotonic()
        response = await _llm_call_with_overflow_retry(client, kwargs, prefix)

        # 3. PARSOVÁNÍ VÝSLEDKU: AI modely občas píší víc, než chceme. Tady odpověď čistíme.
        msg_content = response.choices[0].message.content or ""
        raw_response = msg_content.strip()

        # Logování délky surové odpovědi pro diagnostiku
        reasoning = getattr(response.choices[0].message, 'reasoning', None)
        logger.info(f"{prefix}Single-call hotov za {_time.monotonic()-_t0_llm:.1f}s — content_len={len(raw_response)}, reasoning_len={len(reasoning) if reasoning else 0}")
        if not raw_response:
            logger.warning(f"{prefix}VAROVÁNÍ: content je prázdný! model={model_name}, reasoning={'ANO' if reasoning else 'NE'}")

        # ODSTRANĚNÍ THOUGHT BLOKŮ: Některé modely (jako Qwen nebo DeepSeek) píší své "myšlenky" mezi <think> a </think>.
        clean_text = re.sub(r"<(think|thought)>.*?(</\1>|$)", "", raw_response, flags=re.DOTALL|re.IGNORECASE).strip()

        # Najdeme první '{' a poslední '}', abychom odsekli případný balast okolo.
        start_idx = clean_text.find('{')
        end_idx = clean_text.rfind('}')

        if start_idx == -1 or end_idx == -1 or start_idx > end_idx:
            logger.error(f"{prefix}CRITICAL ERROR: Odpověď LLM neobsahuje JSON (chybí {{ nebo }}). RAW RESPONSE (first 500):\n{raw_response[:500]}\n--- END RAW ---")
            raise ValueError("V odpovědi LLM nebyl nalezen žádný JSON objekt.")

        clean_response = clean_text[start_idx:end_idx+1]
        try:
            parsed = json.loads(clean_response)
        except json.JSONDecodeError as e:
            if logger.isEnabledFor(logging.DEBUG):
                dump_path = _dump_raw_llm_output(prefix, clean_response, e)
                logger.debug(f"{prefix}raw dump: {dump_path}")
            logger.warning(f"{prefix}JSON parse error: {e} — sanitizace stringů")
            sanitized = _sanitize_json_string_values(clean_response)
            try:
                parsed = json.loads(sanitized)
                logger.info(f"{prefix}JSON opraven sanitizací ✓")
            except json.JSONDecodeError:
                logger.error(f"{prefix}Sanitizace nestačila. Raw Response:\n{raw_response[:500]}")
                raise ValueError("Model nevrátil validní JSON. Zkontrolujte logy.")

        logger.info(f"{prefix}JSON úspěšně zparsován: klíče={list(parsed.keys())[:6]}")
        # FIX A: Validace shody s vstupními kritérii (filtruje halucinace, doplňuje chybějící)
        # _validate_and_fix_vysledky zároveň normalizuje body z DB a přepočítá celkove_skore.
        if expected_criteria_names:
            _validate_and_fix_vysledky(parsed, expected_criteria_names, prefix, expected_criteria_bodies)
        else:
            vysledky = parsed.get('vysledky', [])
            for v in vysledky:
                if not v.get('splneno', False):
                    v['body'] = 0
            parsed['celkove_skore'] = sum(
                v.get('body', 0) for v in vysledky
                if isinstance(v.get('body'), (int, float)) and v.get('splneno', False)
            )
        parsed["zpetna_vazba"] = ""
        return parsed

    except Exception as e:
        logger.error(f"{prefix}Error communicating with vLLM at {api_url}: {e}")
        raise

async def extract_identity(report_text: str, db: Session, student_log_prefix: str = "", lecturer_id: int = None) -> dict:
    """
    Rychlá extrakce identity studenta (jméno, příjmení a hodnost) pomocí LLM.
    Neprovádí žádnou evaluaci kritérií (šetrné na tokeny a čas).
    """
    db_url = db.query(AppSettings).filter(AppSettings.key == "VLLM_API_URL").first()
    db_key = db.query(AppSettings).filter(AppSettings.key == "VLLM_API_KEY").first()
    
    # Per-task model: try MODEL_EXTRACTION first, then fall back to global VLLM_MODEL_NAME
    db_extraction_model = db.query(AppSettings).filter(AppSettings.key == "MODEL_EXTRACTION").first()
    db_global_model = db.query(AppSettings).filter(AppSettings.key == "VLLM_MODEL_NAME").first()
    
    # Per-task thinking: try THINKING_EXTRACTION first, then fall back to global VLLM_ENABLE_THINKING
    db_extraction_thinking = db.query(AppSettings).filter(AppSettings.key == "THINKING_EXTRACTION").first()
    db_global_thinking = db.query(AppSettings).filter(AppSettings.key == "VLLM_ENABLE_THINKING").first()
    
    api_url = db_url.value if db_url and db_url.value else ""
    model_name = (db_extraction_model.value if db_extraction_model and db_extraction_model.value else "") or (db_global_model.value if db_global_model and db_global_model.value else "")
    api_key = db_key.value if db_key and db_key.value else ""
    
    enable_thinking = False # Default to false for fast scan
    thinking_value = (db_extraction_thinking.value if db_extraction_thinking and db_extraction_thinking.value else "") or (db_global_thinking.value if db_global_thinking and db_global_thinking.value else "false")
    enable_thinking = (thinking_value.lower() == 'true')
    
    db_platform = db.query(AppSettings).filter(AppSettings.key == "LLM_PLATFORM").first()
    db_top_p = db.query(AppSettings).filter(AppSettings.key == "VLLM_TOP_P").first()
    db_presence = db.query(AppSettings).filter(AppSettings.key == "VLLM_PRESENCE_PENALTY").first()
    db_freq = db.query(AppSettings).filter(AppSettings.key == "VLLM_FREQUENCY_PENALTY").first()
    db_context = db.query(AppSettings).filter(AppSettings.key == "LLM_CONTEXT_WINDOW").first()
    
    raw_platform = db_platform.value if db_platform and db_platform.value else "vllm"
    top_p = float(db_top_p.value) if db_top_p and db_top_p.value else 0.95
    presence_penalty = float(db_presence.value) if db_presence and db_presence.value else 0.0
    frequency_penalty = float(db_freq.value) if db_freq and db_freq.value else 0.0
    context_window = int(db_context.value) if db_context and db_context.value else 8192

    if not api_url or not model_name:
        return {}

    if "openrouter.ai" in api_url and not api_url.endswith("/api/v1"):
        api_url = "https://openrouter.ai/api/v1"

    platform = _resolve_platform(raw_platform, api_url)

    client = AsyncOpenAI(
        base_url=api_url,
        api_key=api_key or "sk-no-key-required",
        default_headers={"Authorization": f"Bearer {api_key}"} if api_key else None,
        http_client=httpx.AsyncClient(timeout=60.0)
    )
    
    logger.info(f"[FAST-SCAN] platform={platform}, model={model_name}")

    system_prompt = "Jsi asistent pro vytěžování dat z textu. Tvým úkolem je najít jméno, příjmení a hodnost studenta."
    
    # Use only the first and last ~500 chars to save tokens
    if len(report_text) > 1200:
        trimmed_text = report_text[:500] + "\n\n[...zkráceno...]\n\n" + report_text[-500:]
    else:
        trimmed_text = report_text
    
    user_prompt = f"""
    Z následujícího úředního záznamu (podpis a identifikace autora bývá většinou na konci) extrahuj hodnost, jméno a příjmení autora/studenta.
    
    TEXT ÚŘEDNÍHO ZÁZNAMU:
    {trimmed_text}
    
    Musíš vrátit POUZE striktní JSON objekt v tomto formátu (žádný jiný text okolo!):
    {{
        "identita": {{
            "hodnost": "prap.", 
            "jmeno": "Jan", 
            "prijmeni": "Novák"
        }}
    }}
    """
    
    try:
        kwargs = {
            "model": model_name,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            "temperature": 0.0,
            "top_p": top_p,
            "presence_penalty": presence_penalty,
            "frequency_penalty": frequency_penalty,
            "max_tokens": 1000 
        }
        
        use_json_mode = platform in ("vllm", "openai")
        kwargs.update(_build_llm_kwargs(platform, enable_thinking, context_window, use_json_mode))

        response = await client.chat.completions.create(**kwargs)

        msg_content = response.choices[0].message.content
        if not msg_content:
            logger.warning(f"[FAST-SCAN] Model vrátil prázdnou odpověď (content=None). Model: {model_name}")
            return {}
        
        raw_response = msg_content.strip()
        clean_text = re.sub(r"<(think|thought)>.*?</\1>", "", raw_response, flags=re.DOTALL|re.IGNORECASE).strip()
        
        start_idx = clean_text.find('{')
        end_idx = clean_text.rfind('}')
        if start_idx == -1 or end_idx == -1 or start_idx > end_idx:
            logger.warning(f"[FAST-SCAN] Missing JSON object. RAW: {raw_response}")
            return {}
            
        clean_response = clean_text[start_idx:end_idx+1]
        data = json.loads(clean_response)
        identity = data.get("identita", {})
        if identity:
            logger.info(f"[FAST-SCAN] Identita nalezena: {identity}")
        return identity
    except Exception as e:
        logger.error(f"Fast-scan identity exception: {e}")
        return {}

async def chat_completion(messages: list, system_prompt: str, temperature: float, db: Session, phase: str = None) -> str:
    """
    Sends a chat history to the local vLLM model. Supports phase-specific model configuration (e.g. Phase 1).
    """
    db_url = db.query(AppSettings).filter(AppSettings.key == "VLLM_API_URL").first()
    db_key = db.query(AppSettings).filter(AppSettings.key == "VLLM_API_KEY").first()
    db_platform = db.query(AppSettings).filter(AppSettings.key == "LLM_PLATFORM").first()
    db_top_p = db.query(AppSettings).filter(AppSettings.key == "VLLM_TOP_P").first()
    db_presence = db.query(AppSettings).filter(AppSettings.key == "VLLM_PRESENCE_PENALTY").first()
    db_freq = db.query(AppSettings).filter(AppSettings.key == "VLLM_FREQUENCY_PENALTY").first()
    db_max_tokens = db.query(AppSettings).filter(AppSettings.key == "VLLM_MAX_TOKENS").first()
    db_context = db.query(AppSettings).filter(AppSettings.key == "LLM_CONTEXT_WINDOW").first()
    
    # Per-phase model lookup
    model_name = ""
    enable_thinking = True
    
    if phase:
        phase_model_key = f"MODEL_{phase.upper()}"
        phase_thinking_key = f"THINKING_{phase.upper()}"
        
        db_phase_model = db.query(AppSettings).filter(AppSettings.key == phase_model_key).first()
        db_phase_thinking = db.query(AppSettings).filter(AppSettings.key == phase_thinking_key).first()
        
        if db_phase_model and db_phase_model.value:
            model_name = db_phase_model.value
        if db_phase_thinking and db_phase_thinking.value:
            enable_thinking = (db_phase_thinking.value.lower() == 'true')

    # Fallback to global if not found or no phase
    if not model_name:
        db_model = db.query(AppSettings).filter(AppSettings.key == "VLLM_MODEL_NAME").first()
        model_name = db_model.value if db_model and db_model.value else ""
        
        db_thinking = db.query(AppSettings).filter(AppSettings.key == "VLLM_ENABLE_THINKING").first()
        if db_thinking and db_thinking.value:
            enable_thinking = (db_thinking.value.lower() == 'true')
    
    api_url = db_url.value if db_url and db_url.value else ""
    raw_platform = db_platform.value if db_platform and db_platform.value else "vllm"
    api_key = db_key.value if db_key and db_key.value else ""

    if not api_url or not model_name:
        raise ValueError(f"LLM konfigurace chybí v databázi (Phase: {phase or 'Global'}).")

    if "openrouter.ai" in api_url and not api_url.endswith("/api/v1"):
        api_url = "https://openrouter.ai/api/v1"

    platform = _resolve_platform(raw_platform, api_url)

    top_p = float(db_top_p.value) if db_top_p and db_top_p.value else 0.95
    presence_penalty = float(db_presence.value) if db_presence and db_presence.value else 0.0
    frequency_penalty = float(db_freq.value) if db_freq and db_freq.value else 0.0
    
    # Razantní navýšení hardlimitu pro gpt-oss-120b a thinking modely
    max_tokens = int(db_max_tokens.value) if db_max_tokens and db_max_tokens.value else 6000
    context_window = int(db_context.value) if db_context and db_context.value else 8192
    
    logger.info(f">>> LLM volání směřuje na: {api_url} s modelem: {model_name}")

    client = AsyncOpenAI(
        base_url=api_url,
        api_key=api_key or "sk-no-key-required",
        default_headers={"Authorization": f"Bearer {api_key}"} if api_key else None,
        http_client=httpx.AsyncClient(timeout=300.0)
    )

    formatted_messages = [{"role": "system", "content": system_prompt}]
    
    # Expecting messages to be dictionaries with 'role' and 'content'
    for msg in messages:
        formatted_messages.append({"role": msg.get("role"), "content": msg.get("content")})

    try:
        kwargs = {
            "model": model_name,
            "messages": formatted_messages,
            "temperature": temperature,
            "top_p": top_p,
            "presence_penalty": presence_penalty,
            "frequency_penalty": frequency_penalty,
            "max_tokens": max_tokens
        }
        
        kwargs.update(_build_llm_kwargs(platform, enable_thinking, context_window, response_format_json=False))

        # Context overflow retry: Phase 3 třídní analýza posílá velké prompty;
        # když prompt_tokens + max_tokens > context_window, vLLM vrátí HTTP 400.
        response = await _llm_call_with_overflow_retry(client, kwargs, f"[chat_completion phase={phase or 'Global'}] ")
        return response.choices[0].message.content.strip()
    except Exception as e:
        logger.error(f"Error in chat_completion with vLLM at {api_url}: {e}")
        raise ValueError(f"Nepodařilo se spojit s LLM: {str(e)}")
