import os
from typing import List
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}

    VLLM_API_URL: str = os.getenv("VLLM_API_URL", "http://localhost:8000/v1")
    VLLM_MODEL_NAME: str = os.getenv("VLLM_MODEL_NAME", "qwen2.5-32b-instruct")

    # Produkce: PostgreSQL (nastavit přes env nebo .env soubor)
    # Lokální vývoj: DATABASE_URL=sqlite:///./upvsp_evaluator.db
    DATABASE_URL: str = "postgresql://evaluz_admin:securepassword123@localhost:5432/evaluz_db"

    # CORS: povolené origins oddělené čárkou (produkce: konkrétní doména)
    # Např.: CORS_ORIGINS=https://evaluz.vas-domen.cz,https://www.evaluz.vas-domen.cz
    # Lokální vývoj: CORS_ORIGINS=http://localhost:5173,http://localhost:3000
    CORS_ORIGINS: str = "*"

    @property
    def cors_origins_list(self) -> List[str]:
        """Vrátí seznam povolených origins pro CORS middleware."""
        if self.CORS_ORIGINS.strip() == "*":
            return ["*"]
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

settings = Settings()
