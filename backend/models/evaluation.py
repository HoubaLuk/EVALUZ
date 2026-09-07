from pydantic import BaseModel, ConfigDict
from typing import List, Optional, Any

class CriterionResult(BaseModel):
    """Jedno dílčí hodnocení, jak ho dostane frontend.

    `extra='allow'` je ZÁSADNÍ (ADR-030): bez něj Pydantic v2 tiše zahodí každé pole,
    které tu není deklarované. Metadata se přitom podle zavedeného postupu ukládají
    přímo do `json_result` bez migrace (JSONB je schemaless), takže `jistota`,
    `upraveno_lektorem`, `_llm_omitted` i `_llm_actual_name` se do prohlížeče vůbec
    nedostaly — v DB byly, v odpovědi API zmizely a v UI nebylo co zobrazit.

    Pole s podtržítkem nelze v Pydantic v2 deklarovat (jsou vyhrazená pro privátní
    atributy), takže právě ta projdou jedině přes `extra='allow'`.
    """
    model_config = ConfigDict(extra='allow')

    nazev: str
    splneno: Optional[bool] = False
    body: Any = 0
    oduvodneni: Optional[str] = ""
    citace: Optional[str] = ""
    # Míra jistoty modelu 1–5 (ADR-029). None = neuvedeno; starší záznamy pole nemají.
    jistota: Optional[int] = None
    # Zásah vyučujícího (ADR-025). Odvozuje server, ne klient.
    upraveno_lektorem: Optional[bool] = None

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
    json_result: Optional[Any] = None  # DB vrací JSONB jako dict — Optional[Any] akceptuje dict i str i None
    is_approved: bool = False

class BatchEvaluationResponse(BaseModel):
    results: List[EvaluationResponse]
