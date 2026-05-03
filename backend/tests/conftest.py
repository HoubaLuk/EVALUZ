"""Pytest config — přidá `backend/` do sys.path, aby fungovaly importy `services.*`, `core.*` atd.
bez nutnosti instalovat backend jako balíček."""
import sys
from pathlib import Path

# backend/ root = parent této složky
_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))
