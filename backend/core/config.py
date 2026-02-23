import os
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    VLLM_API_URL: str = os.getenv("VLLM_API_URL", "http://localhost:8000/v1")
    VLLM_MODEL_NAME: str = os.getenv("VLLM_MODEL_NAME", "qwen2.5-32b-instruct")

settings = Settings()
