from __future__ import annotations

import threading
import time
from collections.abc import Callable, Iterator

import anyio
import pytest
from fastapi.testclient import TestClient

from app.core.errors import InferenceTimeoutError, RateLimitedError
from app.processors.inference import InferenceExecutor
from tests.conftest import auth_headers, make_settings


def test_declared_oversized_body_is_rejected_before_reading(client_factory: Callable[..., TestClient]) -> None:
    client = client_factory(make_settings(AI_MAX_REQUEST_BYTES=1024))
    response = client.post(
        "/internal/v1/recommendations",
        content=b"{" + b" " * 2000 + b"}",
        headers={**auth_headers(), "Content-Type": "application/json"},
    )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "AI_PAYLOAD_TOO_LARGE"


def test_streamed_oversized_body_is_rejected(client_factory: Callable[..., TestClient]) -> None:
    client = client_factory(make_settings(AI_MAX_REQUEST_BYTES=1024))

    def chunks() -> Iterator[bytes]:
        yield b'{"mode": "POPULAR_PRODUCTS", "pad": "'
        for _ in range(10):
            yield b"x" * 512
        yield b'"}'

    response = client.post(
        "/internal/v1/recommendations",
        content=chunks(),
        headers={**auth_headers(), "Content-Type": "application/json"},
    )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "AI_PAYLOAD_TOO_LARGE"


def test_malformed_content_length_is_rejected(client: TestClient) -> None:
    response = client.post(
        "/internal/v1/recommendations",
        content=b"{}",
        headers={**auth_headers(), "Content-Type": "application/json", "Content-Length": "abc"},
    )
    assert response.status_code == 400


def test_executor_runs_work_off_the_event_loop() -> None:
    executor = InferenceExecutor(max_concurrency=1, timeout_seconds=2)
    loop_thread = threading.get_ident()

    async def main() -> int:
        return await executor.run(threading.get_ident)

    assert anyio.run(main) != loop_thread


def test_executor_rejects_work_beyond_capacity_instead_of_queueing() -> None:
    executor = InferenceExecutor(max_concurrency=1, timeout_seconds=2)
    release = threading.Event()
    started = threading.Event()

    def slow() -> str:
        started.set()
        release.wait(5)
        return "done"

    async def main() -> None:
        async with anyio.create_task_group() as group:
            group.start_soon(executor.run, slow)
            await anyio.to_thread.run_sync(started.wait, 5)
            with pytest.raises(RateLimitedError):
                await executor.run(lambda: "second")
            release.set()

    anyio.run(main)


def test_executor_times_out_and_keeps_the_slot_until_the_work_really_ends() -> None:
    executor = InferenceExecutor(max_concurrency=1, timeout_seconds=0.1)
    release = threading.Event()

    def stuck() -> None:
        release.wait(5)

    async def main() -> None:
        started = time.perf_counter()
        with pytest.raises(InferenceTimeoutError):
            await executor.run(stuck)
        assert time.perf_counter() - started < 1
        # The abandoned thread still occupies capacity: no unbounded pile-up behind it.
        with pytest.raises(RateLimitedError):
            await executor.run(lambda: None)
        release.set()
        await anyio.sleep(0.2)
        assert await executor.run(lambda: "free again") == "free again"

    anyio.run(main)


def test_executor_propagates_model_errors() -> None:
    executor = InferenceExecutor(max_concurrency=1, timeout_seconds=1)

    def broken() -> None:
        raise ValueError("bad tensor")

    async def main() -> None:
        with pytest.raises(ValueError, match="bad tensor"):
            await executor.run(broken)
        assert await executor.run(lambda: 1) == 1  # slot released after failure

    anyio.run(main)
