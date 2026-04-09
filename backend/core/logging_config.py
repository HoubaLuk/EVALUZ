"""
Centrální konfigurace logování pro EVALUZ backend.
V produkci: JSON formát vhodný pro log agregátory (Loki, Elastic...).
Lokálně: čitelný formát.
"""
import logging
import sys


def setup_logging(level: str = "INFO", production: bool = False) -> None:
    log_level = getattr(logging, level.upper(), logging.INFO)

    if production:
        # JSON-like formát pro log agregátory
        fmt = '{"time":"%(asctime)s","level":"%(levelname)s","module":"%(name)s","msg":"%(message)s"}'
    else:
        # Čitelný formát pro lokální vývoj
        fmt = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"

    logging.basicConfig(
        stream=sys.stdout,
        level=log_level,
        format=fmt,
        datefmt="%Y-%m-%dT%H:%M:%S",
        force=True,
    )

    # Uvicorn access logy — synchronizovat úroveň
    logging.getLogger("uvicorn").setLevel(log_level)
    logging.getLogger("uvicorn.access").setLevel(log_level)
    logging.getLogger("uvicorn.error").setLevel(log_level)

    # SQLAlchemy — pouze WARNING (jinak zahlcuje logy SQL dotazy)
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.pool").setLevel(logging.WARNING)

    logger = logging.getLogger("evaluz")
    logger.info(f"Logging inicializováno: level={level}, production={production}")
