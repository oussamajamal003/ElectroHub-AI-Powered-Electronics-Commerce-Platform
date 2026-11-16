"""Bounded execution of CPU/GPU-bound inference off the event loop (U10).

Admission is non-blocking: when every slot is busy the caller gets ``AI_RATE_LIMITED`` instead
of queueing unbounded work. A slot is held until the worker thread actually finishes, so work
that outlives its timeout still counts against capacity rather than piling up behind it.
"""

from __future__ import annotations

import threading
from collections.abc import Callable
from typing import TypeVar

import anyio
import anyio.to_thread

from app.core.errors import InferenceTimeoutError, RateLimitedError

T = TypeVar("T")


class InferenceExecutor:
    def __init__(self, *, max_concurrency: int, timeout_seconds: float) -> None:
        self._slots = threading.BoundedSemaphore(max_concurrency)
        self._timeout_seconds = timeout_seconds

    async def run(self, fn: Callable[[], T]) -> T:
        if not self._slots.acquire(blocking=False):
            raise RateLimitedError(retry_after_seconds=1)

        def work() -> T:
            try:
                return fn()
            finally:
                self._slots.release()

        try:
            with anyio.fail_after(self._timeout_seconds):
                return await anyio.to_thread.run_sync(work, abandon_on_cancel=True)
        except TimeoutError as exc:
            raise InferenceTimeoutError() from exc
