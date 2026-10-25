from __future__ import annotations

from typing import Annotated, Final

from fastapi import APIRouter, Depends, Query, Request
from starlette.datastructures import UploadFile  # what request.form() yields (fastapi.UploadFile is a subclass)
from starlette.exceptions import HTTPException
from starlette.formparsers import MultiPartException

from app.api.dependencies import get_image_search_service
from app.core.errors import ImageTooLargeError, InvalidImageError, ValidationFailedError
from app.schemas.common import DataEnvelope, ErrorEnvelope
from app.schemas.image_search import HARD_MAX_TOP_K, ImageSearchResult
from app.services.image_search_service import ImageSearchService

router = APIRouter(tags=["Image search"])

IMAGE_SEARCH_PATH: Final = "/internal/v1/image-search"
IMAGE_FIELD: Final = "image"
# Multipart framing (boundaries, part headers) allowed on top of AI_MAX_IMAGE_BYTES for this one route.
MULTIPART_OVERHEAD_BYTES: Final = 64 * 1024


@router.post(
    "/image-search",
    response_model=DataEnvelope[ImageSearchResult],
    responses={
        413: {"model": ErrorEnvelope, "description": "AI_PAYLOAD_TOO_LARGE / AI_IMAGE_TOO_LARGE"},
        415: {"model": ErrorEnvelope, "description": "AI_UNSUPPORTED_MEDIA_TYPE"},
        422: {"model": ErrorEnvelope, "description": "AI_VALIDATION_FAILED / AI_INVALID_IMAGE"},
        429: {"model": ErrorEnvelope, "description": "AI_RATE_LIMITED"},
        503: {"model": ErrorEnvelope, "description": "AI_MODEL_NOT_READY / AI_INDEX_NOT_READY"},
        504: {"model": ErrorEnvelope, "description": "AI_INFERENCE_TIMEOUT"},
    },
)
async def image_search(
    request: Request,
    service: Annotated[ImageSearchService, Depends(get_image_search_service)],
    top_k: Annotated[int, Query(alias="topK", ge=1, le=HARD_MAX_TOP_K)] = 12,
) -> DataEnvelope[ImageSearchResult]:
    """Visual search over the active catalog embedding index.

    Accepts exactly one multipart file part named ``image`` (JPEG, PNG or WebP). The body is read only after the
    service is confirmed available, so an unavailable feature never spends upload bandwidth.
    """
    service.validate_top_k(top_k)
    await service.ensure_available()
    image_bytes = await _read_single_image(request, service.max_image_bytes)
    return DataEnvelope(data=await service.search(image_bytes, top_k))


async def _read_single_image(request: Request, max_bytes: int) -> bytes:
    try:
        # Zero text fields and one file part: any extra field or file is rejected by the parser itself.
        form = await request.form(max_files=1, max_fields=0)
    except (MultiPartException, HTTPException) as exc:
        # Starlette reports exceeded part limits and malformed bodies as HTTP 400; the contract is one 422 envelope.
        raise ValidationFailedError("The multipart body must contain exactly one image part.") from exc
    try:
        entries = form.multi_items()
        if len(entries) != 1 or entries[0][0] != IMAGE_FIELD:
            raise ValidationFailedError("The multipart body must contain exactly one image part named image.")
        part: object = entries[0][1]
        if not isinstance(part, UploadFile):
            raise ValidationFailedError("The multipart body must contain exactly one image part named image.")
        data = await part.read(max_bytes + 1)
    finally:
        await form.close()
    if len(data) > max_bytes:
        raise ImageTooLargeError()
    if not data:
        raise InvalidImageError()
    return data
