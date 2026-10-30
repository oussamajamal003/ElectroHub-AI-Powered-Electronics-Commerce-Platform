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

import time
from collections.abc import Sequence
from typing import Final, Protocol
from uuid import UUID

import numpy as np
import numpy.typing as npt

from app.core.errors import ValidationFailedError
from app.core.logging import log_event
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
    async def recommendation_candidates(
        self,
        *,
        anchor_product_id: UUID | None,
        profile_signals: Sequence[tuple[UUID, float]],
        top_k: int,
        descriptor: ModelDescriptor,
        exclude: Sequence[UUID] = (),
        restrict_to: Sequence[UUID] = (),
    ) -> tuple[bool, list[ScoredProduct]]: ...


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
        profile_mode = request.mode is RecommendationMode.RECOMMENDED_FOR_YOU
        signals = request.context.profile_signals if profile_mode and request.context else []
        anchor = None if profile_mode else request.product_id
        signal_weights = [(signal.product_id, signal.weight) for signal in signals]
        exclude = ([anchor] if anchor is not None else [])
        exclude.extend(request.exclude_product_ids)
        exclude.extend(signal.product_id for signal in signals)
        pool = min(MAX_PRODUCT_LOOKUP, max(request.limit, request.limit * POOL_FACTOR))
        queryable, candidates = await self._reader.recommendation_candidates(
            anchor_product_id=anchor,
            profile_signals=signal_weights,
            top_k=pool,
            descriptor=self._descriptor,
            exclude=_dedupe(exclude),
            restrict_to=request.candidate_product_ids,
        )
        if not queryable:
            return RecommendationOutcome(
                items=[],
                strategy=_strategy(request.mode),
                algorithm_version=ALGORITHM_VERSION,
                anchor_indexed=False,
            )
        scoring_started = time.perf_counter()
        try:
            items = await run_cpu(lambda: select_ranked(candidates, request.limit))
        finally:
            log_event(
                "ai.recommendation_scoring_timing",
                durationMs=round((time.perf_counter() - scoring_started) * 1000, 2),
                candidateCount=len(candidates),
            )
        return RecommendationOutcome(
            items=items,
            strategy=_strategy(request.mode),
            algorithm_version=ALGORITHM_VERSION,
            anchor_indexed=True,
        )


def _strategy(mode: RecommendationMode) -> RecommendationStrategy:
    if mode is RecommendationMode.RECOMMENDED_FOR_YOU:
        return RecommendationStrategy.BEHAVIOR_EMBEDDING
    return RecommendationStrategy.EMBEDDING_SIMILARITY


def _dedupe(ids: Sequence[UUID]) -> tuple[UUID, ...]:
    return tuple(dict.fromkeys(ids))
