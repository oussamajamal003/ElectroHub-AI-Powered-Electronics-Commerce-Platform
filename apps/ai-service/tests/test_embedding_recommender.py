"""Task 04.4 recommender: centroid/profile math, ranking contract, the request schema, registry readiness and the
recommendation service budget. Everything runs over FakeVectorReader; no database or network."""

from __future__ import annotations

import math
import uuid
from collections.abc import Callable
from typing import Any, TypeVar

import anyio
import pytest
from pydantic import ValidationError

from app.core.errors import InferenceOutputError, InferenceTimeoutError, ValidationFailedError
from app.integrations.pgvector_gateway import ProductVector, ScoredProduct
from app.integrations.vector_gateway import EmbeddingSearchGateway
from app.models.descriptor import ModelDescriptor
from app.models.embedding_recommender import ALGORITHM_VERSION, EmbeddingRecommender, select_ranked, unit
from app.models.registry import ModelRegistry
from app.processors.inference import InferenceExecutor
from app.schemas.common import FeatureName, FeatureStatus
from app.schemas.recommendations import (
    RecommendationRequest,
    RecommendationStrategy,
)
from app.services.recommendation_service import RecommendationService
from tests.conftest import make_settings
from tests.fakes import (
    DESCRIPTOR,
    PRODUCTS,
    ConfigurableRanker,
    CountingLoader,
    FakeEncoder,
    FakeGateway,
    FakeVectorReader,
    ranked,
)

T = TypeVar("T")

ANCHOR = uuid.UUID(int=101)
P1 = uuid.UUID(int=1)
P2 = uuid.UUID(int=2)
P3 = uuid.UUID(int=3)
X_AXIS = (1.0, 0.0, 0.0, 0.0)
Y_AXIS = (0.0, 1.0, 0.0, 0.0)


async def run_cpu(fn: Callable[[], T]) -> T:
    return fn()


def scored(product_id: uuid.UUID, vector: tuple[float, ...], score: float) -> ScoredProduct:
    return ScoredProduct(product_id=product_id, score=score, vector=vector)


def anchor_reader(*neighbours: ScoredProduct) -> FakeVectorReader:
    return FakeVectorReader(
        centroids={ANCHOR: ProductVector(vector=X_AXIS, image_count=2)}, neighbours=list(neighbours)
    )


def similar_request(**overrides: Any) -> RecommendationRequest:
    body: dict[str, Any] = {"mode": "SIMILAR_PRODUCTS", "productId": str(ANCHOR), "limit": 3}
    body.update(overrides)
    return RecommendationRequest.model_validate(body)


def profile_request(signals: list[tuple[uuid.UUID, float]], limit: int = 3) -> RecommendationRequest:
    return RecommendationRequest.model_validate(
        {
            "mode": "RECOMMENDED_FOR_YOU",
            "limit": limit,
            "context": {"profileSignals": [{"productId": str(p), "weight": w} for p, w in signals]},
        }
    )


def recommend(recommender: EmbeddingRecommender, request: RecommendationRequest) -> Any:
    return anyio.run(recommender.recommend, request, run_cpu)


# --- SIMILAR_PRODUCTS and YOU_MAY_ALSO_LIKE ------------------------------------------------------------------------


def test_similar_products_exclude_the_anchor_and_rank_with_non_increasing_scores() -> None:
    reader = anchor_reader(
        scored(P1, (0.9, 0.1, 0.0, 0.0), 0.9),
        scored(P2, Y_AXIS, 0.5),
        scored(P3, (0.0, 0.0, 1.0, 0.0), 0.2),
    )
    outcome = recommend(EmbeddingRecommender(descriptor=DESCRIPTOR, reader=reader), similar_request(limit=3))

    assert ANCHOR in reader.nearest_calls[0].exclude
    assert outcome.anchor_indexed is True
    assert [item.product_id for item in outcome.items] == [P1, P2, P3]
    assert [item.rank for item in outcome.items] == [1, 2, 3]
    scores = [item.score for item in outcome.items]
    assert scores == sorted(scores, reverse=True)
    assert outcome.algorithm_version == ALGORITHM_VERSION


