from __future__ import annotations

from collections.abc import Callable
from typing import cast

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.errors import IndexNotReadyError
from tests.conftest import auth_headers


def test_not_found_uses_the_error_envelope(client: TestClient) -> None:
    response = client.get("/nope", headers={"X-Request-Id": "trace-1"})
    assert response.status_code == 404
    assert response.json() == {"error": {"code": "AI_NOT_FOUND", "message": "Not found.", "requestId": "trace-1"}}


def test_method_not_allowed_uses_the_error_envelope(client: TestClient) -> None:
    response = client.post("/health")
    assert response.status_code == 405
    assert response.json()["error"]["code"] == "AI_METHOD_NOT_ALLOWED"
    assert response.headers["allow"] == "GET"


def test_unsafe_request_id_is_replaced(client: TestClient) -> None:
    response = client.get("/health", headers={"X-Request-Id": "bad id;<script>"})
    request_id = response.headers["x-request-id"]
    assert request_id != "bad id;<script>"
    assert len(request_id) == 36


def test_request_id_reaches_error_bodies(client: TestClient) -> None:
    response = client.get("/internal/v1/ready", headers={"X-Request-Id": "abc-123"})
    assert response.json()["error"]["requestId"] == "abc-123"
    assert response.headers["x-request-id"] == "abc-123"


def test_unhandled_errors_are_sanitized(client_factory: Callable[..., TestClient]) -> None:
    client = client_factory(raise_server_exceptions=False)

    app = cast(FastAPI, client.app)

    @app.get("/boom")
    async def boom() -> None:
        raise RuntimeError("database password=hunter2 at /srv/secret/path")

    response = client.get("/boom", headers={"X-Request-Id": "boom-1"})
    assert response.status_code == 500
    assert response.json() == {
        "error": {
            "code": "AI_INTERNAL_ERROR",
            "message": "The AI service could not complete the request.",
            "requestId": "boom-1",
        }
    }
    assert response.headers["x-request-id"] == "boom-1"
    assert "hunter2" not in response.text and "Traceback" not in response.text


def test_domain_errors_map_to_stable_codes(client_factory: Callable[..., TestClient]) -> None:
    client = client_factory()

    app = cast(FastAPI, client.app)

    @app.get("/internal/v1/test-index")
    async def index() -> None:
        raise IndexNotReadyError()

    response = client.get("/internal/v1/test-index", headers=auth_headers())
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "AI_INDEX_NOT_READY"
