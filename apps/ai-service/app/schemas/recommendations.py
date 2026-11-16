"""Recommendation contract (Task 04.4: served by the D3 embedding recommender)."""

from __future__ import annotations

from enum import StrEnum
from uuid import UUID

from pydantic import Field, StrictInt, field_validator, model_validator

from app.schemas.common import ContractModel, RankedProduct, VersionStr, validate_ranked

# Static ceilings; the configured AI_MAX_* limits are enforced on top of these by the service.
HARD_MAX_CANDIDATES = 1000
HARD_MAX_LIMIT = 100
MAX_EXCLUDED_PRODUCTS = 100
MAX_PROFILE_SIGNALS = 50
PROFILE_FEATURE_SPEC_VERSION = "profile-v1"


class RecommendationMode(StrEnum):
    SIMILAR_PRODUCTS = "SIMILAR_PRODUCTS"
    YOU_MAY_ALSO_LIKE = "YOU_MAY_ALSO_LIKE"
    RECOMMENDED_FOR_YOU = "RECOMMENDED_FOR_YOU"
    FREQUENTLY_BOUGHT_TOGETHER = "FREQUENTLY_BOUGHT_TOGETHER"
    POPULAR_PRODUCTS = "POPULAR_PRODUCTS"


class RecommendationStrategy(StrEnum):
    """How a result was produced. Both are learned-embedding retrieval over the active D3 index."""

    EMBEDDING_SIMILARITY = "EMBEDDING_SIMILARITY"
    BEHAVIOR_EMBEDDING = "BEHAVIOR_EMBEDDING"


PRODUCT_ANCHORED_MODES = frozenset(
    {
        RecommendationMode.SIMILAR_PRODUCTS,
        RecommendationMode.YOU_MAY_ALSO_LIKE,
        RecommendationMode.FREQUENTLY_BOUGHT_TOGETHER,
    }
)
# Co-purchase and popularity are order/activity aggregates owned by Express; no neural ranker is claimed for them.
EMBEDDING_MODES = frozenset(
    {
        RecommendationMode.SIMILAR_PRODUCTS,
        RecommendationMode.YOU_MAY_ALSO_LIKE,
        RecommendationMode.RECOMMENDED_FOR_YOU,
    }
)


class ProfileSignal(ContractModel):
    """One product the customer interacted with and its relative weight. Express derives both from authorized
    activity; FastAPI never sees who the customer is or what the raw events were."""

    product_id: UUID
    weight: float = Field(gt=0.0, le=1.0, allow_inf_nan=False)


class RecommendationContext(ContractModel):
    profile_signals: list[ProfileSignal] = Field(default_factory=list, max_length=MAX_PROFILE_SIGNALS)
    feature_spec_version: VersionStr = PROFILE_FEATURE_SPEC_VERSION

    @field_validator("profile_signals")
    @classmethod
    def _unique_signals(cls, value: list[ProfileSignal]) -> list[ProfileSignal]:
        if len({signal.product_id for signal in value}) != len(value):
            raise ValueError("profileSignals must reference unique products")
        return value

    @field_validator("feature_spec_version")
    @classmethod
    def _known_spec(cls, value: str) -> str:
        if value != PROFILE_FEATURE_SPEC_VERSION:
            raise ValueError("unsupported featureSpecVersion")
        return value


class RecommendationRequest(ContractModel):
    """Bounded context only: no customer identity, addresses, JWTs or raw behaviour logs."""

    mode: RecommendationMode
    product_id: UUID | None = None
    candidate_product_ids: list[UUID] = Field(default_factory=list, max_length=HARD_MAX_CANDIDATES)
    exclude_product_ids: list[UUID] = Field(default_factory=list, max_length=MAX_EXCLUDED_PRODUCTS)
    limit: StrictInt = Field(default=12, ge=1, le=HARD_MAX_LIMIT)
    context: RecommendationContext | None = None

    @field_validator("candidate_product_ids", "exclude_product_ids")
    @classmethod
    def _unique_ids(cls, value: list[UUID]) -> list[UUID]:
        if len(set(value)) != len(value):
            raise ValueError("product id lists must be unique")
        return value

    @model_validator(mode="after")
    def _anchor_required(self) -> RecommendationRequest:
        if self.mode in PRODUCT_ANCHORED_MODES and self.product_id is None:
            raise ValueError(f"productId is required for {self.mode.value}")
        signals = self.context.profile_signals if self.context else []
        if self.mode is RecommendationMode.RECOMMENDED_FOR_YOU and not signals:
            raise ValueError("context.profileSignals is required for RECOMMENDED_FOR_YOU")
        if self.mode is not RecommendationMode.RECOMMENDED_FOR_YOU and signals:
            raise ValueError("context.profileSignals is only accepted for RECOMMENDED_FOR_YOU")
        return self


class RecommendationResult(ContractModel):
    mode: RecommendationMode
    items: list[RankedProduct] = Field(max_length=HARD_MAX_LIMIT)
    model_version: VersionStr
    embedding_version: VersionStr
    strategy: RecommendationStrategy
    algorithm_version: VersionStr
    # False when the anchor (or every profile product) has no current eligible vector: an empty list then means
    # "no learned representation", not "no similar products".
    anchor_indexed: bool

    @field_validator("items")
    @classmethod
    def _ranked(cls, value: list[RankedProduct]) -> list[RankedProduct]:
        return validate_ranked(value)
