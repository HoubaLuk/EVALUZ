"""
MODUL: ASYNCHRONNÍ FRONTA (EVALUATION QUEUE)
Tento modul zajišťuje, že se aplikace "nezasekne", když lektor spustí vyhodnocování desítek studentů najednou.
Úkoly se řadí do fronty a zpracovávají se postupně na pozadí, zatímco uživatel může dál pracovat v UI.
"""

import asyncio
from typing import Dict, List, Any
from fastapi import WebSocket

class EvaluationQueue:
    def __init__(self):
        # Interní asynchronní fronta (FIFO - First In, First Out).
        self.queue = asyncio.Queue()
        # Seznam aktivních prohlížečů, kterým posíláme aktualizace o stavu (EVAL_START, SUCCESS...).
        # MAPOVÁNÍ: {lecturer_id: [WebSocket, ...]}
        self.active_connections: Dict[int, List[WebSocket]] = {}
        
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

    async def broadcast(self, message: dict, lecturer_id: int):
        """Pošle zprávu (např. 'Pepa je hotový') pouze konkrétnímu lektorovi."""
        if lecturer_id not in self.active_connections:
            return

        for connection in self.active_connections[lecturer_id]:
            try:
                await connection.send_json(message)
            except Exception as e:
                print(f"Chyba při odesílání přes WS pro lektora {lecturer_id}: {e}")
                
    async def add_task(self, task_data: dict):
        """Přidá studenta do fronty k vyhodnocení."""
        await self.queue.put(task_data)
        
    async def clear_queue(self):
        """Smaže všechny čekající úkoly (např. po kliknutí na tlačítko 'Zastavit')."""
        while not self.queue.empty():
            try:
                self.queue.get_nowait()
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

# Vytvoření jedné globální instance, kterou sdílí celá aplikace.
eval_queue = EvaluationQueue()
