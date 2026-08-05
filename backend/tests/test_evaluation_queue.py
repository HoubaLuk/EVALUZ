"""Regresní testy pro `services.evaluation_queue.EvaluationQueue`.

Pokrytí (viz ADR-011 a ADR-015 v docs/TECHNICAL_DOCUMENTATION.md):
- Dedup fronty podle `{lecturer_id}:{scenario_id}:{filename}` (ADR-011).
- `broadcast()` — fallback na přímé lokální doručení, pokud LISTEN spojení neběží
  (SQLite dev / testy), a publikace přes `pg_notify`, pokud běží (ADR-015).
- `_on_notify` doručí zprávu jen socketům registrovaným pro daného lektora v tomto
  procesu — ostatní lektoři nejsou zasaženi.
- Souběžný `disconnect()` během doručování nezpůsobí výjimku ani neshodí iteraci
  (mutation-during-iteration hazard, opraveno kopií listu v `_deliver_local`).

Žádný z testů nepotřebuje reálné PostgreSQL spojení — `_pg_conn` je buď `None`
(fallback větev) nebo fake objekt simulující `asyncpg.Connection.execute`.
"""
import json
import pytest

from services.evaluation_queue import EvaluationQueue


class FakeWebSocket:
    """Minimální náhrada za `fastapi.WebSocket` pro testy — zaznamenává přijaté zprávy."""

    def __init__(self, fail_on_send: bool = False):
        self.accepted = False
        self.sent: list[dict] = []
        self._fail_on_send = fail_on_send

    async def accept(self):
        self.accepted = True

    async def send_json(self, message: dict):
        if self._fail_on_send:
            raise RuntimeError("simulated send failure")
        self.sent.append(message)


class FakePgConn:
    """Náhrada za asyncpg.Connection — zaznamenává NOTIFY volání, nic neposílá do DB."""

    def __init__(self):
        self.notified: list[tuple] = []
        self._closed = False

    def is_closed(self):
        return self._closed

    async def execute(self, query: str, *args):
        self.notified.append((query, args))
        return "SELECT 1"


# ---------------------------------------------------------------------------
# Dedup fronty (ADR-011)
# ---------------------------------------------------------------------------

class TestDedup:
    async def test_add_task_dedup_by_key(self):
        q = EvaluationQueue()
        task = {"lecturer_id": 1, "scenario_id": "scen-1", "file_data": {"filename": "a.pdf"}}
        assert await q.add_task(task) is True
        # Stejný klíč (lecturer/scénář/soubor) znovu ve frontě — musí být odmítnut.
        assert await q.add_task(dict(task)) is False
        assert q.queue.qsize() == 1

    async def test_add_task_different_filename_not_deduped(self):
        q = EvaluationQueue()
        task_a = {"lecturer_id": 1, "scenario_id": "scen-1", "file_data": {"filename": "a.pdf"}}
        task_b = {"lecturer_id": 1, "scenario_id": "scen-1", "file_data": {"filename": "b.pdf"}}
        assert await q.add_task(task_a) is True
        assert await q.add_task(task_b) is True
        assert q.queue.qsize() == 2

    async def test_clear_queue_releases_active_keys(self):
        q = EvaluationQueue()
        task = {"lecturer_id": 1, "scenario_id": "scen-1", "file_data": {"filename": "a.pdf"}}
        await q.add_task(task)
        key = q._task_key(task)
        assert key in q._active_keys

        await q.clear_queue()

        assert key not in q._active_keys
        assert q.queue.empty()
        # Po vyčištění fronty musí být klíč znovu přijatelný.
        assert await q.add_task(dict(task)) is True


# ---------------------------------------------------------------------------
# broadcast() — fallback (bez LISTEN/NOTIFY) i NOTIFY větev (ADR-015)
# ---------------------------------------------------------------------------

