"""
Dialect-aware JSON column type.

- PostgreSQL: používá nativní JSONB pro efektivní storage a dotazy
- SQLite: používá Text s automatickou JSON serializací/deserializací
"""
import json
from sqlalchemy.types import TypeDecorator, Text
from sqlalchemy.dialects.postgresql import JSONB


class JSONType(TypeDecorator):
    """
    Na PostgreSQL ukládá jako JSONB, na SQLite jako TEXT s json.loads/dumps.

    Výsledek process_result_value je vždy Python dict/list/None — nikdy string.
    """
    impl = Text
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == 'postgresql':
            return dialect.type_descriptor(JSONB())
        return dialect.type_descriptor(Text())

    def process_bind_param(self, value, dialect):
        """Při zápisu do DB."""
        if dialect.name == 'postgresql':
            # JSONB přijímá Python objekty přímo
            return value
        # SQLite: serializace na JSON string
        if value is not None:
            return json.dumps(value, ensure_ascii=False)
        return value

    def process_result_value(self, value, dialect):
        """Při čtení z DB."""
        if dialect.name == 'postgresql':
            # JSONB vrací Python objekt přímo
            return value
        # SQLite: deserializace z JSON stringu
        if value is not None and value != '' and value != 'None':
            try:
                return json.loads(value)
            except (json.JSONDecodeError, TypeError):
                return None
        return None
