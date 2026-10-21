"""Входящие кадры соединения, уже вычитанные из сокета (COL-01, BUG-018).

Uvicorn читает из сокета следующую порцию, только когда приложение забрало предыдущий
кадр. Пока правка применяется и пишется в базу, остальные кадры лежат в буфере ядра и
пропадают, если соединение обрывается (перезагрузка вкладки за прокси), хотя браузер их
уже отправил. Поэтому сокет вычитывается отдельной задачей сразу по приходу кадров, а
применяются они из этой очереди.
"""

import asyncio
from collections import deque
from dataclasses import dataclass
from typing import TypeGuard

from app.realtime.protocol import ClientMessage, SyncKind, SyncMessage


@dataclass(frozen=True)
class Closed:
    """Конец потока кадров: клиент ушёл или прислал повреждённый кадр."""

    corrupted: bool


Inbound = ClientMessage | Closed


def is_update(item: Inbound) -> TypeGuard[SyncMessage]:
    """Правка документа: `UPDATE` или ответ клиента `STEP2` (недостающие у сервера правки)."""
    return isinstance(item, SyncMessage) and item.kind is not SyncKind.STEP1


class Inbox:
    """Очередь без ограничения: чтение сокета не ждёт применения правок."""

    def __init__(self) -> None:
        self._items: deque[Inbound] = deque()
        self._ready = asyncio.Event()

    def put(self, item: Inbound) -> None:
        self._items.append(item)
        self._ready.set()

    async def get(self) -> Inbound:
        while not self._items:
            self._ready.clear()
            await self._ready.wait()
        return self._items.popleft()

    def take_updates(self) -> list[bytes]:
        """Правки, стоящие в очереди подряд с начала: их применяют и пишут одной транзакцией."""
        updates: list[bytes] = []
        while self._items:
            head = self._items[0]
            if not is_update(head):
                break
            updates.append(head.payload)
            self._items.popleft()
        return updates
