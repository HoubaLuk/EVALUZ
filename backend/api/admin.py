from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
import openai
import httpx

from core.database import get_db
from models.db_models import SystemPrompt, AppSettings, Lecturer
from api.auth import get_current_lecturer

router = APIRouter(
    prefix="/admin",
    tags=["admin"]
)

# --- Pydantic Schemas for Admin ---

class PromptUpdateInfo(BaseModel):
    phase_name: str
    content: str
    temperature: float

class AppSettingUpdateInfo(BaseModel):
    key: str
    value: str

class TestConfigRequest(BaseModel):
    base_url: str
    model_id: str
    api_key: Optional[str] = "sk-no-key-required"

# --- Endpoints ---

@router.get("/prompts", response_model=List[PromptUpdateInfo])
def get_all_prompts(db: Session = Depends(get_db), current_user: Lecturer = Depends(get_current_lecturer)):
    """Fetch all system prompts."""
    prompts = db.query(SystemPrompt).all()
    return [{"phase_name": p.phase_name, "content": p.content, "temperature": p.temperature} for p in prompts]


@router.put("/prompts")
def update_prompts(updates: List[PromptUpdateInfo], db: Session = Depends(get_db), current_user: Lecturer = Depends(get_current_lecturer)):
    """Update multiple system prompts."""
    for update in updates:
        prompt = db.query(SystemPrompt).filter(SystemPrompt.phase_name == update.phase_name).first()
        if prompt:
            prompt.content = update.content
            prompt.temperature = update.temperature
        else:
            new_prompt = SystemPrompt(phase_name=update.phase_name, content=update.content, temperature=update.temperature)
            db.add(new_prompt)
    db.commit()
    return {"message": "Prompts updated successfully"}


@router.get("/settings", response_model=List[AppSettingUpdateInfo])
def get_all_settings(db: Session = Depends(get_db), current_user: Lecturer = Depends(get_current_lecturer)):
    """Fetch all App settings (e.g., vLLM configuration)."""
    settings_list = db.query(AppSettings).all()
    return [{"key": s.key, "value": s.value} for s in settings_list]


@router.put("/settings")
def update_settings(updates: List[AppSettingUpdateInfo], db: Session = Depends(get_db), current_user: Lecturer = Depends(get_current_lecturer)):
    """Update multiple app settings."""
    for update in updates:
        setting = db.query(AppSettings).filter(AppSettings.key == update.key).first()
        if setting:
            setting.value = update.value
        else:
            new_setting = AppSettings(key=update.key, value=update.value)
            db.add(new_setting)
    db.commit()
    return {"message": "Settings updated successfully"}


@router.post("/test-llm")
async def test_connection(config: TestConfigRequest, current_user: Lecturer = Depends(get_current_lecturer)):
    """
    Tests connection to a vLLM/OpenAI-compatible provider.
    """
    try:
        api_url = config.base_url
        if "openrouter.ai" in api_url and not api_url.endswith("/api/v1"):
            api_url = "https://openrouter.ai/api/v1"

        # We use a short timeout for the test
        client = openai.OpenAI(
            api_key=config.api_key or "sk-no-key-required",
            base_url=api_url,
            default_headers={"Authorization": f"Bearer {config.api_key}"} if config.api_key else None,
            http_client=httpx.Client(timeout=10.0)
        )
        
        # Perform a minimal completion test
        response = client.chat.completions.create(
            model=config.model_id,
            messages=[{"role": "user", "content": "say hi"}],
            max_tokens=1
        )
        
        if response:
            return {
                "status": "success",
                "message": f"Připojení k modelu '{config.model_id}' je v pořádku."
            }
            
    except openai.AuthenticationError:
        raise HTTPException(status_code=401, detail="Neplatný API klíč.")
    except openai.NotFoundError:
        raise HTTPException(status_code=404, detail=f"Model '{config.model_id}' nebyl na tomto URL nalezen.")
    except Exception as e:
        error_msg = str(e)
        if "Connection error" in error_msg or "ConnectError" in error_msg:
            raise HTTPException(status_code=503, detail=f"Nepodařilo se připojit k URL: {config.base_url}")
        raise HTTPException(status_code=500, detail=f"Chyba při testování: {error_msg}")
