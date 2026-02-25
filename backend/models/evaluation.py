from pydantic import BaseModel
from typing import List, Optional

class CriterionResult(BaseModel):
    nazev: str
    splneno: bool
    body: int
    oduvodneni: str
    citace: str

class EvaluationResponse(BaseModel):
    id: Optional[int] = None
    jmeno_studenta: str
    vysledky: List[CriterionResult]
    celkove_skore: int
    zpetna_vazba: str

class BatchEvaluationResponse(BaseModel):
    results: List[EvaluationResponse]
