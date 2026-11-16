from __future__ import annotations

import uuid
from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.conftest import auth_headers, make_settings

NOT_CONFIGURED = {
    "available": False,
    "status": "NOT_READY",
    "reason": "MODEL_NOT_CONFIGURED",
    "modelVersion": None,
    "embeddingVersion": None,
}


def test_readiness_is_truthful_without_a_model(client: TestClient) -> None:
    response = client.get("/internal/v1/ready", headers=auth_headers())
    assert response.status_code == 200
    assert response.json() == {
        "data": {
            "status": "ready",
            "service": "electrohub-ai-service",
            "environment": "test",
            "apiVersion": "v1",
            "modelReady": False,
            "features": {"imageSearch": NOT_CONFIGURED, "recommendations": NOT_CONFIGURED},
        }
    }


def test_capabilities_publish_limits_without_secrets(client_factory: Callable[..., TestClient]) -> None:
    client = client_factory(make_settings(AI_MAX_TOP_K=10, AI_INFERENCE_TIMEOUT_SECONDS=1.5))
    body = client.get("/internal/v1/capabilities", headers=auth_headers()).json()["data"]
    assert body["serviceVersion"] == "0.2.0"
    assert body["features"]["imageSearch"] == NOT_CONFIGURED
    assert body["limits"] == {
        "maxRequestBytes": 1_048_576,
        "maxTopK": 10,
        "maxCandidates": 200,
        "inferenceTimeoutMs": 1500,
        "maxConcurrentInferences": 2,
    }
    assert body["imageSearch"] == {
        "acceptedContentTypes": ["image/jpeg", "image/png", "image/webp"],
        "maxImageBytes": 8_388_608,
        "maxImagePixels": 40_000_000,
        "maxTopK": 10,
        "modelVersion": None,
        "embeddingVersion": None,
    }


def valid_recommendation(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "mode": "SIMILAR_PRODUCTS",
        "productId": str(uuid.uuid4()),
        "candidateProductIds": [str(uuid.uuid4()) for _ in range(3)],
        "limit": 5,
    }
    body.update(overrides)
    return body


def test_valid_recommendation_request_reports_model_not_ready(client: TestClient) -> None:
    response = client.post("/internal/v1/recommendations", json=valid_recommendation(), headers=auth_headers())
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "AI_MODEL_NOT_READY"
    assert "items" not in response.text


def test_image_search_reports_model_not_ready_without_reading_the_body(client: TestClient) -> None:
    response = client.post(
        "/internal/v1/image-search?topK=5",
        content=b"\x89PNG not really an image",
        headers={**auth_headers(), "Content-Type": "application/octet-stream"},
    )
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "AI_MODEL_NOT_READY"
    assert "matches" not in response.text


@pytest.mark.parametrize("top_k", ["0", "-1", "abc", "101"])
def test_image_search_top_k_is_bounded(client: TestClient, top_k: str) -> None:
    response = client.post(f"/internal/v1/image-search?topK={top_k}", headers=auth_headers())
    assert response.status_code == 422


def test_image_search_top_k_respects_configured_limit(client_factory: Callable[..., TestClient]) -> None:
    client = client_factory(make_settings(AI_MAX_TOP_K=10))
    response = client.post("/internal/v1/image-search?topK=11", headers=auth_headers())
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "AI_VALIDATION_FAILED"


DUPLICATE = str(uuid.uuid4())


@pytest.mark.parametrize(
    "body",
    [
        valid_recommendation(productId="not-a-uuid"),
        valid_recommendation(candidateProductIds=["123"]),
        valid_recommendation(candidateProductIds=[DUPLICATE, DUPLICATE]),
        valid_recommendation(limit=0),
        valid_recommendation(limit="5"),  # strict: no string coercion
        valid_recommendation(limit=5.5),
        valid_recommendation(mode="RANDOM"),
        valid_recommendation(productId=None),  # anchored mode needs a product
        valid_recommendation(unexpected="field"),
        valid_recommendation(customerEmail="someone@example.com"),
        valid_recommendation(candidateProductIds=[str(uuid.uuid4()) for _ in range(1001)]),
        {"mode": "POPULAR_PRODUCTS", "limit": 101},
    ],
)
def test_invalid_recommendation_requests_are_rejected(client: TestClient, body: dict[str, Any]) -> None:
    response = client.post("/internal/v1/recommendations", json=body, headers=auth_headers())
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "AI_VALIDATION_FAILED"
    assert error["requestId"]
    # Details carry locations and types only, never the submitted values.
    assert "someone@example.com" not in response.text and "not-a-uuid" not in response.text
    assert all(set(detail) == {"loc", "type"} for detail in error.get("details", []))


def test_configured_limits_apply_on_top_of_schema_limits(client_factory: Callable[..., TestClient]) -> None:
    client = client_factory(make_settings(AI_MAX_TOP_K=4, AI_MAX_CANDIDATES=2))
    over_limit = client.post("/internal/v1/recommendations", json=valid_recommendation(limit=5), headers=auth_headers())
    over_candidates = client.post(
        "/internal/v1/recommendations", json=valid_recommendation(limit=2), headers=auth_headers()
    )
    assert over_limit.status_code == over_candidates.status_code == 422


def test_popular_products_needs_no_anchor(client: TestClient) -> None:
    response = client.post("/internal/v1/recommendations", json={"mode": "POPULAR_PRODUCTS"}, headers=auth_headers())
    assert response.status_code == 503


def test_openapi_documents_contracts_and_security(client: TestClient) -> None:
    schema = client.get("/openapi.json").json()
    paths = schema["paths"]
    assert {
        "/health",
        "/internal/v1/ready",
        "/internal/v1/capabilities",
        "/internal/v1/recommendations",
        "/internal/v1/image-search",
    } <= set(paths)
    schemes = schema["components"]["securitySchemes"]
    assert schemes["InternalServiceKey"] == {"type": "apiKey", "in": "header", "name": "X-ElectroHub-AI-Key"}
    assert paths["/internal/v1/ready"]["get"]["security"]
    assert "security" not in paths["/health"]["get"]
    ranked = schema["components"]["schemas"]["RankedProduct"]["properties"]
    assert ranked["score"]["minimum"] == -1 and ranked["score"]["maximum"] == 1


@pytest.mark.parametrize("environment", ["qa", "production"])
def test_docs_are_not_exposed_outside_development(client_factory: Callable[..., TestClient], environment: str) -> None:
    client = client_factory(make_settings(AI_ENVIRONMENT=environment))
    assert client.get("/docs").status_code == 404
    assert client.get("/openapi.json").status_code == 404