def test_anchor_without_a_centroid_yields_no_items_and_is_reported_as_not_indexed() -> None:
    reader = FakeVectorReader(neighbours=[scored(P1, X_AXIS, 1.0)])
    outcome = recommend(EmbeddingRecommender(descriptor=DESCRIPTOR, reader=reader), similar_request())

    assert outcome.items == []
    assert outcome.anchor_indexed is False
    assert reader.nearest_calls == []


def test_you_may_also_like_excludes_the_anchor_and_the_already_shown_products() -> None:
    reader = anchor_reader(scored(P1, Y_AXIS, 0.4))
    request = RecommendationRequest.model_validate(
        {"mode": "YOU_MAY_ALSO_LIKE", "productId": str(ANCHOR), "excludeProductIds": [str(P3)], "limit": 2}
    )
    recommend(EmbeddingRecommender(descriptor=DESCRIPTOR, reader=reader), request)

    assert reader.nearest_calls[0].exclude == (ANCHOR, P3)


# --- RECOMMENDED_FOR_YOU --------------------------------------------------------------------------------------------


def test_profile_vector_is_the_normalised_weighted_sum_of_the_signal_centroids() -> None:
    reader = FakeVectorReader(
        centroids={
            P1: ProductVector(vector=X_AXIS, image_count=1),
            P2: ProductVector(vector=Y_AXIS, image_count=4),
        },
        neighbours=[scored(P3, (0.0, 0.0, 1.0, 0.0), 0.3)],
    )
    outcome = recommend(
        EmbeddingRecommender(descriptor=DESCRIPTOR, reader=reader),
        profile_request([(P1, 1.0), (P2, 0.5)]),
    )

    # (1, 0.5, 0, 0) normalised by sqrt(1.25).
    expected = [1.0 / math.sqrt(1.25), 0.5 / math.sqrt(1.25), 0.0, 0.0]
    assert reader.nearest_calls[0].vector == pytest.approx(expected)
    assert reader.centroid_calls[0][0] == (P1, P2)
    assert reader.nearest_calls[0].exclude == (P1, P2)
    assert outcome.anchor_indexed is True
    assert outcome.strategy is RecommendationStrategy.BEHAVIOR_EMBEDDING


def test_profile_products_without_current_centroids_are_reported_as_not_indexed() -> None:
    reader = FakeVectorReader(neighbours=[scored(P3, X_AXIS, 1.0)])
    outcome = recommend(EmbeddingRecommender(descriptor=DESCRIPTOR, reader=reader), profile_request([(P1, 1.0)]))

    assert outcome.items == []
    assert outcome.anchor_indexed is False
    assert outcome.strategy is RecommendationStrategy.BEHAVIOR_EMBEDDING
    assert reader.nearest_calls == []


# --- near-duplicate suppression -------------------------------------------------------------------------------------


def test_near_duplicate_candidates_keep_only_the_first_in_database_order() -> None:
    reader = anchor_reader(
        scored(P1, X_AXIS, 0.9),
        scored(P2, X_AXIS, 0.8),  # identical photography of a colour variant
        scored(P3, Y_AXIS, 0.7),
    )
    outcome = recommend(EmbeddingRecommender(descriptor=DESCRIPTOR, reader=reader), similar_request(limit=3))

    assert [item.product_id for item in outcome.items] == [P1, P3]
    assert [item.rank for item in outcome.items] == [1, 2]


def test_select_ranked_keeps_database_order_and_honours_the_limit() -> None:
    candidates = [scored(P1, X_AXIS, 0.9), scored(P2, Y_AXIS, 0.5), scored(P3, (0.0, 0.0, 1.0, 0.0), 0.1)]
    selected = select_ranked(candidates, limit=2)
    assert [item.product_id for item in selected] == [P1, P2]


