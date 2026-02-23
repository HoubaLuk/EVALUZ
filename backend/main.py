from fastapi import FastAPI
import uvicorn
from fastapi.middleware.cors import CORSMiddleware
from api import evaluate, admin, criteria, analytics, export
from core.database import init_db, get_db
from core.seeder import seed_database

# Initialize database
init_db()

# Seed database using a fresh session
db_session = next(get_db())
seed_database(db_session)

app = FastAPI(
    title="ÚPVSP AI Evaluátor API",
    description="Backend pro vyhodnocování úředních záznamů ÚPVSP pomocí lokálního vLLM",
    version="1.0.0"
)

# CORS configuration
origins = [
    "http://localhost:5173",
    "http://localhost:3000", # Including 3000 just in case the frontend runs there
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Routers
app.include_router(evaluate.router, prefix="/api/v1")
app.include_router(admin.router, prefix="/api/v1")
app.include_router(criteria.router, prefix="/api/v1")
app.include_router(analytics.router, prefix="/api/v1")
app.include_router(export.router, prefix="/api/v1")

@app.get("/api/v1/health")
def health_check():
    """
    Simple health check endpoint.
    """
    return {
        "status": "ok",
        "message": "ÚPVSP Backend is running"
    }

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
