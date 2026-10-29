"""HTTP contract of POST /internal/v1/recommendations through the real app, auth middleware and lifespan."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from typing import Any

from fastapi.testclient import TestClient

from app.integrations.pgvector_gateway import ProductVector, ScoredProduct
from app.integrations.vector_gateway import EmbeddingSearchGateway
from app.models.descriptor import ModelDescriptor
from app.models.embedding_recommender import ALGORITHM_VERSION, EmbeddingRecommender
from app.models.registry import ModelRegistry
from tests.conftest import auth_headers
from tests.fakes import PRODUCTS, CountingLoader, FakeEncoder, FakeGateway, FakeRanker, FakeVectorReader, ranked

URL = "/internal/v1/recommendations"
ANCHOR = uuid.UUID(int=101)
X_AXIS = (1.0, 0.0, 0.0, 0.0)
Y_AXIS = (0.0, 1.0, 0.0, 0.0)


def vector_registry(reader: FakeVectorReader, *, index_ready: bool = True) -> ModelRegistry:
    """The production wiring: the loaded encoder's descriptor and the read-only index build the D3 recommender."""

    def factory(descriptor: ModelDescriptor, _gateway: EmbeddingSearchGateway) -> EmbeddingRecommender:
        return EmbeddingRecommender(descriptor=descriptor, reader=reader)

    return ModelRegistry(
        image_encoder_loader=CountingLoader(FakeEncoder()),
        vector_gateway=FakeGateway(ready=index_ready),
        recommender_factory=factory,
    )


def similar_body(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {"mode": "SIMILAR_PRODUCTS", "productId": str(ANCHOR), "limit": 2}
    body.update(overrides)
    return body


def test_similar_products_returns_the_camel_case_contract(client_factory: Callable[..., TestClient]) -> None:
    reader = FakeVectorReader(
        centroids={ANCHOR: ProductVector(vector=X_AXIS, image_count=2)},
        neighbours=[
            ScoredProduct(product_id=PRODUCTS[1], score=0.9, vector=(0.9, 0.1, 0.0, 0.0)),
            ScoredProduct(product_id=PRODUCTS[2], score=0.4, vector=Y_AXIS),
        ],
    )
    client = client_factory(registry=vector_registry(reader))

    response = client.post(URL, json=similar_body(), headers=auth_headers())

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["mode"] == "SIMILAR_PRODUCTS"
    assert data["strategy"] == "EMBEDDING_SIMILARITY"
    assert data["algorithmVersion"] == ALGORITHM_VERSION
    assert data["anchorIndexed"] is True
    assert data["modelVersion"] == "test-model-1"
    assert data["embeddingVersion"] == "test-emb-1"
    assert [item["rank"] for item in data["items"]] == [1, 2]
    assert set(data["items"][0]) == {"productId", "score", "rank"}
    # snake_case never leaks onto the wire.
    assert "algorithm_version" not in data and "anchor_indexed" not in data
    # The anchor is excluded at the database boundary.
    assert reader.nearest_calls[0].exclude == (ANCHOR,)


def test_anchor_without_a_current_vector_returns_an_empty_indexed_false_result(
    client_factory: Callable[..., TestClient],
) -> None:
    client = client_factory(registry=vector_registry(FakeVectorReader()))
    data = client.post(URL, json=similar_body(), headers=auth_headers()).json()["data"]
    assert data["items"] == []
    assert data["anchorIndexed"] is False


def test_ranker_loader_path_serves_the_same_contract(client_factory: Callable[..., TestClient]) -> None:
    registry = ModelRegistry(ranker_loader=CountingLoader(FakeRanker(items=ranked(0.7, 0.2))))
    client = client_factory(registry=registry)

    response = client.post(URL, json=similar_body(), headers=auth_headers())

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["strategy"] == "EMBEDDING_SIMILARITY"
    assert data["algorithmVersion"] == "fake-ranker"
    assert data["anchorIndexed"] is True
    assert [item["productId"] for item in data["items"]] == [str(PRODUCTS[0]), str(PRODUCTS[1])]


def test_missing_service_credentials_are_rejected_before_any_retrieval(
    client_factory: Callable[..., TestClient],
) -> None:
    reader = FakeVectorReader(centroids={ANCHOR: ProductVector(vector=X_AXIS, image_count=1)})
    client = client_factory(registry=vector_registry(reader))

    response = client.post(URL, json=similar_body())

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AI_UNAUTHORIZED"
    assert reader.centroid_calls == [] and reader.nearest_calls == []


def test_index_not_ready_is_reported_as_503_without_searching(client_factory: Callable[..., TestClient]) -> None:
    reader = FakeVectorReader(centroids={ANCHOR: ProductVector(vector=X_AXIS, image_count=1)})
    client = client_factory(registry=vector_registry(reader, index_ready=False))

    response = client.post(URL, json=similar_body(), headers=auth_headers())

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "AI_INDEX_NOT_READY"
    assert "items" not in response.text
    assert reader.centroid_calls == [] and reader.nearest_calls == []


def test_recommended_for_you_without_signals_is_a_validation_error(client_factory: Callable[..., TestClient]) -> None:
    client = client_factory(registry=vector_registry(FakeVectorReader()))
    response = client.post(URL, json={"mode": "RECOMMENDED_FOR_YOU"}, headers=auth_headers())
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "AI_VALIDATION_FAILED"
