import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
import uvicorn
from fastapi.middleware.cors import CORSMiddleware
from api import evaluate, admin, criteria, analytics, export, auth
from core.database import init_db, get_db
from core.seeder import seed_database

# Initialize database
init_db()

# Seed database using a fresh session
db_session = next(get_db())
seed_database(db_session)

from services.evaluation_queue import eval_queue

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    LIFESPAN MANAGER:
    Spouští se při startu aplikace a ukončuje se při vypnutí.
    Zde startujeme asynchronního workera, který na pozadí zpracovává frontu vyhodnocování.
    """
    # Spuštění workera na pozadí (neblokuje zbytek aplikace).
    worker_task = asyncio.create_task(eval_queue.worker())
    yield
    # Úklid po vypnutí serveru.
    worker_task.cancel()

# Inicializace FastAPI s nastaveným životním cyklem.
app = FastAPI(
    title="EVALUZ Backend",
    description="Systém pro AI vyhodnocování modelových situací",
    version="2.0.2",
    lifespan=lifespan
)

# KONFIGURACE CORS:
# Povoluje komunikaci mezi frontendem (běžícím na jiném portu/doméně) a tímto API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # V produkci by mělo být omezeno na konkrétní doménu.
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# REGISTRACE API ROUTERŮ:
# Každý modul má svou vlastní sekci (vlastní soubor v /api).
app.include_router(auth.router, prefix="/api/v1")
app.include_router(lecturer.router, prefix="/api/v1")
app.include_router(evaluate.router, prefix="/api/v1")
app.include_router(criteria.router, prefix="/api/v1")
app.include_router(settings.router, prefix="/api/v1")

@app.get("/")
async def root():
    """Základní kontrola, že server běží."""
    return {"message": "EVALUZ API is running", "version": "2.0.2"}

@app.get("/api/v1/health")
async def health_check():
    """Endpoint pro monitoring zdraví systému."""
    return {"status": "healthy"}

# SPUŠTĚNÍ AUTOMATICKÉHO SEEDOVÁNÍ:
# Při každém startu se ujistíme, že v DB jsou základní prompty a nastavení, pokud tam chybí.
@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)
    seed_database()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
