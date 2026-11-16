"""Recommendation orchestration: configured limits -> readiness gate -> bounded ranker run ->
validated ranked references with model, embedding and algorithm identity."""

from __future__ import annotations

import anyio
from pydantic import ValidationError

from app.core.config import Settings
from app.core.errors import (
    IndexNotReadyError,
    InferenceOutputError,
    InferenceTimeoutError,
    ModelNotReadyError,
    ValidationFailedError,
)
from app.models.interfaces import RecommendationRanker
from app.models.registry import ModelRegistry
from app.processors.inference import InferenceExecutor
from app.schemas.recommendations import RecommendationRequest, RecommendationResult


class RecommendationService:
    def __init__(self, registry: ModelRegistry, executor: InferenceExecutor, settings: Settings) -> None:
        self._registry = registry
        self._executor = executor
        self._settings = settings

    def validate_limits(self, request: RecommendationRequest) -> None:
        if request.limit > self._settings.AI_MAX_TOP_K:
            raise ValidationFailedError(f"limit must not exceed {self._settings.AI_MAX_TOP_K}.")
        if len(request.candidate_product_ids) > self._settings.AI_MAX_CANDIDATES:
            raise ValidationFailedError(f"candidateProductIds must not exceed {self._settings.AI_MAX_CANDIDATES}.")

    async def ensure_available(self) -> RecommendationRanker:
        # A recent index failure is re-checked (rate-limited) so a recovered index serves again without a probe.
        await self._registry.refresh_index_if_stale()
        ranker = self._registry.ranker
        status = self._registry.feature_status("recommendations")
        if ranker is not None and status.reason == "INDEX_NOT_READY":
            raise IndexNotReadyError()
        if ranker is None or not status.available:
            raise ModelNotReadyError()
        return ranker

    async def recommend(self, request: RecommendationRequest) -> RecommendationResult:
        self.validate_limits(request)
        ranker = await self.ensure_available()
        descriptor = ranker.descriptor
        try:
            # One budget for retrieval and scoring; the database statement timeout bounds each query underneath.
            with anyio.fail_after(self._settings.AI_INFERENCE_TIMEOUT_SECONDS):
                outcome = await ranker.recommend(request, self._executor.run)
        except TimeoutError as exc:
            raise InferenceTimeoutError() from exc

        items = list(outcome.items)
        if len(items) > request.limit:
            raise InferenceOutputError()
        try:
            return RecommendationResult(
                mode=request.mode,
                items=items,
                model_version=descriptor.model_version,
                embedding_version=descriptor.embedding_version,
                strategy=outcome.strategy,
                algorithm_version=outcome.algorithm_version,
                anchor_indexed=outcome.anchor_indexed,
            )
        except ValidationError as exc:
            raise InferenceOutputError() from exc
