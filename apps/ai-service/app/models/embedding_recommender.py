"""Task 04.4 recommender over the active D3 (SigLIP2) learned image-embedding index.

No second model artifact exists or is claimed: the learned part is the D3 encoder that produced the product vectors
(Task 04.2/04.3). This adapter uses that encoder's exact descriptor, so it can only read vectors of the active space,
and every query re-checks the active identity in the same snapshot as the vectors it scores.

* Product representation: mean of the product's current eligible unit image vectors (pgvector ``avg``), so neither a
  product's photo count nor a retired/stale image changes how it is represented.
* SIMILAR_PRODUCTS: nearest product centroids to the anchor centroid.
* YOU_MAY_ALSO_LIKE: the same learned space, excluding what Express already shows as Similar, from a deeper pool
  (Express adds the contextual part: category diversity and co-purchase evidence).
* RECOMMENDED_FOR_YOU: a profile vector = normalised weighted sum of the centroids of products the customer
  interacted with (weights computed by Express from authorized activity), then nearest centroids, excluding those
  products.

Near-duplicate suppression drops a candidate whose centroid is practically identical to one already selected
(identical photography of colour variants), which keeps results useful while scores stay non-increasing.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final, Protocol
from uuid import UUID

import numpy as np
import numpy.typing as npt

from app.core.errors import ValidationFailedError
from app.integrations.pgvector_gateway import MAX_PRODUCT_LOOKUP, ProductVector, ScoredProduct
from app.models.descriptor import ModelDescriptor
from app.models.interfaces import CpuRunner, RecommendationOutcome
from app.schemas.common import RankedProduct
from app.schemas.recommendations import (
    EMBEDDING_MODES,
    RecommendationMode,
    RecommendationRequest,
    RecommendationStrategy,
)

ALGORITHM_VERSION: Final = "d3-centroid-v1"
NEAR_DUPLICATE_COSINE: Final = 0.995
# Candidates retrieved per requested result: room for Express to drop hidden/out-of-catalog products and for
# near-duplicate suppression without a second round trip.
POOL_FACTOR: Final = 3

FloatArray = npt.NDArray[np.float64]


class RecommendationVectorReader(Protocol):
    async def product_centroids(
        self, product_ids: Sequence[UUID], *, descriptor: ModelDescriptor
    ) -> dict[UUID, ProductVector]: ...

    async def nearest_products(
        self,
        vector: Sequence[float],
        *,
        top_k: int,
        descriptor: ModelDescriptor,
        exclude: Sequence[UUID] = (),
        restrict_to: Sequence[UUID] = (),
    ) -> list[ScoredProduct]: ...


@dataclass(frozen=True)
class _Query:
    vector: tuple[float, ...]
    exclude: tuple[UUID, ...]
    strategy: RecommendationStrategy


def unit(vector: Sequence[float]) -> FloatArray | None:
    """L2-normalised copy, or ``None`` for an empty, zero or non-finite vector."""
    array = np.asarray(vector, dtype=np.float64)
    if array.size == 0 or not np.all(np.isfinite(array)):
        return None
    norm = float(np.linalg.norm(array))
    if norm <= 1e-12:
        return None
    normalised: FloatArray = array / norm
    return normalised


def profile_vector(
    centroids: dict[UUID, ProductVector], weights: Sequence[tuple[UUID, float]]
) -> tuple[float, ...] | None:
    """Normalised weighted sum of unit product centroids; products without a current vector contribute nothing."""
    total: FloatArray | None = None
    for product_id, weight in weights:
        entry = centroids.get(product_id)
        if entry is None:
            continue
        vector = unit(entry.vector)
        if vector is None:
            continue
        total = vector * weight if total is None else total + vector * weight
    if total is None:
        return None
    result = unit(total.tolist())
    return None if result is None else tuple(result.tolist())


def select_ranked(candidates: Sequence[ScoredProduct], limit: int) -> list[RankedProduct]:
    """Keeps database order (similarity desc, product id asc), skips near-duplicates of already selected items."""
    selected: list[RankedProduct] = []
    kept: list[FloatArray] = []
    for candidate in candidates:
        if len(selected) >= limit:
            break
        vector = unit(candidate.vector)
        if vector is None:
            continue
        if any(float(vector @ other) >= NEAR_DUPLICATE_COSINE for other in kept):
            continue
        kept.append(vector)
        selected.append(RankedProduct(product_id=candidate.product_id, score=candidate.score, rank=len(selected) + 1))
    return selected


class EmbeddingRecommender:
    def __init__(self, *, descriptor: ModelDescriptor, reader: RecommendationVectorReader) -> None:
        self._descriptor = descriptor
        self._reader = reader

    @property
    def descriptor(self) -> ModelDescriptor:
        return self._descriptor

    def close(self) -> None:
        """Holds no weights or connections of its own (the gateway is closed by the registry)."""

    async def recommend(self, request: RecommendationRequest, run_cpu: CpuRunner) -> RecommendationOutcome:
        if request.mode not in EMBEDDING_MODES:
            raise ValidationFailedError(f"{request.mode.value} is served from order and activity data, not embeddings.")
        query = await self._query(request, run_cpu)
        if query is None:
            return RecommendationOutcome(
                items=[],
                strategy=_strategy(request.mode),
                algorithm_version=ALGORITHM_VERSION,
                anchor_indexed=False,
            )
        pool = min(MAX_PRODUCT_LOOKUP, max(request.limit, request.limit * POOL_FACTOR))
        candidates = await self._reader.nearest_products(
            query.vector,
            top_k=pool,
            descriptor=self._descriptor,
            exclude=query.exclude,
            restrict_to=request.candidate_product_ids,
        )
        items = await run_cpu(lambda: select_ranked(candidates, request.limit))
        return RecommendationOutcome(
            items=items,
            strategy=query.strategy,
            algorithm_version=ALGORITHM_VERSION,
            anchor_indexed=True,
        )

    async def _query(self, request: RecommendationRequest, run_cpu: CpuRunner) -> _Query | None:
        excluded = list(request.exclude_product_ids)
        if request.mode is RecommendationMode.RECOMMENDED_FOR_YOU:
            signals = request.context.profile_signals if request.context else []
            ids = [signal.product_id for signal in signals]
            centroids = await self._reader.product_centroids(ids, descriptor=self._descriptor)
            weights = [(signal.product_id, signal.weight) for signal in signals]
            vector = await run_cpu(lambda: profile_vector(centroids, weights))
            if vector is None:
                return None
            return _Query(vector, _dedupe([*excluded, *ids]), RecommendationStrategy.BEHAVIOR_EMBEDDING)

        anchor = request.product_id
        if anchor is None:  # Guarded by the request model; kept for type narrowing.
            raise ValidationFailedError("productId is required.")
        centroids = await self._reader.product_centroids([anchor], descriptor=self._descriptor)
        entry = centroids.get(anchor)
        normalised = unit(entry.vector) if entry is not None else None
        if normalised is None:
            return None
        return _Query(tuple(normalised.tolist()), _dedupe([anchor, *excluded]), _strategy(request.mode))


def _strategy(mode: RecommendationMode) -> RecommendationStrategy:
    if mode is RecommendationMode.RECOMMENDED_FOR_YOU:
        return RecommendationStrategy.BEHAVIOR_EMBEDDING
    return RecommendationStrategy.EMBEDDING_SIMILARITY


def _dedupe(ids: Sequence[UUID]) -> tuple[UUID, ...]:
    return tuple(dict.fromkeys(ids))
