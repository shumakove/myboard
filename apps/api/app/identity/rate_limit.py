"""Ограничение частоты неудачных попыток входа с одного адреса (ARCHITECTURE.md, раздел 12).

Счётчики живут в памяти процесса: в первой версии API — один процесс.
"""

import math
import time
from collections import defaultdict, deque
from collections.abc import Callable

MAX_FAILURES = 10
WINDOW_SECONDS = 60.0


class LoginRateLimiter:
    """Скользящее окно: не больше `max_failures` неудачных попыток за `window` секунд."""

    def __init__(
        self,
        max_failures: int = MAX_FAILURES,
        window: float = WINDOW_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._max_failures = max_failures
        self._window = window
        self._clock = clock
        self._failures: defaultdict[str, deque[float]] = defaultdict(deque)

    def retry_after(self, address: str) -> int | None:
        """Сколько секунд адрес должен подождать; `None`, если попытка разрешена."""
        failures = self._failures.get(address)
        if failures is None:
            return None
        now = self._clock()
        while failures and failures[0] <= now - self._window:
            failures.popleft()
        if not failures:
            del self._failures[address]
            return None
        if len(failures) < self._max_failures:
            return None
        return max(1, math.ceil(failures[0] + self._window - now))

    def record_failure(self, address: str) -> None:
        self._failures[address].append(self._clock())
