from pydantic import BaseModel
from typing import List

class CriterionResult(BaseModel):
    nazev: str
    splneno: bool
    body: int
    oduvodneni: str
    citace: str

class EvaluationResponse(BaseModel):
    jmeno_studenta: str
    vysledky: List[CriterionResult]
    celkove_skore: int
    zpetna_vazba: str

class BatchEvaluationResponse(BaseModel):
    results: List[EvaluationResponse]
