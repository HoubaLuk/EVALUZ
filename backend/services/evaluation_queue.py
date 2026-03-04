import asyncio
from typing import Dict, List, Any
from fastapi import WebSocket

class EvaluationQueue:
    def __init__(self):
        self.queue = asyncio.Queue()
        self.active_connections: List[WebSocket] = []
        
    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        
    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception as e:
                print(f"Chyba při odesílání přes WS: {e}")
                
    async def add_task(self, task_data: dict):
        await self.queue.put(task_data)
        
    async def clear_queue(self):
        while not self.queue.empty():
            try:
                self.queue.get_nowait()
                self.queue.task_done()
            except asyncio.QueueEmpty:
                break
        
    async def worker(self):
        """
        Běží na pozadí celou dobu životnosti aplikace a zpracovává úkoly z fronty.
        """
        while True:
            try:
                task_data = await self.queue.get()
                # Tady proběhne zavolání AI modelu apod. (delegováno zpět do evaluate.py modulu)
                handler = task_data.get('handler')
                if handler:
                    await handler(task_data)
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"Kritická chyba ve workeru na pozadí: {e}")
            finally:
                self.queue.task_done()

# Globální instance fronty
eval_queue = EvaluationQueue()
