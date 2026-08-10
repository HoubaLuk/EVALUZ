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
import asyncio
import json
import pytest

from services.evaluation_queue import CONTROL_KEY, NOTIFY_CHANNEL, EvaluationQueue


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


class ConcurrencyTrackingPgConn(FakePgConn):
    """asyncpg spojení, které souběžné použití DETEKUJE místo aby ho tiše povolilo.

    Reálné asyncpg spojení v takové situaci vyhodí
    `cannot perform operation: another operation is in progress` (ADR-017) — tahle
    náhrada se chová stejně, aby regresní test selhal, kdyby zámek v `broadcast()` zmizel.
    """

    def __init__(self):
        super().__init__()
        self._in_flight = False
        self.overlaps = 0

    async def execute(self, query: str, *args):
        if self._in_flight:
            self.overlaps += 1
            raise RuntimeError("cannot perform operation: another operation is in progress")
        self._in_flight = True
        try:
            # Vynutí přepnutí korutin uprostřed „operace" — bez zámku se sem dostane další.
            await asyncio.sleep(0)
            self.notified.append((query, args))
        finally:
            self._in_flight = False
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


# ---------------------------------------------------------------------------
# Souběžný broadcast nad JEDNÍM asyncpg spojením (ADR-017) — nahlášený bug
# ---------------------------------------------------------------------------

class TestConcurrentBroadcast:
    async def test_parallel_broadcasts_do_not_overlap_on_shared_connection(self):
        """Tři souběžné broadcasty (dávka 3 ÚZ) nesmí sáhnout na _pg_conn naráz.

        Přesně tohle shodilo dávkové vyhodnocení: první úkol spojení zabral a zbylé
        okamžitě spadly na `another operation is in progress` — z dávky 3 ÚZ se
        vyhodnotil jen první.
        """
        q = EvaluationQueue()
        conn = ConcurrencyTrackingPgConn()
        q._pg_conn = conn

        await asyncio.gather(*[
            q.broadcast(
                {"type": "EVAL_START", "student_name": f"student{i}.pdf"},
                lecturer_id=1,
            )
            for i in range(3)
        ])

        assert conn.overlaps == 0
        assert len(conn.notified) == 3

    async def test_failing_handler_still_emits_terminal_event(self):
        """Invariant: každý zařazený úkol vyprodukuje právě jednu terminální událost.

        I když handler spadne dřív, než se dostane ke svému vlastnímu try/except,
        musí do UI dorazit EVAL_ERROR — jinak zůstane kolečko viset napořád.
        """
        q = EvaluationQueue()
        ws = FakeWebSocket()
        await q.connect(ws, lecturer_id=7)

        async def exploding_handler(task_data):
            raise RuntimeError("cannot perform operation: another operation is in progress")

        worker_task = asyncio.create_task(q.worker(concurrency=2))
        try:
            await q.add_task({
                "handler": exploding_handler,
                "lecturer_id": 7,
                "scenario_id": "scen-2",
                "file_data": {"filename": "Novák ÚZ.pdf"},
            })
            await asyncio.wait_for(q.queue.join(), timeout=2)
            await _drain_pending_tasks()
        finally:
            worker_task.cancel()
            try:
                await worker_task
            except asyncio.CancelledError:
                pass

        assert [m["type"] for m in ws.sent] == ["EVAL_ERROR"]
        assert ws.sent[0]["student_name"] == "Novák ÚZ.pdf"
        # Klíč se uvolnil → lektor může ÚZ poslat znovu bez restartu backendu.
        assert q._active_keys == set()


# ---------------------------------------------------------------------------
# clear_queue per lektor + řídicí zpráva napříč procesy (ADR-017)
# ---------------------------------------------------------------------------

class TestClearQueueScoping:
    async def test_clear_queue_keeps_other_lecturers_tasks(self):
        """„Zastavit" u jednoho lektora nesmí shodit frontu druhému."""
        q = EvaluationQueue()
        mine = {"lecturer_id": 1, "scenario_id": "scen-2", "file_data": {"filename": "a.pdf"}}
        theirs = {"lecturer_id": 2, "scenario_id": "scen-2", "file_data": {"filename": "b.pdf"}}
        await q.add_task(mine)
        await q.add_task(theirs)

        await q.clear_queue(lecturer_id=1)

        assert q.queue.qsize() == 1
        assert q.queue.get_nowait()["lecturer_id"] == 2
        assert q._task_key(mine) not in q._active_keys
        assert q._task_key(theirs) in q._active_keys

    async def test_clear_queue_publishes_control_message_when_listening(self):
        """S aktivním LISTEN spojením se úklid rozešle přes NOTIFY do VŠECH procesů.

        Fronta je per-proces (ADR-015), takže lokální úklid by minul úkoly zařazené
        v tom druhém uvicorn procesu.
        """
        q = EvaluationQueue()
        conn = FakePgConn()
        q._pg_conn = conn
        await q.add_task({"lecturer_id": 1, "scenario_id": "scen-2", "file_data": {"filename": "a.pdf"}})

        await q.clear_queue(lecturer_id=1)

        # Lokálně zatím nic — úklid proběhne teprve přes _on_notify (i v tomto procesu).
        assert q.queue.qsize() == 1
        assert len(conn.notified) == 1
        payload = json.loads(conn.notified[0][1][1])
        assert payload[CONTROL_KEY] == "clear_queue"
        assert payload["lecturer_id"] == 1

    async def test_control_message_is_not_delivered_to_sockets(self):
        """Řídicí zpráva se vykoná lokálně, ale do prohlížeče se neposílá."""
        q = EvaluationQueue()
        ws = FakeWebSocket()
        await q.connect(ws, lecturer_id=1)
        await q.add_task({"lecturer_id": 1, "scenario_id": "scen-2", "file_data": {"filename": "a.pdf"}})

        q._on_notify(
            connection=None,
            pid=123,
            channel=NOTIFY_CHANNEL,
            payload=json.dumps({"lecturer_id": 1, CONTROL_KEY: "clear_queue"}),
        )
        await _drain_pending_tasks()

        assert ws.sent == []
        assert q.queue.empty()

    async def test_unknown_control_message_is_ignored(self):
        """Neznámá řídicí zpráva nesmí spadnout ani prosáknout do prohlížeče."""
        q = EvaluationQueue()
        ws = FakeWebSocket()
        await q.connect(ws, lecturer_id=1)

        q._on_notify(
            connection=None,
            pid=123,
            channel=NOTIFY_CHANNEL,
            payload=json.dumps({"lecturer_id": 1, CONTROL_KEY: "neco_neznameho"}),
        )
        await _drain_pending_tasks()

        assert ws.sent == []


async def _drain_pending_tasks():
    """Pomocná funkce: nechá event loop doběhnout tasky naplánované přes asyncio.create_task
    (`_on_notify` je synchronní callback, doručení plánuje jako fire-and-forget task)."""
    import asyncio
    # Dvojí yield event loopu stačí na dokončení jednoúrovňového create_task+await řetězce.
    await asyncio.sleep(0)
    await asyncio.sleep(0)