class TestBroadcast:
    async def test_broadcast_without_pg_conn_delivers_locally(self):
        """Bez LISTEN spojení (SQLite dev / testy) broadcast() doručí přímo lokálně registrovaným socketům."""
        q = EvaluationQueue()
        ws = FakeWebSocket()
        await q.connect(ws, lecturer_id=1)

        await q.broadcast({"type": "EVAL_SUCCESS", "student_name": "Novák"}, lecturer_id=1)

        assert ws.sent == [{"type": "EVAL_SUCCESS", "student_name": "Novák"}]

    async def test_broadcast_to_unregistered_lecturer_is_noop(self):
        """Broadcast lektorovi bez připojeného socketu tiše nic nedělá — nesmí spadnout."""
        q = EvaluationQueue()
        # Žádné connect() zavolané — active_connections je prázdný.
        await q.broadcast({"type": "EVAL_SUCCESS", "student_name": "Novák"}, lecturer_id=99)
        # Žádná výjimka = úspěch.

    async def test_broadcast_publishes_pg_notify_when_listening(self):
        """S aktivním (fake) LISTEN spojením broadcast() publikuje přes pg_notify, ne přímo lokálně."""
        q = EvaluationQueue()
        fake_conn = FakePgConn()
        q._pg_conn = fake_conn
        ws = FakeWebSocket()
        await q.connect(ws, lecturer_id=1)

        await q.broadcast({"type": "EVAL_SUCCESS", "student_name": "Novák"}, lecturer_id=1)

        assert len(fake_conn.notified) == 1
        query, args = fake_conn.notified[0]
        assert "pg_notify" in query
        channel, payload = args
        assert channel == "evaluz_eval_events"
        payload_data = json.loads(payload)
        assert payload_data == {"lecturer_id": 1, "type": "EVAL_SUCCESS", "student_name": "Novák"}
        # Doručení proběhne teprve přes _on_notify (simulováno v samostatných testech níže) —
        # samotný broadcast() při aktivním LISTEN spojení socketu NIC přímo neposílá.
        assert ws.sent == []


# ---------------------------------------------------------------------------
# _on_notify — doručení jen lokálně registrovaným socketům daného lektora
# ---------------------------------------------------------------------------

class TestOnNotify:
    async def test_on_notify_delivers_to_local_connections_only(self):
        q = EvaluationQueue()
        ws_lecturer_1 = FakeWebSocket()
        ws_lecturer_2 = FakeWebSocket()
        await q.connect(ws_lecturer_1, lecturer_id=1)
        await q.connect(ws_lecturer_2, lecturer_id=2)

        payload = json.dumps({"lecturer_id": 1, "type": "EVAL_SUCCESS", "student_name": "Novák"})
        q._on_notify(connection=None, pid=123, channel="evaluz_eval_events", payload=payload)

        # _on_notify plánuje asyncio.create_task — počkat na dokončení naplánovaného tasku.
        await _drain_pending_tasks()

        assert ws_lecturer_1.sent == [{"type": "EVAL_SUCCESS", "student_name": "Novák"}]
        assert ws_lecturer_2.sent == []

    async def test_on_notify_invalid_payload_does_not_raise(self):
        q = EvaluationQueue()
        # Poškozený JSON nesmí shodit celý proces (a tedy ani ostatní posluchače).
        q._on_notify(connection=None, pid=123, channel="evaluz_eval_events", payload="not-json")
        q._on_notify(connection=None, pid=123, channel="evaluz_eval_events", payload=json.dumps({"no_lecturer_id": True}))
        await _drain_pending_tasks()


# ---------------------------------------------------------------------------
# Souběžný disconnect() během doručování (mutation-during-iteration hazard)
# ---------------------------------------------------------------------------

class TestConcurrentDisconnect:
    async def test_disconnect_during_delivery_does_not_raise(self):
        """`_deliver_local` iteruje kopii listu — odpojení druhého socketu uprostřed
        doručování prvnímu nesmí přeskočit doručení ani vyhodit výjimku."""
        q = EvaluationQueue()
        ws_a = FakeWebSocket()
        ws_b = FakeWebSocket()
        await q.connect(ws_a, lecturer_id=1)
        await q.connect(ws_b, lecturer_id=1)

        # Simulace: ws_a se odpojí "uprostřed" iterace (těsně před odesláním ws_b).
        original_send = ws_a.send_json

        async def send_and_disconnect(message):
            await original_send(message)
            q.disconnect(ws_a, lecturer_id=1)

        ws_a.send_json = send_and_disconnect

        await q._deliver_local({"type": "EVAL_SUCCESS"}, lecturer_id=1)

        assert ws_a.sent == [{"type": "EVAL_SUCCESS"}]
        assert ws_b.sent == [{"type": "EVAL_SUCCESS"}]
        assert 1 not in q.active_connections or ws_a not in q.active_connections[1]

    async def test_send_failure_on_one_connection_does_not_block_others(self):
        q = EvaluationQueue()
        ws_broken = FakeWebSocket(fail_on_send=True)
        ws_ok = FakeWebSocket()
        await q.connect(ws_broken, lecturer_id=1)
        await q.connect(ws_ok, lecturer_id=1)

        await q._deliver_local({"type": "EVAL_SUCCESS"}, lecturer_id=1)

        assert ws_ok.sent == [{"type": "EVAL_SUCCESS"}]


async def _drain_pending_tasks():
    """Pomocná funkce: nechá event loop doběhnout tasky naplánované přes asyncio.create_task
    (`_on_notify` je synchronní callback, doručení plánuje jako fire-and-forget task)."""
    import asyncio
    # Dvojí yield event loopu stačí na dokončení jednoúrovňového create_task+await řetězce.
    await asyncio.sleep(0)
    await asyncio.sleep(0)