# --- unit() ---------------------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "vector",
    [
        [],
        [0.0, 0.0, 0.0, 0.0],
        [math.nan, 0.0, 0.0, 0.0],
        [math.inf, 0.0, 0.0, 0.0],
    ],
)
def test_unit_is_none_for_empty_zero_or_non_finite_vectors(vector: list[float]) -> None:
    assert unit(vector) is None


def test_unit_normalises_to_length_one() -> None:
    result = unit([3.0, 4.0, 0.0, 0.0])
    assert result is not None
    assert result.tolist() == pytest.approx([0.6, 0.8, 0.0, 0.0])


# --- mode gating, strategy and pool sizing -------------------------------------------------------------------------


@pytest.mark.parametrize(
    "body",
    [
        {"mode": "FREQUENTLY_BOUGHT_TOGETHER", "productId": str(ANCHOR)},
        {"mode": "POPULAR_PRODUCTS"},
    ],
)
def test_order_and_popularity_modes_are_not_served_by_embeddings(body: dict[str, Any]) -> None:
    reader = anchor_reader(scored(P1, X_AXIS, 0.9))
    request = RecommendationRequest.model_validate(body)
    with pytest.raises(ValidationFailedError):
        recommend(EmbeddingRecommender(descriptor=DESCRIPTOR, reader=reader), request)
    assert reader.centroid_calls == [] and reader.nearest_calls == []


def test_strategies_are_behaviour_embedding_for_profiles_and_similarity_otherwise() -> None:
    reader = FakeVectorReader(
        centroids={
            P1: ProductVector(vector=X_AXIS, image_count=1),
            ANCHOR: ProductVector(vector=X_AXIS, image_count=1),
        },
        neighbours=[scored(P2, Y_AXIS, 0.5)],
    )
    recommender = EmbeddingRecommender(descriptor=DESCRIPTOR, reader=reader)
    rfy = recommend(recommender, profile_request([(P1, 1.0)]))
    similar = recommend(recommender, similar_request())
    also = recommend(
        recommender, RecommendationRequest.model_validate({"mode": "YOU_MAY_ALSO_LIKE", "productId": str(ANCHOR)})
    )

    assert rfy.strategy is RecommendationStrategy.BEHAVIOR_EMBEDDING
    assert similar.strategy is RecommendationStrategy.EMBEDDING_SIMILARITY
    assert also.strategy is RecommendationStrategy.EMBEDDING_SIMILARITY


@pytest.mark.parametrize(("limit", "expected_top_k"), [(1, 3), (5, 15), (100, 200)])
def test_retrieval_pool_is_three_times_the_limit_capped_at_the_lookup_bound(limit: int, expected_top_k: int) -> None:
    reader = anchor_reader(scored(P1, Y_AXIS, 0.5))
    recommend(EmbeddingRecommender(descriptor=DESCRIPTOR, reader=reader), similar_request(limit=limit))
    assert reader.nearest_calls[0].top_k == expected_top_k


def test_candidate_ids_restrict_retrieval_and_the_active_descriptor_is_used() -> None:
    reader = anchor_reader(scored(P1, Y_AXIS, 0.5))
    recommend(
        EmbeddingRecommender(descriptor=DESCRIPTOR, reader=reader),
        similar_request(candidateProductIds=[str(P1), str(P2)]),
    )
    call = reader.nearest_calls[0]
    assert call.restrict_to == (P1, P2)
    assert call.descriptor == DESCRIPTOR
    assert len(call.vector) == DESCRIPTOR.embedding_dimension


def test_returned_items_are_never_more_than_the_limit_and_scores_stay_bounded() -> None:
    reader = anchor_reader(*(scored(PRODUCTS[i], (float(i), 1.0, 0.0, 0.0), 1.0 - i / 10) for i in range(4)))
    outcome = recommend(EmbeddingRecommender(descriptor=DESCRIPTOR, reader=reader), similar_request(limit=2))
    assert len(outcome.items) <= 2
    assert all(-1.0 <= item.score <= 1.0 for item in outcome.items)


