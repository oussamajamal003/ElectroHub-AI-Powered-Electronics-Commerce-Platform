"""Deterministic test doubles for the model/index seams. Test-only: the service ships none."""

from __future__ import annotations

import threading
import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

import anyio

from app.integrations.pgvector_gateway import ProductVector, ScoredProduct
from app.models.descriptor import ModelDescriptor
from app.models.interfaces import CpuRunner, RecommendationOutcome
from app.processors.image import ValidatedImage
from app.schemas.common import RankedProduct
from app.schemas.recommendations import RecommendationRequest, RecommendationStrategy

DESCRIPTOR = ModelDescriptor(
    name="test-encoder",
    model_version="test-model-1",
    embedding_version="test-emb-1",
    preprocess_version="test-pre-1",
    embedding_dimension=4,
    artifact_format="safetensors",
    artifact_sha256="0" * 64,
)

PRODUCTS = [uuid.UUID(int=i) for i in range(1, 6)]


@dataclass
class FakeEncoder:
    vector: Sequence[float] = (1.0, 0.0, 0.0, 0.0)
    descriptor: ModelDescriptor = DESCRIPTOR
    closed: bool = False
    encode_threads: list[int] = field(default_factory=list)

    def encode(self, image: ValidatedImage) -> Sequence[float]:
        self.encode_threads.append(threading.get_ident())
        return self.vector

    def close(self) -> None:
        self.closed = True


@dataclass
class FakeRanker:
    items: Sequence[RankedProduct] = ()
    descriptor: ModelDescriptor = DESCRIPTOR
    closed: bool = False

    async def recommend(self, request: RecommendationRequest, run_cpu: CpuRunner) -> RecommendationOutcome:
        return RecommendationOutcome(
            items=self.items,
            strategy=RecommendationStrategy.EMBEDDING_SIMILARITY,
            algorithm_version="fake-ranker",
            anchor_indexed=True,
        )

    def close(self) -> None:
        self.closed = True


@dataclass
class FakeGateway:
    ready: bool = True
    results: Sequence[RankedProduct] = ()
    closed: bool = False
    queried_with: list[ModelDescriptor] = field(default_factory=list)

    async def is_ready(self, descriptor: ModelDescriptor) -> bool:
        return self.ready

    async def nearest(
        self, vector: Sequence[float], *, top_k: int, descriptor: ModelDescriptor
    ) -> Sequence[RankedProduct]:
        self.queried_with.append(descriptor)
        return self.results

    async def close(self) -> None:
        self.closed = True


def ranked(*scores: float, ids: Sequence[uuid.UUID] = PRODUCTS) -> list[RankedProduct]:
    return [RankedProduct(product_id=ids[i], score=score, rank=i + 1) for i, score in enumerate(scores)]


class CountingLoader:
    def __init__(self, model: object) -> None:
        self.model = model
        self.calls = 0
        self.threads: list[int] = []

    def __call__(self) -> Any:
        self.calls += 1
        self.threads.append(threading.get_ident())
        return self.model


@dataclass
class ConfigurableRanker:
    """Ranker whose outcome and latency are set by the test (service-level timeout and identity checks)."""

    items: Sequence[RankedProduct] = ()
    strategy: RecommendationStrategy = RecommendationStrategy.EMBEDDING_SIMILARITY
    algorithm_version: str = "configurable-ranker"
    anchor_indexed: bool = True
    delay_seconds: float = 0.0
    descriptor: ModelDescriptor = DESCRIPTOR
    closed: bool = False

    async def recommend(self, request: RecommendationRequest, run_cpu: CpuRunner) -> RecommendationOutcome:
        if self.delay_seconds > 0:
            await anyio.sleep(self.delay_seconds)
        return RecommendationOutcome(
            items=self.items,
            strategy=self.strategy,
            algorithm_version=self.algorithm_version,
            anchor_indexed=self.anchor_indexed,
        )

    def close(self) -> None:
        self.closed = True


@dataclass(frozen=True)
class NearestCall:
    vector: tuple[float, ...]
    top_k: int
    descriptor: ModelDescriptor
    exclude: tuple[uuid.UUID, ...]
    restrict_to: tuple[uuid.UUID, ...]


@dataclass
class FakeVectorReader:
    """In-memory stand-in for the pgvector product reads used by EmbeddingRecommender. Records every call.

    ``neighbours`` is returned as configured: exclusion and restriction are the database's job and are asserted
    through the recorded call arguments instead.
    """

    centroids: dict[uuid.UUID, ProductVector] = field(default_factory=dict)
    neighbours: list[ScoredProduct] = field(default_factory=list)
    centroid_calls: list[tuple[tuple[uuid.UUID, ...], ModelDescriptor]] = field(default_factory=list)
    nearest_calls: list[NearestCall] = field(default_factory=list)

    async def product_centroids(
        self, product_ids: Sequence[uuid.UUID], *, descriptor: ModelDescriptor
    ) -> dict[uuid.UUID, ProductVector]:
        ids = tuple(product_ids)
        self.centroid_calls.append((ids, descriptor))
        return {product_id: self.centroids[product_id] for product_id in ids if product_id in self.centroids}

    async def nearest_products(
        self,
        vector: Sequence[float],
        *,
        top_k: int,
        descriptor: ModelDescriptor,
        exclude: Sequence[uuid.UUID] = (),
        restrict_to: Sequence[uuid.UUID] = (),
    ) -> list[ScoredProduct]:
        self.nearest_calls.append(
            NearestCall(
                vector=tuple(vector),
                top_k=top_k,
                descriptor=descriptor,
                exclude=tuple(exclude),
                restrict_to=tuple(restrict_to),
            )
        )
        return list(self.neighbours)
