"""Image-search orchestration: readiness gate -> bounded encoder run -> version-matched
vector lookup -> validated ranked references. In 04.1 the readiness gate always refuses."""

from __future__ import annotations

import math

from pydantic import ValidationError

from app.core.config import Settings
from app.core.errors import IndexNotReadyError, InferenceOutputError, ModelNotReadyError, ValidationFailedError
from app.integrations.vector_gateway import EmbeddingSearchGateway
from app.models.interfaces import ImageEmbeddingEncoder
from app.models.registry import ModelRegistry
from app.processors.image import ValidatedImage
from app.processors.inference import InferenceExecutor
from app.schemas.image_search import ImageSearchResult


class ImageSearchService:
    def __init__(self, registry: ModelRegistry, executor: InferenceExecutor, settings: Settings) -> None:
        self._registry = registry
        self._executor = executor
        self._settings = settings

    def ensure_available(self) -> tuple[ImageEmbeddingEncoder, EmbeddingSearchGateway]:
        status = self._registry.feature_status("imageSearch")
        encoder, gateway = self._registry.image_encoder, self._registry.vector_gateway
        if status.reason == "INDEX_NOT_READY":
            raise IndexNotReadyError()
        if not status.available or encoder is None or gateway is None:
            raise ModelNotReadyError()
        return encoder, gateway

    def validate_top_k(self, top_k: int) -> int:
        if not 1 <= top_k <= self._settings.AI_MAX_TOP_K:
            raise ValidationFailedError(f"topK must be between 1 and {self._settings.AI_MAX_TOP_K}.")
        return top_k

    async def search(self, image: ValidatedImage, top_k: int) -> ImageSearchResult:
        self.validate_top_k(top_k)
        encoder, gateway = self.ensure_available()
        descriptor = encoder.descriptor

        vector = list(await self._executor.run(lambda: encoder.encode(image)))
        if len(vector) != descriptor.embedding_dimension or not all(math.isfinite(v) for v in vector):
            raise InferenceOutputError()

        matches = list(await gateway.nearest(vector, top_k=top_k, descriptor=descriptor))
        if len(matches) > top_k:
            raise InferenceOutputError()
        try:
            return ImageSearchResult(
                matches=matches,
                model_version=descriptor.model_version,
                embedding_version=descriptor.embedding_version,
            )
        except ValidationError as exc:
            raise InferenceOutputError() from exc