# --- request schema -------------------------------------------------------------------------------------------------


def test_recommended_for_you_requires_profile_signals() -> None:
    with pytest.raises(ValidationError):
        RecommendationRequest.model_validate({"mode": "RECOMMENDED_FOR_YOU"})
    with pytest.raises(ValidationError):
        RecommendationRequest.model_validate({"mode": "RECOMMENDED_FOR_YOU", "context": {"profileSignals": []}})


def test_profile_signals_are_rejected_for_product_anchored_modes() -> None:
    with pytest.raises(ValidationError):
        RecommendationRequest.model_validate(
            {
                "mode": "SIMILAR_PRODUCTS",
                "productId": str(ANCHOR),
                "context": {"profileSignals": [{"productId": str(P1), "weight": 0.5}]},
            }
        )


def test_duplicate_profile_signal_products_are_rejected() -> None:
    with pytest.raises(ValidationError):
        profile_request([(P1, 1.0), (P1, 0.5)])


@pytest.mark.parametrize("weight", [0.0, -0.1, 1.5, math.nan, math.inf])
def test_profile_weights_must_be_finite_and_within_zero_exclusive_to_one(weight: float) -> None:
    with pytest.raises(ValidationError):
        profile_request([(P1, weight)])


def test_unknown_feature_spec_version_is_rejected() -> None:
    with pytest.raises(ValidationError):
        RecommendationRequest.model_validate(
            {
                "mode": "RECOMMENDED_FOR_YOU",
                "context": {
                    "profileSignals": [{"productId": str(P1), "weight": 1.0}],
                    "featureSpecVersion": "profile-v2",
                },
            }
        )


def test_duplicate_excluded_products_are_rejected() -> None:
    with pytest.raises(ValidationError):
        similar_request(excludeProductIds=[str(P1), str(P1)])


def test_more_than_one_hundred_excluded_products_are_rejected() -> None:
    with pytest.raises(ValidationError):
        similar_request(excludeProductIds=[str(uuid.UUID(int=i)) for i in range(1, 102)])


def test_valid_camel_case_json_parses_into_the_contract() -> None:
    request = RecommendationRequest.model_validate(
        {
            "mode": "SIMILAR_PRODUCTS",
            "productId": str(ANCHOR),
            "candidateProductIds": [str(P1), str(P2)],
            "excludeProductIds": [str(P3)],
            "limit": 5,
        }
    )
    assert request.product_id == ANCHOR
    assert request.candidate_product_ids == [P1, P2]
    assert request.exclude_product_ids == [P3]
    assert request.limit == 5
    assert request.context is None


def test_valid_profile_json_parses_with_default_feature_spec() -> None:
    request = profile_request([(P1, 1.0), (P2, 0.25)])
    assert request.context is not None
    assert request.context.feature_spec_version == "profile-v1"
    assert [signal.weight for signal in request.context.profile_signals] == [1.0, 0.25]


# --- registry readiness ---------------------------------------------------------------------------------------------


def _vector_factory(descriptor: ModelDescriptor, _gateway: EmbeddingSearchGateway) -> EmbeddingRecommender:
    return EmbeddingRecommender(descriptor=descriptor, reader=FakeVectorReader())


def _broken_factory(descriptor: ModelDescriptor, _gateway: EmbeddingSearchGateway) -> EmbeddingRecommender:
    raise RuntimeError("index metadata unreadable")


def _started_status(registry: ModelRegistry, feature: FeatureName) -> FeatureStatus:
    async def main() -> FeatureStatus:
        await registry.start()
        try:
            return registry.feature_status(feature)
        finally:
            await registry.stop()

    return anyio.run(main)


