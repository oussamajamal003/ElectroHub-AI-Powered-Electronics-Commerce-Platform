"""Interfaces a real model must satisfy (04.2 image encoder, 04.4 recommender).

With no artifact or index the service reports the features as not ready instead of simulating results (U07).
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from typing import Protocol, TypeVar, runtime_checkable

from app.models.descriptor import ModelDescriptor
from app.processors.image import ValidatedImage
from app.schemas.common import RankedProduct
from app.schemas.recommendations import RecommendationRequest, RecommendationStrategy

T = TypeVar("T")


@runtime_checkable
class LoadedModel(Protocol):
    @property
    def descriptor(self) -> ModelDescriptor: ...

    def close(self) -> None:
        """Release weights/sessions. Called once on shutdown."""


@runtime_checkable
class ImageEmbeddingEncoder(LoadedModel, Protocol):
    def encode(self, image: ValidatedImage) -> Sequence[float]:
        """CPU/GPU-bound: return one L2-normalized vector of ``descriptor.embedding_dimension``.

        Runs in a worker thread via ``InferenceExecutor``; never touches products, users or payments.
        """
        ...


@dataclass(frozen=True)
class RecommendationOutcome:
    items: Sequence[RankedProduct]
    strategy: RecommendationStrategy
    algorithm_version: str
    anchor_indexed: bool


class CpuRunner(Protocol):
    """Runs bounded CPU work off the event loop (``InferenceExecutor.run``)."""

    def __call__(self, fn: Callable[[], T]) -> Awaitable[T]: ...


@runtime_checkable
class RecommendationRanker(LoadedModel, Protocol):
    async def recommend(
        self,
        request: RecommendationRequest,
        run_cpu: CpuRunner,
    ) -> RecommendationOutcome:
        """Ranked product references. Vector retrieval is async I/O; any scoring math goes through ``run_cpu`` so
        the event loop is never blocked. Scores are similarities, not probabilities."""
        ...


class ModelLoader(Protocol):
    """Loads one artifact synchronously (run off the event loop at startup).

    Implementations must verify ``artifact_sha256`` before deserializing and must only accept
    the formats in ``ArtifactFormat``.
    """

    def __call__(self) -> LoadedModel: ...
