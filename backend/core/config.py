import os
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}

    VLLM_API_URL: str = os.getenv("VLLM_API_URL", "http://localhost:8000/v1")
    VLLM_MODEL_NAME: str = os.getenv("VLLM_MODEL_NAME", "qwen2.5-32b-instruct")
    # Produkce: PostgreSQL (nastavit přes env nebo .env soubor)
    # Lokální vývoj: DATABASE_URL=sqlite:///./upvsp_evaluator.db
    DATABASE_URL: str = "postgresql://evaluz_admin:securepassword123@localhost:5432/evaluz_db"

settings = Settings()
