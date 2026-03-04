from pydantic import BaseModel
from typing import List, Optional, Any

class CriterionResult(BaseModel):
    nazev: str
    splneno: Optional[bool] = False
    body: Any = 0
    oduvodneni: Optional[str] = ""
    citace: Optional[str] = ""

class EvaluationResponse(BaseModel):
    class Config:
        extra = 'allow' # Hledaci pole jako uzivatelska jmena, bez havarovan
    id: Optional[int] = None
    jmeno_studenta: str
    cleaned_name: Optional[str] = None
    vysledky: List[CriterionResult] = []
    celkove_skore: Any = 0
    zpetna_vazba: Optional[str] = ""
    identita: Optional[dict] = None
    json_result: Optional[str] = None

class BatchEvaluationResponse(BaseModel):
    results: List[EvaluationResponse]
