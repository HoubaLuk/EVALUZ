"""MockLLMRouter — respx-based interceptor pro vLLM /chat/completions volání.

Každá respond_* metoda přidá jednu naplánovanou odpověď do fronty.
Volání jsou obsloužena v pořadí FIFO — první call = první odpověď.
"""
import json
import httpx
import respx


MOCK_VLLM_URL = "http://mock-vllm:8001/v1"
COMPLETIONS_URL = f"{MOCK_VLLM_URL}/chat/completions"


def _make_openai_response(content: str) -> dict:
    return {
        "id": "chatcmpl-test",
        "object": "chat.completion",
        "created": 1700000000,
        "model": "test-model",
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content, "reasoning": None},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150},
    }


class MockLLMRouter:
    """Obálka nad respx routerem s pomocnými metodami pro různé LLM scénáře."""

    def __init__(self):
        self._router = respx.MockRouter(assert_all_called=False)
        self._call_count = 0
        self._responses: list[str] = []

    def __enter__(self):
        self._router.start()
        self._router.post(COMPLETIONS_URL).mock(side_effect=self._dispatch)
        return self

    def __exit__(self, *args):
        self._router.stop()

    async def _dispatch(self, request: httpx.Request) -> httpx.Response:
        idx = self._call_count
        self._call_count += 1
        if idx < len(self._responses):
            body = _make_openai_response(self._responses[idx])
        else:
            # fallback — prázdná identity odpověď
            body = _make_openai_response(json.dumps({"hodnost": "", "jmeno": "", "prijmeni": ""}))
        return httpx.Response(200, json=body)

    # ── Konfigurace odpovědí ────────────────────────────────────────────────

    def respond_clean(self, criteria_names: list[str], bodies: list[int] | None = None) -> "MockLLMRouter":
        """Validní JSON se všemi kritérii."""
        if bodies is None:
            bodies = [1] * len(criteria_names)
        vysledky = [
            {
                "nazev": name,
                "splneno": True,
                "body": body,
                "oduvodneni": "Kritérium bylo splněno.",
                "citace": "Testovací citace z ÚZ.",
            }
            for name, body in zip(criteria_names, bodies)
        ]
        result = {
            "identita": {"hodnost": "prap.", "jmeno": "Jan", "prijmeni": "Novák"},
            "vysledky": vysledky,
            "celkove_skore": sum(bodies),
            "zpetna_vazba": "",
        }
        self._responses.append(json.dumps(result))
        return self

    def respond_truncated(self, criteria_names: list[str]) -> "MockLLMRouter":
        """Deterministicky uříznutý JSON — odstraníme vždy poslední 2 závorky.

        85% substring je nedeterministický pro krátký JSON (může být stále validní).
        Místo toho uřízneme přesně před posledními dvěma '}}' — struktura je vždy
        zlomená bez ohledu na délku, ale část vysledky je zachována pro _repair.
        """
        vysledky_partial = [
            {
                "nazev": name,
                "splneno": True,
                "body": 1,
                "oduvodneni": "OK.",
                "citace": "Citace.",
            }
            for name in criteria_names
        ]
        full = json.dumps({
            "identita": {"hodnost": "por.", "jmeno": "Eva", "prijmeni": "Procházková"},
            "vysledky": vysledky_partial,
            "celkove_skore": len(criteria_names),
            "zpetna_vazba": "",
        })
        # Uřízneme přesně před posledními dvěma zavíracími závorkami `}}`
        # Tím zaručeně vytvoříme nevalidní JSON nezávisle na délce stringu.
        truncated = full[: full.rfind("}}")]
        assert _is_broken_json(truncated), "respond_truncated: výsledek musí být nevalidní JSON"
        self._responses.append(truncated)
        return self

    def respond_with_extra_criteria(
        self, criteria_names: list[str], extra: list[str]
    ) -> "MockLLMRouter":
        """LLM vrátí i halucinovaná kritéria navíc — musí být odfiltrována."""
        vysledky = [
            {"nazev": n, "splneno": True, "body": 1, "oduvodneni": "OK.", "citace": "Citace."}
            for n in criteria_names + extra
        ]
        result = {
            "identita": {"hodnost": "nstržm.", "jmeno": "Petr", "prijmeni": "Beneš"},
            "vysledky": vysledky,
            "celkove_skore": len(criteria_names),
            "zpetna_vazba": "",
        }
        self._responses.append(json.dumps(result))
        return self

    def respond_chunk_pattern(
        self, chunks: list[list[str]], missing_per_chunk: list[list[str]] | None = None
    ) -> "MockLLMRouter":
        """Připraví odpovědi pro každý chunk zvlášť.

        chunks: seznam seznamů názvů kritérií (jeden seznam = jeden chunk).
        missing_per_chunk: která kritéria v každém chunku vynechat (simulace partial).
        """
        if missing_per_chunk is None:
            missing_per_chunk = [[] for _ in chunks]
        for chunk_names, missing in zip(chunks, missing_per_chunk):
            included = [n for n in chunk_names if n not in missing]
            vysledky = [
                {"nazev": n, "splneno": True, "body": 1, "oduvodneni": "OK.", "citace": "Citace."}
                for n in included
            ]
            result = {
                "identita": {"hodnost": "prap.", "jmeno": "Jana", "prijmeni": "Malá"},
                "vysledky": vysledky,
                "celkove_skore": len(included),
                "zpetna_vazba": "",
            }
            self._responses.append(json.dumps(result))
        return self

    def respond_identity(self, hodnost: str = "", jmeno: str = "", prijmeni: str = "") -> "MockLLMRouter":
        """Odpověď pro extract_identity (fast-scan phase1)."""
        result = {"hodnost": hodnost, "jmeno": jmeno, "prijmeni": prijmeni}
        self._responses.append(json.dumps(result))
        return self

    def respond_empty(self) -> "MockLLMRouter":
        """Prázdný content — simuluje LLM failure."""
        self._responses.append("")
        return self

    @property
    def call_count(self) -> int:
        return self._call_count


def _is_broken_json(text: str) -> bool:
    import json as _json
    try:
        _json.loads(text)
        return False
    except _json.JSONDecodeError:
        return True
