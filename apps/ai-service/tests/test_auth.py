from __future__ import annotations

from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient

from tests.conftest import QA_KEY, TEST_KEY, auth_headers, make_settings

INTERNAL_GETS = ["/internal/v1/ready", "/internal/v1/capabilities"]


@pytest.mark.parametrize("path", INTERNAL_GETS)
def test_missing_credential_is_rejected(client: TestClient, path: str) -> None:
    response = client.get(path)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AI_UNAUTHORIZED"
    assert "features" not in response.text


@pytest.mark.parametrize("path", INTERNAL_GETS)
def test_wrong_credential_is_rejected(client: TestClient, path: str) -> None:
    response = client.get(path, headers=auth_headers(key=TEST_KEY[:-1] + "X"))
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AI_UNAUTHORIZED"


def test_customer_bearer_token_is_not_a_service_credential(client: TestClient) -> None:
    response = client.get(
        "/internal/v1/ready",
        headers={"Authorization": f"Bearer {TEST_KEY}", "X-ElectroHub-AI-Environment": "test"},
    )
    assert response.status_code == 401


def test_oversized_credential_header_is_rejected(client: TestClient) -> None:
    response = client.get("/internal/v1/ready", headers=auth_headers(key="k" * 4096))
    assert response.status_code == 401


def test_correct_credential_for_another_environment_is_forbidden(client: TestClient) -> None:
    response = client.get("/internal/v1/ready", headers=auth_headers(environment="production"))
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "AI_ENVIRONMENT_MISMATCH"


def test_environment_is_only_checked_after_authentication(client: TestClient) -> None:
    # An anonymous caller cannot probe which environment it reached.
    response = client.get("/internal/v1/ready", headers={"X-ElectroHub-AI-Environment": "production"})
    assert response.status_code == 401


def test_valid_credential_is_accepted(client: TestClient) -> None:
    assert client.get("/internal/v1/ready", headers=auth_headers()).status_code == 200


def test_unconfigured_credential_fails_closed(client_factory: Callable[..., TestClient]) -> None:
    client = client_factory(make_settings(AI_ENVIRONMENT="development", AI_SERVICE_API_KEY=""))
    for headers in ({}, auth_headers(environment="development")):
        response = client.get("/internal/v1/ready", headers=headers)
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "AI_AUTH_NOT_CONFIGURED"
    assert client.get("/health").status_code == 200


def test_unauthenticated_body_is_never_parsed(client: TestClient) -> None:
    # Malformed JSON would be a 422 if parsed; authentication must win first.
    response = client.post(
        "/internal/v1/recommendations",
        content=b"{not json",
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 401


def test_unknown_internal_paths_do_not_reveal_routing_to_anonymous_callers(client: TestClient) -> None:
    assert client.get("/internal/v1/does-not-exist").status_code == 401
    assert client.get("/internal/v1/does-not-exist", headers=auth_headers()).status_code == 404


def test_cors_is_not_enabled(client: TestClient) -> None:
    response = client.options(
        "/internal/v1/ready",
        headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "GET"},
    )
    assert "access-control-allow-origin" not in response.headers


def test_dev_credential_cannot_call_qa_instance(client_factory: Callable[..., TestClient]) -> None:
    qa = client_factory(make_settings(AI_ENVIRONMENT="qa", AI_SERVICE_API_KEY=QA_KEY))
    assert qa.get("/internal/v1/ready", headers=auth_headers(key=TEST_KEY, environment="qa")).status_code == 401
    assert qa.get("/internal/v1/ready", headers=auth_headers(key=QA_KEY, environment="development")).status_code == 403
    response = qa.get("/internal/v1/ready", headers=auth_headers(key=QA_KEY, environment="qa"))
    assert response.status_code == 200
    assert response.headers["x-electrohub-ai-environment"] == "qa"
    assert response.json()["data"]["environment"] == "qa"
