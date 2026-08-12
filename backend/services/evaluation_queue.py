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
import unicodedata
from typing import Dict, List, Any, Set, Optional
from fastapi import WebSocket

import asyncpg

from utils.tasks import spawn_background

logger = logging.getLogger("evaluz.queue")

NOTIFY_CHANNEL = "evaluz_eval_events"

# Vyhrazený klíč pro ŘÍDICÍ zprávy na NOTIFY_CHANNEL (ADR-017). Zpráva s tímto klíčem
# není určena prohlížeči — vykoná ji každý uvicorn worker proces lokálně (viz _on_notify).
# Používá se pro operace nad per-proces stavem fronty, který jinak není sdílený.
CONTROL_KEY = "__control"


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
        # Zámek nad _pg_conn (ADR-017). Jedno asyncpg spojení NESMÍ obsluhovat dvě korutiny
        # naráz — bez tohoto zámku spadne souběžný broadcast() na
        # `cannot perform operation: another operation is in progress` a s ním celý úkol.
        # pg_notify je sub-milisekundová operace, serializace tedy nic nestojí.
        self._notify_lock = asyncio.Lock()

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

        # ŘÍDICÍ zprávy (ADR-017) se do prohlížeče nedoručují — vykoná je každý proces
        # sám nad svým vlastním stavem fronty. Musí se odchytit PŘED _deliver_local.
        control = data.get(CONTROL_KEY)
        if control is not None:
            if control == "clear_queue":
                spawn_background(
                    self._clear_queue_local(lecturer_id),
                    name=f"clear_queue:{lecturer_id}",
                )
            else:
                logger.warning(f"[QUEUE] Neznámá řídicí zpráva: {control!r}")
            return

        # spawn_background, ne holé create_task — jinak může GC doručení zprávy
        # zlikvidovat dřív, než se stihne odeslat (viz utils/tasks.py).
        spawn_background(
            self._deliver_local(data, lecturer_id),
            name=f"ws_deliver:{lecturer_id}",
        )

    async def _deliver_local(self, message: dict, lecturer_id: int):
        """Doručí zprávu jen socketům registrovaným v TOMTO procesu (kopie listu — bezpečné vůči souběžnému disconnect())."""
        connections = list(self.active_connections.get(lecturer_id, []))
        for connection in connections:
            try:
                await connection.send_json(message)
            except Exception as e:
                logger.warning(f"[QUEUE] Chyba při odesílání přes WS pro lektora {lecturer_id}: {e}")

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
        # Zámek je povinný: _pg_conn je JEDNO sdílené asyncpg spojení a při dávce běží
        # tato metoda z N souběžných úloh naráz (ADR-017).
        async with self._notify_lock:
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

        # Oznámení o ZAŘAZENÍ do fronty. Při dávce větší než `concurrency` se část ÚZ
        # rozeběhne až po uvolnění slotu (u dávky 5 při limitu 4 to byly ~2 minuty).
        # Bez tohohle oznámení vypadal čekající ÚZ v UI úplně stejně jako nezahájený,
        # takže lektor dávku zbytečně spouštěl znovu.
        try:
            await self.broadcast({
                "type": "EVAL_QUEUED",
                "student_name": unicodedata.normalize(
                    'NFC', (task_data.get('file_data') or {}).get('filename', '') or ''
                ),
                "scenario_id": task_data.get('scenario_id'),
            }, lecturer_id=task_data.get('lecturer_id'))
        except Exception as e:
            # Oznámení je informativní — jeho selhání nesmí zabránit zařazení úkolu.
            logger.warning(f"[QUEUE] Nepodařilo se odeslat EVAL_QUEUED pro {key}: {e}")

        return True

    async def clear_queue(self, lecturer_id: Optional[int] = None):
        """
        Zruší čekající úkoly (tlačítko 'Zastavit'). S `lecturer_id` smaže jen úkoly
        daného lektora, ostatním fronta běží dál.

        Publikuje ŘÍDICÍ zprávu přes NOTIFY (ADR-017), protože fronta i `_active_keys`
        jsou per-proces (ADR-015) — HTTP request dopadne jen na jeden z `--workers N`
        procesů a čistě lokální úklid by minul úkoly zařazené v tom druhém. Postgres
        doručí NOTIFY všem posluchačům včetně odesílatele, takže se uklidí i tento proces.

        Fallback na přímý lokální úklid, když LISTEN spojení neběží (SQLite dev / testy).
        """
        if self._pg_conn is None or self._pg_conn.is_closed():
            await self._clear_queue_local(lecturer_id)
            return
        payload = json.dumps({"lecturer_id": lecturer_id, CONTROL_KEY: "clear_queue"})
        async with self._notify_lock:
            await self._pg_conn.execute("SELECT pg_notify($1, $2)", NOTIFY_CHANNEL, payload)

    async def _clear_queue_local(self, lecturer_id: Optional[int] = None) -> int:
        """
        Vyprázdní frontu TOHOTO procesu. Úkoly cizích lektorů se vrací zpět do fronty,
        takže „Zastavit" jednoho lektora nezasáhne ostatní. Vrací počet zrušených úkolů.

        Párování `get_nowait()` ↔ `task_done()` zůstává vyvážené i u vrácených úkolů —
        `put()` unfinished počítadlo znovu zvedne.
        """
        kept: List[dict] = []
        removed = 0
        while True:
            try:
                task_data = self.queue.get_nowait()
            except asyncio.QueueEmpty:
                break
            if lecturer_id is None or task_data.get("lecturer_id") == lecturer_id:
                self._active_keys.discard(self._task_key(task_data))
                removed += 1
            else:
                kept.append(task_data)
            self.queue.task_done()

        for task_data in kept:
            await self.queue.put(task_data)

        if removed or kept:
            logger.info(
                f"[QUEUE] clear_queue(lecturer_id={lecturer_id}): "
                f"zrušeno {removed}, ponecháno cizích {len(kept)}"
            )
        return removed

    async def worker(self, concurrency: int = 4):
        """
        WORKER (DĚLNÍK) NA POZADÍ:
        Tento proces běží nekonečně dlouho a zpracovává úkoly z fronty PARALELNĚ.
        Využívá Semaphor k omezení maximálního počtu souběžných úkolů,
        aby nedošlo k přehlcení LLM serveru (batch processing).
        """
        semaphore = asyncio.Semaphore(concurrency)

        async def _run_task(task_data):
            # Slot v semaforu si REZERVOVALA smyčka níž a předala ho tomuhle tasku —
            # uvolní se ve `finally`. Viz komentář u `semaphore.acquire()`.
            try:
                try:
                    handler = task_data.get('handler')
                    if handler:
                        await handler(task_data)
                except Exception as e:
                    # ZÁCHRANNÁ SÍŤ (ADR-017) — invariant: každý zařazený úkol musí
                    # vyprodukovat právě jednu terminální událost (EVAL_SUCCESS / EVAL_ERROR).
                    # Handler má vlastní try/except, ale může spadnout i dřív, než se k němu
                    # dostane. Bez tohoto by úkol zmizel beze stopy: prohlížeč by čekal na
                    # oznámení, které nikdy nepřijde, kolečko by zůstalo viset a lektor by
                    # musel dávku spouštět znovu ručně.
                    student_name = unicodedata.normalize(
                        'NFC', (task_data.get('file_data') or {}).get('filename', '') or '?'
                    )
                    logger.error(
                        f"[QUEUE] Úkol '{student_name}' selhal mimo handler: {e}",
                        exc_info=True,
                    )
                    try:
                        await self.broadcast({
                            "type": "EVAL_ERROR",
                            "student_name": student_name,
                            "error": str(e),
                        }, lecturer_id=task_data.get('lecturer_id'))
                    except Exception as notify_err:
                        logger.error(
                            f"[QUEUE] Nepodařilo se odeslat EVAL_ERROR pro '{student_name}': {notify_err}"
                        )
                finally:
                    self._active_keys.discard(self._task_key(task_data))
                    self.queue.task_done()
            finally:
                semaphore.release()

        while True:
            try:
                # Slot se rezervuje PŘED vyzvednutím úkolu z fronty.
                #
                # Dřív se čekalo na semafor až uvnitř tasku, takže smyčka vytáhla VŠECHNY
                # úkoly hned a fronta zůstala prázdná. Dva důsledky, oba pozorované
                # v provozu u dávky 5 ÚZ (concurrency=4/proces):
                #   1. Pátý ÚZ nikde nefiguroval jako čekající — vypadal nezahájeně,
                #      i když se rozeběhl sám asi za dvě minuty, jakmile se slot uvolnil.
                #   2. „Zastavit" (clear_queue) neměl co rušit, protože fronta už byla
                #      prázdná — čekající úkol tak zrušit nešlo.
                # S rezervací napřed zůstávají čekající úkoly ve frontě: jsou vidět
                # (qsize) i zrušitelné.
                await semaphore.acquire()
                try:
                    task_data = await self.queue.get()
                    # spawn_background drží silnou referenci — bez ní by GC mohl celou
                    # evaluaci zahodit v půlce (ADR-020). Slot přebírá vytvořený task
                    # a uvolní ho ve svém `finally`.
                    spawn_background(
                        _run_task(task_data),
                        name=f"eval:{(task_data.get('file_data') or {}).get('filename', '?')}",
                    )
                except BaseException:
                    # Slot se nepodařilo předat žádnému tasku → vrátit, ať se fronta nezatuhne.
                    semaphore.release()
                    raise
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"[QUEUE] Kritická chyba ve workeru na pozadí: {e}", exc_info=True)

    async def close(self):
        """Zavře LISTEN spojení při shutdownu aplikace."""
        if self._pg_conn is not None and not self._pg_conn.is_closed():
            await self._pg_conn.close()


# Vytvoření jedné globální instance — INSTANCOVANÉ ZVLÁŠŤ V KAŽDÉM uvicorn worker
# procesu (--workers 2). Proto broadcast() nespoléhá na tento objekt jako na jediný
# zdroj pravdy o připojených socketech — viz start_listening()/ADR-015.
eval_queue = EvaluationQueue()
