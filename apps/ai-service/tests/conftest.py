from __future__ import annotations

from collections.abc import Callable, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings, settings_from_mapping
from app.main import create_app
from app.models.registry import ModelRegistry

# Deliberately fake credentials, distinct per environment (never used outside tests).
TEST_KEY = "t3st-AI-k3y_0123456789abcdefghijKLMNOP"
QA_KEY = "qa-AI-k3y_ZYXWVUTSRQPONMLKJIHG9876543210"


def make_settings(**overrides: Any) -> Settings:
    """Settings built only from explicit values: no process environment, no .env file."""
    values: dict[str, Any] = {"AI_ENVIRONMENT": "test", "AI_SERVICE_API_KEY": TEST_KEY}
    values.update(overrides)
    return settings_from_mapping({k: v for k, v in values.items() if v is not None})


def auth_headers(key: str = TEST_KEY, environment: str = "test") -> dict[str, str]:
    return {"X-ElectroHub-AI-Key": key, "X-ElectroHub-AI-Environment": environment}


@pytest.fixture
def settings() -> Settings:
    return make_settings()


@pytest.fixture
def client_factory() -> Iterator[Callable[..., TestClient]]:
    clients: list[TestClient] = []

    def build(settings: Settings | None = None, registry: ModelRegistry | None = None, **kwargs: Any) -> TestClient:
        client = TestClient(create_app(settings or make_settings(), registry), **kwargs)
        client.__enter__()  # run the lifespan
        clients.append(client)
        return client

    yield build
    for client in clients:
        client.__exit__(None, None, None)


@pytest.fixture
def client(client_factory: Callable[..., TestClient]) -> TestClient:
    return client_factory()
