"""Bezpečné spouštění fire-and-forget asyncio tasků.

`asyncio.create_task()` drží na vytvořený task jen SLABOU referenci — pokud si volající
návratovou hodnotu nikam neuloží, může ho garbage collector kdykoli uprostřed běhu
zlikvidovat. Dokumentace asyncio to uvádí explicitně:

    "Important: Save a reference to the result of this function, to avoid a task
     disappearing mid-execution. The event loop only keeps weak references to tasks."

Projev je zákeřně nedeterministický: task většinou doběhne, ale občas ne — bez chyby,
bez tracebacku, bez jediného řádku v logu. V EVALUZu se tím tiše ztrácela individuální
zpětná vazba (u dávky 3 ÚZ se uložila jen u některých studentů).
"""
import asyncio
import logging
from typing import Any, Coroutine, Set

logger = logging.getLogger("evaluz.tasks")

# Silné reference na běžící tasky — drží je naživu, dokud samy neskončí.
_BACKGROUND_TASKS: Set[asyncio.Task] = set()


def spawn_background(coro: Coroutine[Any, Any, Any], *, name: str | None = None) -> asyncio.Task:
    """Spustí korutinu na pozadí a podrží na ni silnou referenci až do dokončení.

    Náhrada za holé `asyncio.create_task()` všude, kde se návratový task zahazuje.
    Případná výjimka se zaloguje — jinak by u nezachyceného tasku skončila jen jako
    "Task exception was never retrieved" při GC, tedy prakticky neviditelně.
    """
    task = asyncio.create_task(coro, name=name)
    _BACKGROUND_TASKS.add(task)

    def _done(finished: asyncio.Task) -> None:
        _BACKGROUND_TASKS.discard(finished)
        if finished.cancelled():
            return
        exc = finished.exception()
        if exc is not None:
            logger.error(
                f"[TASK] Background task '{finished.get_name()}' skončil výjimkou: {exc}",
                exc_info=exc,
            )

    task.add_done_callback(_done)
    return task
