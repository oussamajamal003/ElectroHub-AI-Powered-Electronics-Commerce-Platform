"""Interfaces a real trained model must satisfy (implemented in 04.2 / 04.4).

Nothing in Task 04.1 implements these outside tests: with no artifact loaded the service
reports the features as not ready instead of simulating results (U07).
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol, runtime_checkable

from app.models.descriptor import ModelDescriptor
from app.processors.image import ValidatedImage
from app.schemas.common import RankedProduct
from app.schemas.recommendations import RecommendationRequest


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


@runtime_checkable
class RecommendationRanker(LoadedModel, Protocol):
    def rank(self, request: RecommendationRequest) -> Sequence[RankedProduct]:
        """CPU-bound ranking of product references; scores are similarities, not probabilities."""
        ...


class ModelLoader(Protocol):
    """Loads one artifact synchronously (run off the event loop at startup).

    Implementations must verify ``artifact_sha256`` before deserializing and must only accept
    the formats in ``ArtifactFormat``.
    """

    def __call__(self) -> LoadedModel: ...
