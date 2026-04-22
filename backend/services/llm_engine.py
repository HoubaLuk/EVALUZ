"""
MODUL: LLM ENGINE (AI JÁDRO)
Tento soubor je srdcem celé AI analýzy. Obsahuje logiku pro komunikaci s modely (vLLM, Google Gemini atd.),
přípravu promptů a následné čištění (parsování) odpovědí tak, aby z nich systém mohl vyčerpat data.
"""

import asyncio
import json
import re
import httpx
from openai import AsyncOpenAI
from sqlalchemy.orm import Session
from core.config import settings
from models.db_models import AppSettings


def _repair_truncated_json(text: str) -> dict | None:
    """
    Pokusí se obnovit JSON oříznutý LLM tokenovým limitem.
    Najde všechny kompletní záznamy v poli 'vysledky' a sestaví validní JSON.
    """
    vysledky_match = re.search(r'"vysledky"\s*:\s*\[', text)
    if not vysledky_match:
        return None

    arr_start = vysledky_match.end()
    entries = []
    depth = 0
    entry_start = None

    for i, c in enumerate(text[arr_start:], arr_start):
        if c == '{':
            if depth == 0:
                entry_start = i
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0 and entry_start is not None:
                try:
                    entries.append(json.loads(text[entry_start:i + 1]))
                except Exception:
                    pass
                entry_start = None

    if not entries:
        return None

    try:
        identita_match = re.search(r'"identita"\s*:\s*(\{[^}]+\})', text)
        identita = json.loads(identita_match.group(1)) if identita_match else {}
    except Exception:
        identita = {}

    total_score = sum(
        e.get("body", 0) for e in entries
        if isinstance(e.get("body"), (int, float))
    )
    return {
        "identita": identita,
        "vysledky": entries,
        "celkove_skore": total_score,
        "zpetna_vazba": f"[Odpověď modelu byla zkrácena tokenovým limitem — obnoveno {len(entries)} kritérií]",
    }


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
                print(f"{prefix}Context overflow ({input_tokens}+{kwargs['max_tokens']}>{limit})"
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
    elif platform == "ollama":
        extra["extra_body"] = {"num_ctx": context_window}
    # openrouter, openai, lmstudio — žádné proprietární extra_body
    return extra

def _split_criteria_chunks(criteria_markdown: str, chunk_size: int = 8) -> list[str]:
    """Splits criteria markdown (separated by blank lines) into chunks of at most chunk_size."""
    blocks = [b.strip() for b in criteria_markdown.strip().split('\n\n') if b.strip()]
    return ['\n\n'.join(blocks[i:i + chunk_size]) for i in range(0, len(blocks), chunk_size)]


async def _evaluate_chunk(
    client, chunk_criteria: str, report_text: str,
    system_prompt: str, platform: str, enable_thinking: bool,
    context_window: int, max_tokens: int, top_p: float,
    presence_penalty: float, frequency_penalty: float,
    model_name: str, prefix: str, chunk_idx: int
) -> dict:
    """Evaluates one chunk of criteria. Returns partial dict with 'identita' and 'vysledky'."""
    user_prompt = f"""
    ### SEZNAM KRITÉRIÍ K VYHODNOCENÍ (POUZE TATO KRITÉRIA):
    {chunk_criteria}

    ### TEXT ÚŘEDNÍHO ZÁZNAMU (ÚZ) K VYHODNOCENÍ:
    {report_text}

    Požadovaná struktura JSON odpovědi — vyhodnoť POUZE výše uvedená kritéria:
    {{
        "identita": {{
            "hodnost": "prap.",
            "jmeno": "Jan",
            "prijmeni": "Novák"
        }},
        "vysledky": [
            {{
                "nazev": "název kritéria",
                "splneno": true/false,
                "body": počet_bodů,
                "oduvodneni": "zdůvodnění",
                "citace": "přesná věta z textu nebo Chybí"
            }}
        ]
    }}

    IMPORTANT: Výsledkem tvé odpovědi MUSÍ být validní JSON! Žádný jiný text okolo.
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
        "max_tokens": max_tokens,
    }
    kwargs.update(_build_llm_kwargs(platform, enable_thinking, context_window, use_json_mode))

    chunk_prefix = f"{prefix}[chunk {chunk_idx}] "
    response = await _llm_call_with_overflow_retry(client, kwargs, chunk_prefix)

    msg_content = response.choices[0].message.content or ""
    raw = msg_content.strip()
    reasoning = getattr(response.choices[0].message, 'reasoning', None)
    print(f"{chunk_prefix}content_len={len(raw)}, reasoning_len={len(reasoning) if reasoning else 0}")

    clean_text = re.sub(r"<(think|thought)>.*?(</\1>|$)", "", raw, flags=re.DOTALL | re.IGNORECASE).strip()
    start_idx = clean_text.find('{')
    end_idx = clean_text.rfind('}')

    if start_idx == -1 or end_idx == -1 or start_idx > end_idx:
        print(f"{chunk_prefix}CRITICAL: JSON nenalezen")
        return {"identita": {}, "vysledky": []}

    clean_response = clean_text[start_idx:end_idx + 1]
    try:
        parsed = json.loads(clean_response)
    except json.JSONDecodeError as e:
        print(f"{chunk_prefix}JSON parse error: {e} — pokus o opravu")
        parsed = _repair_truncated_json(clean_text) or {"identita": {}, "vysledky": []}

    print(f"{chunk_prefix}{len(parsed.get('vysledky', []))} kritérií OK")
    return parsed


def _merge_chunk_results(chunk_results: list[dict]) -> dict:
    """Merges partial chunk results into one evaluation dict."""
    all_vysledky = []
    identita = {}
    for result in chunk_results:
        if not identita and result.get("identita"):
            identita = result["identita"]
        all_vysledky.extend(result.get("vysledky", []))
    total_score = sum(
        e.get("body", 0) for e in all_vysledky
        if isinstance(e.get("body"), (int, float))
    )
    return {
        "identita": identita,
        "vysledky": all_vysledky,
        "celkove_skore": total_score,
        "zpetna_vazba": "",
    }


async def evaluate_report(report_text: str, criteria_markdown: str, system_prompt: str, db: Session, scenario_id: str = None, student_log_prefix: str = "", lecturer_id: int = None) -> dict:
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
    context_window = int(db_context.value) if db_context and db_context.value else 8192
    max_tokens = int(db_max_tokens.value) if db_max_tokens and db_max_tokens.value else 4096

    if not api_url or not model_name:
        raise ValueError("LLM konfigurace (URL nebo Model) chybí v databázi. Nastavte je v Administraci.")

    # Normalizace OpenRouter URL
    if "openrouter.ai" in api_url and not api_url.endswith("/api/v1"):
        api_url = "https://openrouter.ai/api/v1"

    # Skutečná platforma (URL má přednost před nastavením)
    platform = _resolve_platform(raw_platform, api_url)

    prefix = f"[LOG - {student_log_prefix}] " if student_log_prefix else ""
    print(f"{prefix}LLM volání: platform={platform}, url={api_url}, model={model_name}")

    client = AsyncOpenAI(
        base_url=api_url,
        api_key=api_key or "sk-no-key-required",
        default_headers={"Authorization": f"Bearer {api_key}"} if api_key else None,
        http_client=httpx.AsyncClient(timeout=300.0)
    )
    
    strict_system_prompt = system_prompt

    # CHUNKING: Pokud je kritérií více než CHUNK_SIZE, rozdělíme je a zpracujeme paralelně.
    # Každý chunk → samostatný vLLM request → vLLM continuous batching → maximální využití GPU.
    CHUNK_SIZE = 8
    chunks = _split_criteria_chunks(criteria_markdown, CHUNK_SIZE)
    if len(chunks) > 1:
        print(f"{prefix}Chunking: {len(chunks)} chunks á max {CHUNK_SIZE} kritérií — asyncio.gather")
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
        print(f"{prefix}Merge hotov: {len(merged['vysledky'])} kritérií, skóre={merged['celkove_skore']}")
        return merged

    # 2. PŘÍPRAVA PROMPTU: Tady dáváme modelu přesné instrukce, jak má JSON vypadat.
    # Používáme F-stringy pro vložení textu ÚZ a kritérií přímo do pokynů.
    user_prompt = f"""
    ### SEZNAM KRITÉRIÍ K VYHODNOCENÍ (TOTO JSOU JEDINÉ POLOŽKY, KTERÉ CHCI V JSONU):
    {criteria_markdown}
    
    ### TEXT ÚŘEDNÍHO ZÁZNAMU (ÚZ) K VYHODNOCENÍ:
    {report_text}
    
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
                "nazev": "název kritéria",
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

    # print(f"{prefix}FINAL PROMPT TO LLM:\n{user_prompt}\n<<< END OF PROMPT")

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
        response = await _llm_call_with_overflow_retry(client, kwargs, prefix)

        # 3. PARSOVÁNÍ VÝSLEDKU: AI modely občas píší víc, než chceme. Tady odpověď čistíme.
        msg_content = response.choices[0].message.content or ""
        raw_response = msg_content.strip()

        # Logování délky surové odpovědi pro diagnostiku
        reasoning = getattr(response.choices[0].message, 'reasoning', None)
        print(f"{prefix}LLM odpověď: content_len={len(raw_response)}, reasoning_len={len(reasoning) if reasoning else 0}")
        if not raw_response:
            print(f"{prefix}VAROVÁNÍ: content je prázdný! model={model_name}, reasoning={'ANO' if reasoning else 'NE'}")

        # ODSTRANĚNÍ THOUGHT BLOKŮ: Některé modely (jako Qwen nebo DeepSeek) píší své "myšlenky" mezi <think> a </think>.
        clean_text = re.sub(r"<(think|thought)>.*?(</\1>|$)", "", raw_response, flags=re.DOTALL|re.IGNORECASE).strip()

        # Najdeme první '{' a poslední '}', abychom odsekli případný balast okolo.
        start_idx = clean_text.find('{')
        end_idx = clean_text.rfind('}')

        if start_idx == -1 or end_idx == -1 or start_idx > end_idx:
            print(f"{prefix}CRITICAL ERROR: Odpověď LLM neobsahuje JSON (chybí {{ nebo }}). RAW RESPONSE (first 500):\n{raw_response[:500]}\n--- END RAW ---")
            raise ValueError("V odpovědi LLM nebyl nalezen žádný JSON objekt.")

        clean_response = clean_text[start_idx:end_idx+1]
        try:
            parsed = json.loads(clean_response)
        except json.JSONDecodeError as e:
            print(f"{prefix}Failed to parse LLM response as JSON: {e} — pokus o opravu zkráceného JSON")
            parsed = _repair_truncated_json(clean_text)
            if parsed:
                print(f"{prefix}JSON obnoven: {len(parsed.get('vysledky', []))} kritérií zachráněno")
            else:
                print(f"{prefix}Oprava selhala. Raw Response:\n{raw_response}")
                raise ValueError("Model nevrátil validní JSON. Zkontrolujte logy.")

        print(f"{prefix}JSON úspěšně zparsován: klíče={list(parsed.keys())[:6]}")
        return parsed

    except Exception as e:
        print(f"{prefix}Error communicating with vLLM at {api_url}: {e}")
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
    
    print(f"[FAST-SCAN] platform={platform}, model={model_name}")

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
            print(f"[FAST-SCAN] Model vrátil prázdnou odpověď (content=None). Model: {model_name}")
            return {}
        
        raw_response = msg_content.strip()
        clean_text = re.sub(r"<(think|thought)>.*?</\1>", "", raw_response, flags=re.DOTALL|re.IGNORECASE).strip()
        
        start_idx = clean_text.find('{')
        end_idx = clean_text.rfind('}')
        if start_idx == -1 or end_idx == -1 or start_idx > end_idx:
            print(f"[FAST-SCAN] Missing JSON object. RAW: {raw_response}")
            return {}
            
        clean_response = clean_text[start_idx:end_idx+1]
        data = json.loads(clean_response)
        identity = data.get("identita", {})
        if identity:
            print(f"[FAST-SCAN] Identita nalezena: {identity}")
        return identity
    except Exception as e:
        print(f"Fast-scan identity exception: {e}")
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
    
    print(f">>> LLM volání směřuje na: {api_url} s modelem: {model_name}")

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

        response = await client.chat.completions.create(**kwargs)
        return response.choices[0].message.content.strip()
    except Exception as e:
        print(f"Error in chat_completion with vLLM at {api_url}: {e}")
        raise ValueError(f"Nepodařilo se spojit s LLM: {str(e)}")
