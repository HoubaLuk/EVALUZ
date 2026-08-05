"""
EVALUZ Backend — hlavní vstupní bod FastAPI aplikace.
"""
import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

# ── Logging musí být inicializován jako první ────────────────────────────────
from core.logging_config import setup_logging
from core.config import settings
setup_logging(level=settings.LOG_LEVEL, production=settings.is_production)

logger = logging.getLogger("evaluz.main")

# ── Importy po inicializaci loggeru ─────────────────────────────────────────
from api import evaluate, admin, criteria, analytics, export, auth
from core.database import get_db, init_db, run_alembic_migrations, SessionLocal
from core.seeder import seed_database
from __version__ import __version__
from services.evaluation_queue import eval_queue

# ── Rate limiting ─────────────────────────────────────────────────────────────
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

limiter = Limiter(key_func=get_remote_address, default_limits=["200/minute"])


# ── Security Headers Middleware ───────────────────────────────────────────────
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        if settings.is_production:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response


# ── Lifespan (DB init, seed, worker) ─────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Spouští se při startu aplikace:
    1. Migrace DB (Alembic pro PostgreSQL, init_db pro SQLite dev)
    2. Seed výchozích dat
    3. Spuštění async workeru pro frontu vyhodnocování
    """
    # 1. Migrace
    # SQLite (dev): init_db() vytvoří tabulky přímo přes SQLAlchemy metadata.
    # PostgreSQL (prod): migrace proběhly jako první krok v Dockerfile CMD
    #   ("alembic upgrade head && exec uvicorn ...") — jedno spuštění, jeden
    #   proces, žádná race condition mezi workery. Zde již není co dělat.
    if settings.is_sqlite:
        logger.info("SQLite dev prostředí — spouštím init_db()")
        init_db()
    else:
        logger.info("PostgreSQL — migrace proběhly před startem uvicorn (Dockerfile CMD)")

    # 2. Seed — vlastní session se správným lifecycle
    db = SessionLocal()
    try:
        seed_database(db)
        db.commit()
    except Exception as e:
        logger.error(f"Seed selhal: {e}", exc_info=True)
        db.rollback()
    finally:
        db.close()

    # 3. Eval worker — načíst concurrency z DB
    concurrency = _resolve_worker_concurrency()
    logger.info(f"Eval worker spuštěn: concurrency={concurrency}")
    worker_task = asyncio.create_task(eval_queue.worker(concurrency=concurrency))

    # 4. LISTEN/NOTIFY (ADR-015) — pouze PostgreSQL. Nutné v KAŽDÉM uvicorn worker
    #    procesu (--workers 2), jinak ten proces nikdy nedostane oznámení o úkolech
    #    dokončených jiným procesem (viz evaluation_queue.py modulový docstring).
    listen_task = None
    if not settings.is_sqlite:
        listen_task = asyncio.create_task(eval_queue.start_listening(settings.DATABASE_URL))

    yield

    # Úklid při vypnutí
    worker_task.cancel()
    try:
        await worker_task
    except asyncio.CancelledError:
        pass

    if listen_task is not None:
        listen_task.cancel()
        try:
            await listen_task
        except asyncio.CancelledError:
            pass
        await eval_queue.close()


def _resolve_worker_concurrency() -> int:
    """Načte concurrency z DB dle aktuální LLM platformy."""
    try:
        from models.db_models import AppSettings
        db = SessionLocal()
        try:
            platform_row = db.query(AppSettings).filter(AppSettings.key == "LLM_PLATFORM").first()
            url_row = db.query(AppSettings).filter(AppSettings.key == "VLLM_API_URL").first()
            platform = platform_row.value if platform_row and platform_row.value else "vllm"
            api_url = url_row.value if url_row and url_row.value else ""
            # URL má přednost (stejná logika jako _resolve_platform v llm_engine.py)
            if "openrouter.ai" in api_url:
                platform = "openrouter"
            elif "openai.com" in api_url:
                platform = "openai"
            key = "LLM_CONCURRENCY_OPENROUTER" if platform == "openrouter" else "LLM_CONCURRENCY_VLLM"
            row = db.query(AppSettings).filter(AppSettings.key == key).first()
            return int(row.value) if row and row.value else (2 if platform == "openrouter" else 8)
        finally:
            db.close()
    except Exception as e:
        logger.warning(f"Nepodařilo se načíst concurrency z DB ({e}), použito výchozí: 4")
        return 4


# ── Inicializace FastAPI ──────────────────────────────────────────────────────
app = FastAPI(
    title="EVALUZ Backend",
    description="Systém pro AI vyhodnocování modelových situací — ÚPVSP ČR",
    version=__version__,
    lifespan=lifespan,
    # V produkci skrýt docs (interní API, ne veřejné)
    docs_url="/api/docs" if not settings.is_production else None,
    redoc_url="/api/redoc" if not settings.is_production else None,
    openapi_url="/api/openapi.json" if not settings.is_production else None,
)

# ── Middleware (pořadí záleží — první přidaný je poslední spuštěný) ───────────
app.add_middleware(SecurityHeadersMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept", "X-Requested-With"],
)

# ── Rate limiting ─────────────────────────────────────────────────────────────
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ── API Routery ───────────────────────────────────────────────────────────────
app.include_router(auth.router, prefix="/api/v1")
app.include_router(evaluate.router, prefix="/api/v1")
app.include_router(criteria.router, prefix="/api/v1")
app.include_router(admin.router, prefix="/api/v1")
app.include_router(analytics.router, prefix="/api/v1")
app.include_router(export.router, prefix="/api/v1")
from api.statistics import router as statistics_router
app.include_router(statistics_router, prefix="/api/v1")


# ── Základní endpointy ────────────────────────────────────────────────────────
@app.get("/")
async def root():
    return {"message": "EVALUZ API is running", "version": __version__}


@app.get("/api/v1/version")
async def get_version():
    return {"version": __version__}


@app.get("/api/v1/health")
async def health_check():
    """Healthcheck endpoint — ověří DB připojení."""
    from sqlalchemy import text as sa_text
    from core.database import engine
    try:
        with engine.connect() as conn:
            conn.execute(sa_text("SELECT 1"))
        db_status = "ok"
    except Exception as e:
        logger.error(f"Health check DB selhalo: {e}")
        db_status = f"error: {str(e)}"
    return {
        "status": "healthy" if db_status == "ok" else "degraded",
        "db": db_status,
        "version": __version__,
        "env": settings.APP_ENV,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True, log_level="info")
