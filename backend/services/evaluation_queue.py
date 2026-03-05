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
        self.active_connections: List[WebSocket] = []
        
    async def connect(self, websocket: WebSocket):
        """Zaregistruje prohlížeč pro příjem real-time oznámení přes WebSocket."""
        await websocket.accept()
        self.active_connections.append(websocket)
        
    def disconnect(self, websocket: WebSocket):
        """Odebere prohlížeč ze seznamu po zavření karty nebo odhlášení."""
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        """Pošle zprávu (např. 'Pepa je hotový') všem připojeným lektorům."""
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception as e:
                print(f"Chyba při odesílání přes WS: {e}")
                
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
        
    async def worker(self):
        """
        WORKER (DĚLNÍK) NA POZADÍ:
        Tento proces běží nekonečně dlouho. Jakmile se ve frontě objeví úkol, vezme ho, 
        spustí příslušnou funkci (handler) a po dokončení čeká na další.
        """
        while True:
            try:
                # Čekáme na úkol (pokud je fronta prázdná, worker zde prostě spí a nezatěžuje procesor).
                task_data = await self.queue.get()
                
                # Handler je funkce, která má úkol skutečně provést (většinou process_single_file_bg z evaluate.py).
                handler = task_data.get('handler')
                if handler:
                    await handler(task_data)
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"Kritická chyba ve workeru na pozadí: {e}")
            finally:
                # Potvrdíme, že úkol je hotový (důležité pro vnitřní správu fronty).
                self.queue.task_done()

# Vytvoření jedné globální instance, kterou sdílí celá aplikace.
eval_queue = EvaluationQueue()
