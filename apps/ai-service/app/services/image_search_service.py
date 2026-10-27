"""Image-search orchestration: readiness gate -> bounded decode+encode -> version-matched vector lookup ->
validated ranked references. Decoding and encoding run together in one executor slot, off the event loop."""

from __future__ import annotations

import math
import time
from collections.abc import Iterator
from contextlib import contextmanager

from pydantic import ValidationError

from app.core.config import Settings
from app.core.errors import (
    AIServiceError,
    IndexNotReadyError,
    InferenceOutputError,
    ModelNotReadyError,
    ValidationFailedError,
)
from app.core.logging import log_event
from app.integrations.vector_gateway import EmbeddingSearchGateway
from app.models.efficientnet_loader import EfficientNetEncoder
from app.models.interfaces import ImageEmbeddingEncoder
from app.models.registry import ModelRegistry
from app.models.relevance import FALLBACK_DEPTH, Assessment
from app.models.siglip_loader import SiglipEncoder
from app.processors.image import decode_image
from app.processors.inference import InferenceExecutor
from app.schemas.image_search import CategoryHint, ImageSearchResult


class ImageSearchService:
    def __init__(self, registry: ModelRegistry, executor: InferenceExecutor, settings: Settings) -> None:
        self._registry = registry
        self._executor = executor
        self._settings = settings

    @property
    def max_image_bytes(self) -> int:
        return self._settings.AI_MAX_IMAGE_BYTES

    async def ensure_available(self) -> tuple[ImageEmbeddingEncoder, EmbeddingSearchGateway]:
        await self._registry.refresh_index_if_stale()
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

    async def search(self, image_bytes: bytes, top_k: int, *, request_id: str | None = None) -> ImageSearchResult:
        self.validate_top_k(top_k)
        encoder, gateway = await self.ensure_available()
        descriptor = encoder.descriptor
        max_pixels = self._settings.AI_MAX_IMAGE_PIXELS
        metadata: dict[str, object] = {
            "requestId": request_id or "unknown",
            "environment": self._settings.AI_ENVIRONMENT,
            "modelVersion": descriptor.model_version,
            "indexVersion": descriptor.embedding_version,
        }

        def decode_and_encode() -> tuple[list[float], Assessment | None]:
            with _timed_phase("decode", metadata):
                image = decode_image(image_bytes, max_pixels=max_pixels)
            with _timed_phase("encode", metadata):
                if isinstance(encoder, EfficientNetEncoder | SiglipEncoder):
                    return encoder.encode_assessed(image)
                return list(encoder.encode(image)), None

        with _timed_phase("inference", metadata):
            vector, assessment = await self._executor.run(decode_and_encode)
        if len(vector) != descriptor.embedding_dimension or not all(math.isfinite(v) for v in vector):
            raise InferenceOutputError()

        top_k = min(top_k, self._settings.AI_MAX_TOP_K)
        gate = encoder.relevance if isinstance(encoder, EfficientNetEncoder | SiglipEncoder) else None
        use_fallback = gate is not None and assessment is not None and gate.fallback(assessment)
        depth = max(top_k, FALLBACK_DEPTH) if use_fallback else top_k
        with _timed_phase("retrieval", metadata):
            nearest = list(await gateway.nearest(vector, top_k=depth, descriptor=descriptor))
        if len(nearest) > depth:
            raise InferenceOutputError()
        matches = nearest[:top_k]
        fallback_matches = nearest if use_fallback else None
        hints: list[CategoryHint] = []
        category_weight: float | None = None
        category_min_ratio: float | None = None
        family_supported = True
        if gate is not None and assessment is not None:
            family_supported = gate.family_supported(assessment, nearest[0].score if nearest else None)
            if not family_supported:
                matches, fallback_matches = [], None
            matches = gate.select(matches, assessment.electronics_mass)
            if matches or fallback_matches:
                hints = [CategoryHint(category=slug, probability=p) for slug, p in assessment.category_hints]
                category_weight = gate.category_weight if hints else None
                category_min_ratio = gate.min_category_ratio if hints and gate.min_category_ratio > 0 else None
            log_event(
                "ai.search_relevance",
                requestId=metadata["requestId"],
                relevanceVersion=gate.version,
                accepted=len(matches),
                rejectedQuery=not matches,
                fallbackOffered=fallback_matches is not None,
                familySupported=family_supported,
            )
        try:
            return ImageSearchResult(
                matches=matches,
                category_hints=hints,
                category_weight=category_weight,
                category_min_ratio=category_min_ratio,
                fallback_matches=fallback_matches,
                fallback_score_gap=gate.max_score_gap if gate is not None and fallback_matches is not None else None,
                model_version=descriptor.model_version,
                embedding_version=descriptor.embedding_version,
            )
        except ValidationError as exc:
            raise InferenceOutputError() from exc


@contextmanager
def _timed_phase(phase: str, metadata: dict[str, object]) -> Iterator[None]:
    """Small scalar timing events; failures in diagnostics never change a request's result."""
    started = time.perf_counter()
    outcome, code = "completed", "OK"
    try:
        yield
    except BaseException as exc:
        outcome = "failed"
        code = exc.code if isinstance(exc, AIServiceError) else "AI_PHASE_FAILED"
        raise
    finally:
        try:
            log_event(
                "ai.search_phase",
                operation="image_search",
                phase=phase,
                outcome=outcome,
                code=code,
                durationMs=round((time.perf_counter() - started) * 1000, 2),
                requestId=metadata["requestId"],
                environment=metadata["environment"],
                modelVersion=metadata["modelVersion"],
                indexVersion=metadata["indexVersion"],
            )
        except Exception:  # noqa: S110 -- logging another exception would repeat the failed diagnostics path.
            pass  # Diagnostics are deliberately best-effort, including broken stdout/logging handlers.
