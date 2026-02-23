import json
import httpx
from openai import OpenAI
from sqlalchemy.orm import Session
from core.config import settings
from models.db_models import AppSettings

def evaluate_report(report_text: str, criteria_markdown: str, system_prompt: str, db: Session) -> dict:
    """
    Evaluates a police report against criteria using a local vLLM model dynamically configured from DB.
    """
    
    # 1. Try to fetch dynamic settings from DB, fallback to config file
    db_url = db.query(AppSettings).filter(AppSettings.key == "VLLM_API_URL").first()
    db_model = db.query(AppSettings).filter(AppSettings.key == "VLLM_MODEL_NAME").first()
    db_key = db.query(AppSettings).filter(AppSettings.key == "VLLM_API_KEY").first()
    
    api_url = db_url.value if db_url and db_url.value else settings.VLLM_API_URL
    model_name = db_model.value if db_model and db_model.value else settings.VLLM_MODEL_NAME
    api_key = db_key.value if db_key and db_key.value else "sk-no-key-required"

    print(f"DEBUG: Odesílám dotaz na LLM (eval) s modelem [{model_name}] na URL [{api_url}]")

    # Initialize OpenAI client dynamically per request to ensure latest URL is used
    client = OpenAI(
        base_url=api_url,
        api_key=api_key,
        default_headers={"Authorization": f"Bearer {api_key}"},
        http_client=httpx.Client(timeout=60.0)
    )
    
    # Append the strict JSON instruction to the system prompt
    strict_system_prompt = (
        f"{system_prompt}\n\n"
        "ODPOVÍDEJ STRIKTNĚ VE FORMÁTU JSON, KTERÝ ODPOVÍDÁ SCHÉMATU (viz níže). "
        "NEPIŠ ŽÁDNÝ JINÝ TEXT OKOLO, ŽÁDNÉ VYSVĚTLIVKY ANI MARKDOWN BLOKY (např. ```json)."
    )
    
    # User prompt containing the report and the criteria
    user_prompt = f"""
    Zde jsou hodnotící kritéria:
    {criteria_markdown}
    
    Zde je text úředního záznamu (ÚZ) k vyhodnocení:
    {report_text}
    
    Požadovaná struktura JSON odpovědi (musí striktně odpovídat schématu Pydantic EvaluationResponse bez klíče jmeno_studenta, ten dodá backend):
    {{
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
    """

    try:
        response = client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": strict_system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=0.1, # Low temperature for analytical consistency
            # If the vLLM supports JSON mode formatting, we can try to force it, otherwise prompt engineering handles it
            response_format={"type": "json_object"} 
        )
        
        # Extract the raw text response
        raw_response = response.choices[0].message.content.strip()
        
        # Attempt to parse json
        # Since LLMs sometimes output markdown backticks anyway, clean it up
        if raw_response.startswith("```json"):
            raw_response = raw_response[7:]
        if raw_response.endswith("```"):
            raw_response = raw_response[:-3]
            
        return json.loads(raw_response.strip())
        
    except json.JSONDecodeError as e:
        print(f"Failed to parse LLM response as JSON: {e}\nRaw Response: {raw_response}")
        raise ValueError("Model nevrátil validní JSON. Zkontrolujte logy.")
    except Exception as e:
        print(f"Error communicating with vLLM at {api_url}: {e}")
        raise


def chat_completion(messages: list, system_prompt: str, temperature: float, db: Session) -> str:
    """
    Sends a chat history to the local vLLM model.
    """
    db_url = db.query(AppSettings).filter(AppSettings.key == "VLLM_API_URL").first()
    db_model = db.query(AppSettings).filter(AppSettings.key == "VLLM_MODEL_NAME").first()
    db_key = db.query(AppSettings).filter(AppSettings.key == "VLLM_API_KEY").first()
    
    api_url = db_url.value if db_url and db_url.value else settings.VLLM_API_URL
    model_name = db_model.value if db_model and db_model.value else settings.VLLM_MODEL_NAME
    api_key = db_key.value if db_key and db_key.value else "sk-no-key-required"

    print(f"DEBUG: Odesílám dotaz na LLM (chat) s modelem [{model_name}] na URL [{api_url}]")

    client = OpenAI(
        base_url=api_url,
        api_key=api_key,
        default_headers={"Authorization": f"Bearer {api_key}"},
        http_client=httpx.Client(timeout=60.0)
    )

    formatted_messages = [{"role": "system", "content": system_prompt}]
    
    # Expecting messages to be dictionaries with 'role' and 'content'
    for msg in messages:
        formatted_messages.append({"role": msg.get("role"), "content": msg.get("content")})

    try:
        response = client.chat.completions.create(
            model=model_name,
            messages=formatted_messages,
            temperature=temperature
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        print(f"Error in chat_completion with vLLM at {api_url}: {e}")
        raise ValueError(f"Nepodařilo se spojit s LLM: {str(e)}")