def test_recommendations_are_ready_when_the_index_is_ready() -> None:
    registry = ModelRegistry(
        image_encoder_loader=CountingLoader(FakeEncoder()),
        vector_gateway=FakeGateway(ready=True),
        recommender_factory=_vector_factory,
    )
    status = _started_status(registry, "recommendations")
    assert status.available is True
    assert status.status == "READY" and status.reason is None
    assert status.model_version == "test-model-1"
    assert status.embedding_version == "test-emb-1"


def test_recommendations_stay_loaded_but_not_ready_when_the_index_is_not_ready() -> None:
    registry = ModelRegistry(
        image_encoder_loader=CountingLoader(FakeEncoder()),
        vector_gateway=FakeGateway(ready=False),
        recommender_factory=_vector_factory,
    )

    async def main() -> tuple[FeatureStatus, bool]:
        await registry.start()
        try:
            return registry.feature_status("recommendations"), registry.ranker is not None
        finally:
            await registry.stop()

    status, still_loaded = anyio.run(main)
    assert still_loaded is True
    assert status.available is False
    assert status.status == "NOT_READY" and status.reason == "INDEX_NOT_READY"


def test_a_failing_recommender_factory_reports_model_not_loaded() -> None:
    registry = ModelRegistry(
        image_encoder_loader=CountingLoader(FakeEncoder()),
        vector_gateway=FakeGateway(ready=True),
        recommender_factory=_broken_factory,
    )
    status = _started_status(registry, "recommendations")
    assert status.available is False
    assert status.reason == "MODEL_NOT_LOADED"
    assert status.model_version is None


def test_without_a_factory_or_ranker_loader_recommendations_are_not_configured() -> None:
    registry = ModelRegistry(image_encoder_loader=CountingLoader(FakeEncoder()), vector_gateway=FakeGateway(ready=True))
    status = _started_status(registry, "recommendations")
    assert status.available is False
    assert status.reason == "MODEL_NOT_CONFIGURED"


# --- recommendation service -----------------------------------------------------------------------------------------


def _service_result(ranker: ConfigurableRanker, request: RecommendationRequest, **settings: Any) -> Any:
    registry = ModelRegistry(ranker_loader=CountingLoader(ranker))
    service = RecommendationService(
        registry, InferenceExecutor(max_concurrency=1, timeout_seconds=2), make_settings(**settings)
    )

    async def main() -> Any:
        await registry.start()
        try:
            return await service.recommend(request)
        finally:
            await registry.stop()

    return anyio.run(main)


def test_service_returns_the_outcome_identity_with_the_ranker_descriptor_versions() -> None:
    ranker = ConfigurableRanker(
        items=ranked(0.7, 0.2),
        strategy=RecommendationStrategy.BEHAVIOR_EMBEDDING,
        algorithm_version="custom-v9",
        anchor_indexed=False,
    )
    result = _service_result(ranker, similar_request(limit=2))

    assert result.mode == "SIMILAR_PRODUCTS"
    assert result.strategy == RecommendationStrategy.BEHAVIOR_EMBEDDING
    assert result.algorithm_version == "custom-v9"
    assert result.anchor_indexed is False
    assert result.model_version == DESCRIPTOR.model_version
    assert result.embedding_version == DESCRIPTOR.embedding_version
    assert [item.rank for item in result.items] == [1, 2]


def test_a_ranker_slower_than_the_inference_budget_raises_timeout() -> None:
    ranker = ConfigurableRanker(items=ranked(0.7), delay_seconds=1.0)
    with pytest.raises(InferenceTimeoutError):
        _service_result(ranker, similar_request(limit=1), AI_INFERENCE_TIMEOUT_SECONDS=0.1)


def test_a_ranker_returning_more_items_than_the_limit_is_an_output_error() -> None:
    ranker = ConfigurableRanker(items=ranked(0.7, 0.2))
    with pytest.raises(InferenceOutputError):
        _service_result(ranker, similar_request(limit=1))
