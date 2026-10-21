"""Recommendation orchestration: configured limits -> readiness gate -> bounded ranker run ->
validated ranked references. In 04.1 the readiness gate always refuses."""

from __future__ import annotations

from pydantic import ValidationError

from app.core.config import Settings
from app.core.errors import InferenceOutputError, ModelNotReadyError, ValidationFailedError
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

    def ensure_available(self) -> RecommendationRanker:
        ranker = self._registry.ranker
        if ranker is None or not self._registry.feature_status("recommendations").available:
            raise ModelNotReadyError()
        return ranker

    async def recommend(self, request: RecommendationRequest) -> RecommendationResult:
        self.validate_limits(request)
        ranker = self.ensure_available()
        descriptor = ranker.descriptor

        items = list(await self._executor.run(lambda: ranker.rank(request)))
        if len(items) > request.limit:
            raise InferenceOutputError()
        try:
            return RecommendationResult(
                mode=request.mode,
                items=items,
                model_version=descriptor.model_version,
                embedding_version=descriptor.embedding_version,
            )
        except ValidationError as exc:
            raise InferenceOutputError() from exc
