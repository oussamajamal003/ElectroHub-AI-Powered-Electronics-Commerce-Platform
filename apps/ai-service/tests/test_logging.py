from __future__ import annotations

import io
import json
import logging
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.core.logging import LOGGER_NAME, JsonFormatter, log_event, sanitize_fields
from tests.conftest import TEST_KEY, auth_headers


@pytest.fixture
def log_lines() -> Iterator[io.StringIO]:
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(JsonFormatter())
    logger = logging.getLogger(LOGGER_NAME)
    logger.addHandler(handler)
    yield stream
    logger.removeHandler(handler)


def events(stream: io.StringIO) -> list[dict[str, object]]:
    return [json.loads(line) for line in stream.getvalue().splitlines() if line]


def test_sensitive_fields_are_dropped() -> None:
    clean = sanitize_fields(
        {
            "apiKey": "k",
            "authorization": "Bearer x",
            "imageBytes": b"\x89PNG",
            "queryVector": [0.1],
            "customerEmail": "a@b.c",
            "requestId": "r1",
            "durationMs": 3.2,
        }
    )
    assert clean == {"requestId": "r1", "durationMs": 3.2}


def test_request_logs_never_contain_credentials_or_bodies(client: TestClient, log_lines: io.StringIO) -> None:
    client.post(
        "/internal/v1/recommendations",
        json={"mode": "POPULAR_PRODUCTS", "candidateProductIds": [], "limit": 3},
        headers={**auth_headers(), "Authorization": "Bearer customer-jwt-value", "X-Request-Id": "log-1"},
    )
    client.get("/internal/v1/ready", headers={"X-ElectroHub-AI-Key": "wrong-" + TEST_KEY})
    raw = log_lines.getvalue()
    assert TEST_KEY not in raw and "customer-jwt-value" not in raw and "POPULAR_PRODUCTS" not in raw
    names = [entry["event"] for entry in events(log_lines)]
    assert "ai.request" in names and "ai.model_unavailable" in names and "ai.auth_rejected" in names
    request = next(e for e in events(log_lines) if e["event"] == "ai.request" and e["requestId"] == "log-1")
    assert request["status"] == 503 and request["path"] == "/internal/v1/recommendations"
    assert isinstance(request["durationMs"], float)


def test_unhandled_exception_traceback_stays_in_the_process_log(log_lines: io.StringIO) -> None:
    try:
        raise RuntimeError("internal detail")
    except RuntimeError:
        log_event("ai.unhandled_error", level=logging.ERROR, exc_info=True, requestId="r2")
    entry = events(log_lines)[-1]
    assert entry["exception"] == "RuntimeError" and "Traceback" in str(entry["traceback"])
