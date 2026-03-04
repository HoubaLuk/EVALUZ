import os
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}

    VLLM_API_URL: str = os.getenv("VLLM_API_URL", "http://localhost:8000/v1")
    VLLM_MODEL_NAME: str = os.getenv("VLLM_MODEL_NAME", "qwen2.5-32b-instruct")
    DATABASE_URL: str = "sqlite:///./upvsp_evaluator.db"

settings = Settings()
