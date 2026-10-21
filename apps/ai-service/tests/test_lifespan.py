from __future__ import annotations

import importlib
import threading
from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import create_app
from app.models.descriptor import ModelDescriptor
from app.models.registry import ModelRegistry
from tests.conftest import auth_headers, make_settings
from tests.fakes import DESCRIPTOR, CountingLoader, FakeEncoder, FakeGateway, FakeRanker


def test_importing_the_app_module_builds_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    import app.core.config as config

    def fail() -> None:
        raise AssertionError("settings must not be loaded on import")

    monkeypatch.setattr(config, "get_settings", fail)
    importlib.reload(importlib.import_module("app.main"))


def test_requests_before_startup_report_not_ready() -> None:
    client = TestClient(create_app(make_settings()))  # no context manager: lifespan not run
    response = client.get("/internal/v1/ready", headers=auth_headers())
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "AI_NOT_READY"
    assert client.get("/health").status_code == 200


def test_loaders_run_once_off_the_event_loop_and_models_close_on_shutdown() -> None:
    encoder, ranker, gateway = FakeEncoder(), FakeRanker(), FakeGateway()
    encoder_loader, ranker_loader = CountingLoader(encoder), CountingLoader(ranker)
    registry = ModelRegistry(image_encoder_loader=encoder_loader, ranker_loader=ranker_loader, vector_gateway=gateway)

    with TestClient(create_app(make_settings(), registry)) as client:
        for _ in range(3):
            body = client.get("/internal/v1/ready", headers=auth_headers()).json()["data"]
        assert body["modelReady"] is True
        assert body["features"]["imageSearch"] == {
            "available": True,
            "status": "READY",
            "reason": None,
            "modelVersion": "test-model-1",
            "embeddingVersion": "test-emb-1",
        }
        assert body["features"]["recommendations"]["available"] is True
        assert encoder_loader.calls == ranker_loader.calls == 1
        assert encoder_loader.threads[0] != threading.get_ident()
        assert not encoder.closed

    assert encoder.closed and ranker.closed and gateway.closed


def test_failed_load_is_reported_honestly_and_service_stays_up() -> None:
    def broken_loader() -> Any:
        raise OSError("checksum mismatch")

    registry = ModelRegistry(image_encoder_loader=broken_loader)
    with TestClient(create_app(make_settings(), registry)) as client:
        ready = client.get("/internal/v1/ready", headers=auth_headers())
        assert ready.status_code == 200
        assert ready.json()["data"]["features"]["imageSearch"]["reason"] == "MODEL_NOT_LOADED"
        search = client.post("/internal/v1/image-search", headers=auth_headers())
        assert search.json()["error"]["code"] == "AI_MODEL_NOT_READY"


def test_loader_returning_the_wrong_kind_of_model_is_not_used() -> None:
    registry = ModelRegistry(image_encoder_loader=CountingLoader(FakeRanker()))
    with TestClient(create_app(make_settings(), registry)) as client:
        features = client.get("/internal/v1/ready", headers=auth_headers()).json()["data"]["features"]
        assert features["imageSearch"]["reason"] == "MODEL_NOT_LOADED"


@pytest.mark.parametrize("gateway", [None, FakeGateway(ready=False)])
def test_encoder_without_an_active_index_is_not_ready(gateway: FakeGateway | None) -> None:
    registry = ModelRegistry(image_encoder_loader=CountingLoader(FakeEncoder()), vector_gateway=gateway)
    with TestClient(create_app(make_settings(), registry)) as client:
        image = client.get("/internal/v1/ready", headers=auth_headers()).json()["data"]["features"]["imageSearch"]
        assert image["reason"] == "INDEX_NOT_READY" and image["available"] is False
        assert image["modelVersion"] == "test-model-1"
        response = client.post("/internal/v1/image-search", headers=auth_headers())
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "AI_INDEX_NOT_READY"


def test_image_search_route_never_fabricates_results_before_upload_support(
    client_factory: Callable[..., TestClient],
) -> None:
    registry = ModelRegistry(image_encoder_loader=CountingLoader(FakeEncoder()), vector_gateway=FakeGateway())
    client = client_factory(registry=registry)
    response = client.post("/internal/v1/image-search", headers=auth_headers())
    assert response.status_code == 501
    assert response.json()["error"]["code"] == "AI_NOT_IMPLEMENTED"


@pytest.mark.parametrize(
    "change",
    [
        {"artifact_format": "pickle"},
        {"artifact_sha256": "abc"},
        {"embedding_dimension": 0},
        {"model_version": "../../etc/passwd"},
    ],
)
def test_model_descriptor_rejects_unsafe_artifacts(change: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        ModelDescriptor.model_validate({**DESCRIPTOR.model_dump(), **change})
