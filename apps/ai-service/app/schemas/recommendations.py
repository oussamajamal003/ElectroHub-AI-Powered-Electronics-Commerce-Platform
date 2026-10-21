"""Recommendation contract (served by a real ranker in 04.4; not ready in 04.1)."""

from __future__ import annotations

from enum import StrEnum
from uuid import UUID

from pydantic import Field, StrictInt, field_validator, model_validator

from app.schemas.common import ContractModel, RankedProduct, VersionStr, validate_ranked

# Static ceilings; the configured AI_MAX_* limits are enforced on top of these by the service.
HARD_MAX_CANDIDATES = 1000
HARD_MAX_LIMIT = 100


class RecommendationMode(StrEnum):
    SIMILAR_PRODUCTS = "SIMILAR_PRODUCTS"
    YOU_MAY_ALSO_LIKE = "YOU_MAY_ALSO_LIKE"
    RECOMMENDED_FOR_YOU = "RECOMMENDED_FOR_YOU"
    FREQUENTLY_BOUGHT_TOGETHER = "FREQUENTLY_BOUGHT_TOGETHER"
    POPULAR_PRODUCTS = "POPULAR_PRODUCTS"


PRODUCT_ANCHORED_MODES = frozenset(
    {
        RecommendationMode.SIMILAR_PRODUCTS,
        RecommendationMode.YOU_MAY_ALSO_LIKE,
        RecommendationMode.FREQUENTLY_BOUGHT_TOGETHER,
    }
)


class RecommendationRequest(ContractModel):
    """Bounded context only: no customer identity, addresses, JWTs or raw behaviour logs."""

    mode: RecommendationMode
    product_id: UUID | None = None
    candidate_product_ids: list[UUID] = Field(default_factory=list, max_length=HARD_MAX_CANDIDATES)
    limit: StrictInt = Field(default=12, ge=1, le=HARD_MAX_LIMIT)

    @field_validator("candidate_product_ids")
    @classmethod
    def _unique_candidates(cls, value: list[UUID]) -> list[UUID]:
        if len(set(value)) != len(value):
            raise ValueError("candidateProductIds must be unique")
        return value

    @model_validator(mode="after")
    def _anchor_required(self) -> RecommendationRequest:
        if self.mode in PRODUCT_ANCHORED_MODES and self.product_id is None:
            raise ValueError(f"productId is required for {self.mode.value}")
        return self


class RecommendationResult(ContractModel):
    mode: RecommendationMode
    items: list[RankedProduct] = Field(max_length=HARD_MAX_LIMIT)
    model_version: VersionStr
    embedding_version: VersionStr

    @field_validator("items")
    @classmethod
    def _ranked(cls, value: list[RankedProduct]) -> list[RankedProduct]:
        return validate_ranked(value)
