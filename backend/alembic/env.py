import os
import sys
from logging.config import fileConfig

from sqlalchemy import pool, create_engine
from alembic import context

# Přidáme backend/ do Python path, aby fungovaly importy
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.config import settings
from models.db_models import Base

# Alembic Config objekt
config = context.config

# Přepsat sqlalchemy.url z naší konfigurace (ignoruje hodnotu v alembic.ini)
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)

# Nastavení logování
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Metadata pro autogenerate
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Offline migrace — generuje SQL skript bez připojení k DB."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,  # nutné pro SQLite kompatibilitu
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Online migrace — připojí se k DB a provede migrace."""
    url = settings.DATABASE_URL
    is_sqlite = url.startswith("sqlite")

    if is_sqlite:
        connectable = create_engine(
            url,
            connect_args={"check_same_thread": False},
            poolclass=pool.StaticPool,
        )
    else:
        connectable = create_engine(url)

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,  # nutné pro SQLite batch operace (ALTER COLUMN)
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
