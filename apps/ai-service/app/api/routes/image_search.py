from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.api.dependencies import get_image_search_service
from app.core.errors import FeatureNotImplementedError
from app.schemas.common import DataEnvelope, ErrorEnvelope
from app.schemas.image_search import HARD_MAX_TOP_K, ImageSearchResult
from app.services.image_search_service import ImageSearchService

router = APIRouter(tags=["Image search"])


@router.post(
    "/image-search",
    response_model=DataEnvelope[ImageSearchResult],
    responses={
        413: {"model": ErrorEnvelope, "description": "AI_PAYLOAD_TOO_LARGE"},
        422: {"model": ErrorEnvelope, "description": "AI_VALIDATION_FAILED"},
        503: {"model": ErrorEnvelope, "description": "AI_MODEL_NOT_READY / AI_INDEX_NOT_READY (always in Task 04.1)"},
    },
)
async def image_search(
    service: Annotated[ImageSearchService, Depends(get_image_search_service)],
    top_k: Annotated[int, Query(alias="topK", ge=1, le=HARD_MAX_TOP_K)] = 12,
) -> DataEnvelope[ImageSearchResult]:
    """Fine-tuned encoder + pgvector retrieval (Task 04.2).

    The multipart ``image`` part, its decode validation and the call to
    ``ImageSearchService.search`` arrive with the trained model. Until then the body is never
    read and the endpoint answers ``503 AI_MODEL_NOT_READY``; it never fabricates matches.
    """
    service.validate_top_k(top_k)
    service.ensure_available()
    # Only reachable if an encoder and an active index were injected before 04.2 wires the upload.
    raise FeatureNotImplementedError()
