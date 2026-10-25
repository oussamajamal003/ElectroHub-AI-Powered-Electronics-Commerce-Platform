from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.dependencies import get_started_runtime
from app.core.config import API_VERSION, SERVICE_NAME, SERVICE_VERSION
from app.core.runtime import AppRuntime
from app.processors.image import ACCEPTED_CONTENT_TYPES
from app.schemas.common import (
    Capabilities,
    DataEnvelope,
    ErrorEnvelope,
    Features,
    ImageSearchCapabilities,
    Limits,
    Readiness,
)

router = APIRouter(tags=["Readiness"])


def _features(runtime: AppRuntime) -> Features:
    return Features(
        image_search=runtime.registry.feature_status("imageSearch"),
        recommendations=runtime.registry.feature_status("recommendations"),
    )


@router.get(
    "/ready",
    response_model=DataEnvelope[Readiness],
    responses={503: {"model": ErrorEnvelope, "description": "AI_NOT_READY / AI_AUTH_NOT_CONFIGURED"}},
)
async def readiness(runtime: Annotated[AppRuntime, Depends(get_started_runtime)]) -> DataEnvelope[Readiness]:
    """The service accepts internal calls. Feature availability is reported per feature and is
    ``false`` until a real trained artifact (and, for image search, its index) is loaded.

    The index check is repeated on every call: a cached ``true`` would outlive a version switch."""
    await runtime.registry.refresh_index()
    return DataEnvelope(
        data=Readiness(
            status="ready",
            service=SERVICE_NAME,
            environment=runtime.settings.AI_ENVIRONMENT,
            api_version=API_VERSION,
            model_ready=runtime.registry.any_model_ready,
            features=_features(runtime),
        )
    )


@router.get("/capabilities", response_model=DataEnvelope[Capabilities])
async def capabilities(runtime: Annotated[AppRuntime, Depends(get_started_runtime)]) -> DataEnvelope[Capabilities]:
    await runtime.registry.refresh_index()
    settings = runtime.settings
    descriptor = runtime.registry.image_encoder.descriptor if runtime.registry.image_encoder else None
    return DataEnvelope(
        data=Capabilities(
            service=SERVICE_NAME,
            environment=settings.AI_ENVIRONMENT,
            api_version=API_VERSION,
            service_version=SERVICE_VERSION,
            features=_features(runtime),
            limits=Limits(
                max_request_bytes=settings.AI_MAX_REQUEST_BYTES,
                max_top_k=settings.AI_MAX_TOP_K,
                max_candidates=settings.AI_MAX_CANDIDATES,
                inference_timeout_ms=round(settings.AI_INFERENCE_TIMEOUT_SECONDS * 1000),
                max_concurrent_inferences=settings.AI_MAX_CONCURRENT_INFERENCES,
            ),
            image_search=ImageSearchCapabilities(
                accepted_content_types=list(ACCEPTED_CONTENT_TYPES),
                max_image_bytes=settings.AI_MAX_IMAGE_BYTES,
                max_image_pixels=settings.AI_MAX_IMAGE_PIXELS,
                max_top_k=settings.AI_MAX_TOP_K,
                model_version=descriptor.model_version if descriptor else None,
                embedding_version=descriptor.embedding_version if descriptor else None,
            ),
        )
    )
