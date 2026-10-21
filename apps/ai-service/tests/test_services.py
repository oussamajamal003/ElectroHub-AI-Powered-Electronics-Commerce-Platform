"""Orchestration over injected test doubles. Proves the seams validate model/index output;
it is not, and does not stand in for, real image retrieval."""

from __future__ import annotations

import math
import threading
import uuid

import anyio
import pytest

from app.core.errors import InferenceOutputError, ModelNotReadyError, ValidationFailedError
from app.models.registry import ModelRegistry
from app.processors.image import ValidatedImage
from app.processors.inference import InferenceExecutor
from app.schemas.common import RankedProduct
from app.schemas.recommendations import RecommendationRequest
from app.services.image_search_service import ImageSearchService
from app.services.recommendation_service import RecommendationService
from tests.conftest import make_settings
from tests.fakes import PRODUCTS, CountingLoader, FakeEncoder, FakeGateway, FakeRanker, ranked

IMAGE = ValidatedImage(content_type="image/png", width=8, height=8, data=b"\x89PNG-test-bytes")


def image_service(encoder: FakeEncoder, gateway: FakeGateway) -> tuple[ImageSearchService, ModelRegistry]:
    registry = ModelRegistry(image_encoder_loader=CountingLoader(encoder), vector_gateway=gateway)
    executor = InferenceExecutor(max_concurrency=1, timeout_seconds=2)
    return ImageSearchService(registry, executor, make_settings(AI_MAX_TOP_K=3)), registry


def run_search(encoder: FakeEncoder, gateway: FakeGateway, top_k: int = 3) -> object:
    service, registry = image_service(encoder, gateway)

    async def main() -> object:
        await registry.start()
        try:
            return await service.search(IMAGE, top_k)
        finally:
            await registry.stop()

    return anyio.run(main)


def test_search_returns_validated_version_stamped_references() -> None:
    encoder, gateway = FakeEncoder(), FakeGateway(results=ranked(0.9, 0.5))
    result = run_search(encoder, gateway)
    assert [m.product_id for m in result.matches] == PRODUCTS[:2]  # type: ignore[attr-defined]
    assert result.model_version == "test-model-1"  # type: ignore[attr-defined]
    assert gateway.queried_with == [encoder.descriptor]
    assert encoder.encode_threads and encoder.encode_threads[0] != threading.get_ident()


def test_empty_retrieval_is_a_valid_result() -> None:
    assert run_search(FakeEncoder(), FakeGateway(results=[])).matches == []  # type: ignore[attr-defined]


@pytest.mark.parametrize(
    "vector",
    [(1.0, 0.0, 0.0), (1.0, 0.0, 0.0, 0.0, 0.0), (math.nan, 0.0, 0.0, 0.0), (math.inf, 0.0, 0.0, 0.0)],
)
def test_wrong_dimension_or_non_finite_embeddings_are_rejected(vector: tuple[float, ...]) -> None:
    with pytest.raises(InferenceOutputError):
        run_search(FakeEncoder(vector=vector), FakeGateway(results=ranked(0.9)))


@pytest.mark.parametrize(
    "results",
    [
        ranked(0.9, 0.8, ids=[PRODUCTS[0], PRODUCTS[0]]),  # duplicate product
        ranked(0.5, 0.9),  # scores increase with rank
        [RankedProduct(product_id=PRODUCTS[0], score=0.9, rank=2)],  # non-contiguous rank
        ranked(0.9, 0.8, 0.7, 0.6),  # more than topK
    ],
)
def test_invalid_index_output_is_rejected(results: list[RankedProduct]) -> None:
    with pytest.raises(InferenceOutputError):
        run_search(FakeEncoder(), FakeGateway(results=results))


def test_search_refuses_without_a_model_and_bounds_top_k() -> None:
    service = ImageSearchService(
        ModelRegistry(), InferenceExecutor(max_concurrency=1, timeout_seconds=1), make_settings(AI_MAX_TOP_K=3)
    )
    with pytest.raises(ModelNotReadyError):
        anyio.run(service.search, IMAGE, 3)
    with pytest.raises(ValidationFailedError):
        anyio.run(service.search, IMAGE, 4)


def run_recommend(ranker: FakeRanker, request: RecommendationRequest) -> object:
    registry = ModelRegistry(ranker_loader=CountingLoader(ranker))
    service = RecommendationService(registry, InferenceExecutor(max_concurrency=1, timeout_seconds=2), make_settings())

    async def main() -> object:
        await registry.start()
        return await service.recommend(request)

    return anyio.run(main)


def test_recommendations_are_validated_and_version_stamped() -> None:
    request = RecommendationRequest(mode="SIMILAR_PRODUCTS", product_id=uuid.uuid4(), limit=2)
    result = run_recommend(FakeRanker(items=ranked(0.7, 0.2)), request)
    assert [item.rank for item in result.items] == [1, 2]  # type: ignore[attr-defined]
    assert result.mode == "SIMILAR_PRODUCTS"  # type: ignore[attr-defined]


def test_ranker_returning_more_than_limit_is_rejected() -> None:
    request = RecommendationRequest(mode="POPULAR_PRODUCTS", limit=1)
    with pytest.raises(InferenceOutputError):
        run_recommend(FakeRanker(items=ranked(0.7, 0.2)), request)
