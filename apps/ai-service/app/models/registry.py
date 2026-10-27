"""Owns model artifacts for the life of the process: load once at startup, close on shutdown,
and report readiness truthfully. A feature without a configured loader reports
``NOT_READY / MODEL_NOT_CONFIGURED``; the index is re-validated on every readiness probe."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass

import anyio.to_thread

from app.core.logging import log_event
from app.integrations.vector_gateway import EmbeddingSearchGateway
from app.models.interfaces import ImageEmbeddingEncoder, LoadedModel, ModelLoader, RecommendationRanker
from app.schemas.common import FeatureName, FeatureStatus, NotReadyReason


@dataclass
class _Slot:
    loader: ModelLoader | None
    expected: type
    model: LoadedModel | None = None
    load_failed: bool = False


class ModelRegistry:
    def __init__(
        self,
        *,
        image_encoder_loader: ModelLoader | None = None,
        ranker_loader: ModelLoader | None = None,
        vector_gateway: EmbeddingSearchGateway | None = None,
    ) -> None:
        self._slots: dict[FeatureName, _Slot] = {
            "imageSearch": _Slot(image_encoder_loader, ImageEmbeddingEncoder),
            "recommendations": _Slot(ranker_loader, RecommendationRanker),
        }
        self._gateway = vector_gateway
        self._index_ready = False
        self._last_index_check = float("-inf")

    async def start(self) -> None:
        for feature, slot in self._slots.items():
            if slot.loader is None:
                continue
            try:
                # Deserializing weights is blocking work; keep it off the event loop.
                model = await anyio.to_thread.run_sync(slot.loader)
                if not isinstance(model, slot.expected):
                    raise TypeError(f"loader returned an object that is not a {slot.expected.__name__}")
                slot.model = model
                log_event(
                    "ai.model_loaded",
                    feature=feature,
                    modelVersion=model.descriptor.model_version,
                    embeddingVersion=model.descriptor.embedding_version,
                )
            except Exception as exc:
                slot.load_failed = True
                log_event("ai.model_load_failed", level=logging.ERROR, feature=feature, exception=type(exc).__name__)

        await self.refresh_index()

    async def refresh_index_if_stale(self, min_interval_seconds: float = 5.0) -> None:
        """Self-healing for the search path: when the index was last seen not ready, re-check at most once per interval,
        so a transient failure or a rollback recovers without waiting for an external readiness probe."""
        if self._index_ready or time.monotonic() - self._last_index_check < min_interval_seconds:
            return
        await self.refresh_index()

    async def refresh_index(self) -> None:
        """Re-validate the active index against the loaded encoder. Called at startup and by every readiness probe,
        so a version switch or an emptied index is reported on the next probe instead of never."""
        self._last_index_check = time.monotonic()
        encoder = self.image_encoder
        gateway = self._gateway
        if encoder is None or gateway is None:
            self._index_ready = False
            return
        try:
            self._index_ready = bool(await gateway.is_ready(encoder.descriptor))
        except Exception as exc:
            log_event("ai.index_check_failed", level=logging.ERROR, exception=type(exc).__name__)
            self._index_ready = False

    async def stop(self) -> None:
        for feature, slot in self._slots.items():
            model, slot.model = slot.model, None
            if model is None:
                continue
            try:
                await anyio.to_thread.run_sync(model.close)
            except Exception as exc:
                log_event("ai.model_close_failed", level=logging.ERROR, feature=feature, exception=type(exc).__name__)
        if self._gateway is not None:
            try:
                await self._gateway.close()
            except Exception as exc:
                log_event("ai.index_close_failed", level=logging.ERROR, exception=type(exc).__name__)
        self._index_ready = False

    @property
    def image_encoder(self) -> ImageEmbeddingEncoder | None:
        model = self._slots["imageSearch"].model
        return model if isinstance(model, ImageEmbeddingEncoder) else None

    @property
    def ranker(self) -> RecommendationRanker | None:
        model = self._slots["recommendations"].model
        return model if isinstance(model, RecommendationRanker) else None

    @property
    def vector_gateway(self) -> EmbeddingSearchGateway | None:
        return self._gateway

    def feature_status(self, feature: FeatureName) -> FeatureStatus:
        slot = self._slots[feature]
        reason: NotReadyReason | None
        if slot.model is None:
            reason = "MODEL_NOT_LOADED" if slot.load_failed else "MODEL_NOT_CONFIGURED"
        elif feature == "imageSearch" and not self._index_ready:
            reason = "INDEX_NOT_READY"
        else:
            reason = None

        descriptor = slot.model.descriptor if slot.model is not None else None
        return FeatureStatus(
            available=reason is None,
            status="READY" if reason is None else "NOT_READY",
            reason=reason,
            model_version=descriptor.model_version if descriptor else None,
            embedding_version=descriptor.embedding_version if descriptor else None,
        )

    @property
    def any_model_ready(self) -> bool:
        return any(slot.model is not None for slot in self._slots.values())
