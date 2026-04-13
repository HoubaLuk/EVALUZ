import os
from typing import List
from pydantic_settings import BaseSettings
from pydantic import field_validator


class Settings(BaseSettings):
    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}

    # pydantic-settings automaticky čte z .env nebo Docker environment variables.
    # LLM backend URL — nastavte v Administraci nebo přes .env
    # Příklady:
    #   OpenRouter:  https://openrouter.ai/api/v1
    #   lokální vLLM: http://localhost:8001/v1  (NIKOLI port 8000 = FastAPI!)
    VLLM_API_URL: str = ""
    VLLM_MODEL_NAME: str = ""

    # SQLite pro lokální vývoj; přepsat v .env nebo Docker:
    #   DATABASE_URL=postgresql://evaluz_admin:HESLO@db:5432/evaluz_db
    DATABASE_URL: str = "sqlite:///./upvsp_evaluator.db"

    CORS_ORIGINS: str = "*"

    # JWT — POVINNÉ v produkci: openssl rand -hex 32
    JWT_SECRET_KEY: str = "CHANGE_ME_IN_PRODUCTION_USE_OPENSSL_RAND_HEX_32"

    # Prostředí: "dev" | "production"
    APP_ENV: str = "dev"

    # Logování: "DEBUG" | "INFO" | "WARNING" | "ERROR"
    LOG_LEVEL: str = "INFO"

    @field_validator("JWT_SECRET_KEY")
    @classmethod
    def validate_jwt_secret(cls, v: str) -> str:
        insecure_defaults = {
            "CHANGE_ME_IN_PRODUCTION_USE_OPENSSL_RAND_HEX_32",
            "b3a1a6b4d3d4b68ef5a4c9b9a67a0a03dcdfc7eab79883",
            "",
        }
        app_env = os.getenv("APP_ENV", "dev")
        if app_env == "production" and v in insecure_defaults:
            raise ValueError(
                "JWT_SECRET_KEY není nastaveno! V produkci spusť: openssl rand -hex 32"
            )
        if len(v) < 32:
            raise ValueError("JWT_SECRET_KEY musí mít alespoň 32 znaků.")
        return v

    @field_validator("CORS_ORIGINS")
    @classmethod
    def validate_cors(cls, v: str) -> str:
        app_env = os.getenv("APP_ENV", "dev")
        if app_env == "production" and v.strip() == "*":
            raise ValueError(
                "CORS_ORIGINS=* je zakázáno v produkci. Nastavte konkrétní doménu(y)."
            )
        return v

    @property
    def cors_origins_list(self) -> List[str]:
        if self.CORS_ORIGINS.strip() == "*":
            return ["*"]
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def is_sqlite(self) -> bool:
        return self.DATABASE_URL.startswith("sqlite")

    @property
    def is_production(self) -> bool:
        return self.APP_ENV == "production"


settings = Settings()
