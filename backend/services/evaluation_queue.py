"""
MODUL: ASYNCHRONNÍ FRONTA (EVALUATION QUEUE)
Tento modul zajišťuje, že se aplikace "nezasekne", když lektor spustí vyhodnocování desítek studentů najednou.
Úkoly se řadí do fronty a zpracovávají se postupně na pozadí, zatímco uživatel může dál pracovat v UI.

WebSocket doručení (ADR-015): backend běží s více uvicorn worker procesy (--workers 2),
každý s VLASTNÍM in-memory `active_connections` registrem. broadcast() proto neposílá
zprávy lokálně registrovaným socketům přímo — vždy publikuje Postgres NOTIFY na sdílený
kanál. Každý proces poslouchá na vlastním asyncpg spojení (start_listening) a doručí
zprávu jen svým lokálně registrovaným socketům — funguje to bez ohledu na to, který
proces úkol zpracoval a který proces drží cílový WebSocket.
"""

import asyncio
import json
import logging
from typing import Dict, List, Any, Set, Optional
from fastapi import WebSocket

import asyncpg

logger = logging.getLogger("evaluz.queue")

NOTIFY_CHANNEL = "evaluz_eval_events"


class EvaluationQueue:
    def __init__(self):
        # Interní asynchronní fronta (FIFO - First In, First Out).
        self.queue = asyncio.Queue()
        # Seznam aktivních prohlížečů, kterým posíláme aktualizace o stavu (EVAL_START, SUCCESS...).
        # MAPOVÁNÍ: {lecturer_id: [WebSocket, ...]}
        # POZOR: toto je per-proces registr — broadcast() ho nepoužívá přímo, viz modulový docstring.
        self.active_connections: Dict[int, List[WebSocket]] = {}
        # Množina klíčů úkolů aktuálně ve frontě nebo právě zpracovávaných.
        # Klíč: "{lecturer_id}:{scenario_id}:{filename}" — zabraňuje duplicitnímu vyhodnocení.
        self._active_keys: Set[str] = set()
        # Dedikované asyncpg spojení pro LISTEN/NOTIFY (ADR-015) — otevírá se v start_listening().
        self._pg_conn: Optional["asyncpg.Connection"] = None

    async def connect(self, websocket: WebSocket, lecturer_id: int):
        """Zaregistruje prohlížeč pro příjem real-time oznámení přes WebSocket."""
        await websocket.accept()
        if lecturer_id not in self.active_connections:
            self.active_connections[lecturer_id] = []
        self.active_connections[lecturer_id].append(websocket)

    def disconnect(self, websocket: WebSocket, lecturer_id: int = None):
        """Odebere prohlížeč ze seznamu po zavření karty nebo odhlášení."""
        if lecturer_id is not None:
            if lecturer_id in self.active_connections and websocket in self.active_connections[lecturer_id]:
                self.active_connections[lecturer_id].remove(websocket)
                if not self.active_connections[lecturer_id]:
                    del self.active_connections[lecturer_id]
        else:
            # Fallback pokus o nalezení a odebrání ze všech (pomalejší, ale bezpečné při odpojení bez ID)
            for lid in list(self.active_connections.keys()):
                if websocket in self.active_connections[lid]:
                    self.active_connections[lid].remove(websocket)
                    if not self.active_connections[lid]:
                        del self.active_connections[lid]

    async def start_listening(self, dsn: str):
        """
        Otevře dedikované asyncpg spojení a naslouchá na NOTIFY_CHANNEL (ADR-015).
        Musí běžet v KAŽDÉM uvicorn worker procesu — jinak ten proces nikdy nedostane
        oznámení o úkolech dokončených jiným procesem.

        Volá se pouze pro PostgreSQL (main.py lifespan přeskočí SQLite dev prostředí —
        LISTEN/NOTIFY tam nedává smysl a broadcast() má bezpečný fallback, viz níže).

        Retry smyčka: při výpadku DB spojení (např. restart kontejneru evaluz_db) se
        znovu pokusí připojit s 5s odstupem, dokud task není zrušen při shutdownu.
        """
        while True:
            try:
                self._pg_conn = await asyncpg.connect(dsn)
                await self._pg_conn.add_listener(NOTIFY_CHANNEL, self._on_notify)
                logger.info(f"[QUEUE] LISTEN/NOTIFY aktivní na kanálu '{NOTIFY_CHANNEL}'")
                while not self._pg_conn.is_closed():
                    await asyncio.sleep(5)
                logger.warning("[QUEUE] LISTEN spojení uzavřeno, pokouším se znovu připojit…")
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.error(f"[QUEUE] LISTEN/NOTIFY spojení selhalo ({e}), zkouším znovu za 5s…")
            await asyncio.sleep(5)

    def _on_notify(self, connection, pid, channel, payload):
        """
        Synchronní callback asyncpg — zavolá se při KAŽDÉM NOTIFY na NOTIFY_CHANNEL,
        včetně těch, které publikoval tento samý proces (Postgres doručuje notifikace
        všem posluchačům kanálu bez ohledu na to, kdo NOTIFY vyslal). Naplánuje
        asynchronní doručení lokálně registrovaným socketům.
        """
        try:
            data = json.loads(payload)
            lecturer_id = data.pop("lecturer_id")
        except (json.JSONDecodeError, KeyError) as e:
            logger.error(f"[QUEUE] Neplatný NOTIFY payload: {e}")
            return
        asyncio.create_task(self._deliver_local(data, lecturer_id))

    async def _deliver_local(self, message: dict, lecturer_id: int):
        """Doručí zprávu jen socketům registrovaným v TOMTO procesu (kopie listu — bezpečné vůči souběžnému disconnect())."""
        connections = list(self.active_connections.get(lecturer_id, []))
        for connection in connections:
            try:
                await connection.send_json(message)
            except Exception as e:
                print(f"Chyba při odesílání přes WS pro lektora {lecturer_id}: {e}")

    async def broadcast(self, message: dict, lecturer_id: int):
        """
        Pošle zprávu (např. 'Pepa je hotový') pouze konkrétnímu lektorovi.
        Publikuje přes Postgres NOTIFY (ADR-015) — nezávisí na tom, který uvicorn
        worker proces tuto metodu zavolal ani který proces drží cílový WebSocket.

        Fallback na přímé lokální doručení, pokud LISTEN spojení ještě neběží
        (SQLite dev prostředí, nebo krátké okno hned po startu, než se start_listening
        stihne připojit) — zachovává funkčnost pro lokální vývoj a testy.
        """
        if self._pg_conn is None or self._pg_conn.is_closed():
            await self._deliver_local(message, lecturer_id)
            return
        payload = json.dumps({"lecturer_id": lecturer_id, **message})
        await self._pg_conn.execute("SELECT pg_notify($1, $2)", NOTIFY_CHANNEL, payload)

    def _task_key(self, task_data: dict) -> str:
        fd = task_data.get('file_data', {})
        return f"{task_data.get('lecturer_id')}:{task_data.get('scenario_id')}:{fd.get('filename', '')}"

    async def add_task(self, task_data: dict) -> bool:
        """Přidá studenta do fronty k vyhodnocení. Vrátí False pokud je student již ve frontě."""
        key = self._task_key(task_data)
        if key in self._active_keys:
            logger.warning(f"[QUEUE] Duplicita — přeskakuji: {key}")
            return False
        self._active_keys.add(key)
        await self.queue.put(task_data)
        return True

    async def clear_queue(self):
        """Smaže všechny čekající úkoly (např. po kliknutí na tlačítko 'Zastavit')."""
        while not self.queue.empty():
            try:
                task_data = self.queue.get_nowait()
                self._active_keys.discard(self._task_key(task_data))
                self.queue.task_done()
            except asyncio.QueueEmpty:
                break

    async def worker(self, concurrency: int = 4):
        """
        WORKER (DĚLNÍK) NA POZADÍ:
        Tento proces běží nekonečně dlouho a zpracovává úkoly z fronty PARALELNĚ.
        Využívá Semaphor k omezení maximálního počtu souběžných úkolů,
        aby nedošlo k přehlcení LLM serveru (batch processing).
        """
        semaphore = asyncio.Semaphore(concurrency)

        async def _run_task(task_data):
            async with semaphore:
                try:
                    handler = task_data.get('handler')
                    if handler:
                        await handler(task_data)
                except Exception as e:
                    print(f"Chyba při zpracování úkolu: {e}")
                finally:
                    self._active_keys.discard(self._task_key(task_data))
                    self.queue.task_done()

        while True:
            try:
                # Čekáme na úkol (pokud je fronta prázdná, worker zde prostě spí).
                task_data = await self.queue.get()
                # Spustíme úkol asynchronně (neblokujeme smyčku).
                asyncio.create_task(_run_task(task_data))
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"Kritická chyba ve workeru na pozadí: {e}")

    async def close(self):
        """Zavře LISTEN spojení při shutdownu aplikace."""
        if self._pg_conn is not None and not self._pg_conn.is_closed():
            await self._pg_conn.close()


# Vytvoření jedné globální instance — INSTANCOVANÉ ZVLÁŠŤ V KAŽDÉM uvicorn worker
# procesu (--workers 2). Proto broadcast() nespoléhá na tento objekt jako na jediný
# zdroj pravdy o připojených socketech — viz start_listening()/ADR-015.
eval_queue = EvaluationQueue()
