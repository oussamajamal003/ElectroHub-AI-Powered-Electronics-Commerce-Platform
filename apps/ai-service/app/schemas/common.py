"""Shared wire contracts. JSON is camelCase; Python attributes are snake_case."""

from __future__ import annotations

from typing import Annotated, Generic, Literal, TypeVar
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from pydantic.alias_generators import to_camel

VersionStr = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9._-]{1,64}$")]
FeatureName = Literal["imageSearch", "recommendations"]
FeatureState = Literal["READY", "NOT_READY"]
NotReadyReason = Literal["MODEL_NOT_CONFIGURED", "MODEL_NOT_LOADED", "INDEX_NOT_READY"]

T = TypeVar("T")


class ContractModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
        frozen=True,
        protected_namespaces=(),
    )


class DataEnvelope(ContractModel, Generic[T]):
    data: T


class RankedProduct(ContractModel):
    """One product reference. The score is an uncalibrated similarity, not a probability;
    Express re-validates the product against the catalog before showing anything."""

    product_id: UUID
    score: float = Field(ge=-1.0, le=1.0, allow_inf_nan=False)
    rank: int = Field(ge=1)


def validate_ranked(items: list[RankedProduct]) -> list[RankedProduct]:
    """Unique products, contiguous ranks 1..n and non-increasing scores."""
    seen: set[UUID] = set()
    previous_score = float("inf")
    for position, item in enumerate(items, start=1):
        if item.product_id in seen:
            raise ValueError("duplicate productId in ranked results")
        if item.rank != position:
            raise ValueError("ranks must be contiguous starting at 1")
        if item.score > previous_score:
            raise ValueError("scores must be non-increasing by rank")
        seen.add(item.product_id)
        previous_score = item.score
    return items


class FeatureStatus(ContractModel):
    available: bool
    status: FeatureState
    reason: NotReadyReason | None
    model_version: VersionStr | None
    embedding_version: VersionStr | None


class Features(ContractModel):
    image_search: FeatureStatus
    recommendations: FeatureStatus


class Readiness(ContractModel):
    status: Literal["ready"]
    service: str
    environment: str
    api_version: str
    model_ready: bool
    features: Features


class Limits(ContractModel):
    max_request_bytes: int
    max_top_k: int
    max_candidates: int
    inference_timeout_ms: int
    max_concurrent_inferences: int


class ImageSearchCapabilities(ContractModel):
    """Public upload contract and active-version identity. No paths, credentials or index internals."""

    accepted_content_types: list[str]
    max_image_bytes: int
    max_image_pixels: int
    max_top_k: int
    model_version: VersionStr | None
    embedding_version: VersionStr | None


class Capabilities(ContractModel):
    service: str
    environment: str
    api_version: str
    service_version: str
    features: Features
    limits: Limits
    image_search: ImageSearchCapabilities


class Health(BaseModel):
    """Public liveness. Kept flat for compatibility with the pre-04.1 contract."""

    status: Literal["healthy"]
    service: str
    timestamp: str
    environment: str
    version: str


class ErrorDetail(BaseModel):
    loc: list[str]
    type: str


class ErrorBody(BaseModel):
    code: str
    message: str
    request_id: str = Field(alias="requestId")
    details: list[ErrorDetail] | None = None


class ErrorEnvelope(BaseModel):
    error: ErrorBody
