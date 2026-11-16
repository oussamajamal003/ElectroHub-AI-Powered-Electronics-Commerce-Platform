from fastapi.testclient import TestClient


def test_health_check(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["service"] == "electrohub-ai-service"
    assert data["timestamp"].endswith("Z")
    assert data["environment"] == "test"
    assert data["version"] == "0.2.0"
    assert set(data) == {"status", "service", "timestamp", "environment", "version"}


def test_health_needs_no_credential_and_reveals_no_configuration(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    body = response.text.lower()
    for leaked in ("key", "secret", "url", "database", "model"):
        assert leaked not in body


def test_health_stamps_correlation_and_environment_headers(client: TestClient) -> None:
    response = client.get("/health", headers={"X-Request-Id": "req-123_abc"})
    assert response.headers["x-request-id"] == "req-123_abc"
    assert response.headers["x-electrohub-ai-environment"] == "test"
    assert response.headers["cache-control"] == "no-store"
