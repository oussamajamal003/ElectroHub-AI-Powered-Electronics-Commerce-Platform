from __future__ import annotations

from typing import Annotated, Final

from fastapi import APIRouter, Depends, Query, Request
from starlette.datastructures import UploadFile
from starlette.formparsers import MultiPartException, MultiPartParser

from app.api.dependencies import get_image_search_service
from app.core.errors import ImageTooLargeError, InvalidImageError, ValidationFailedError, request_id_of
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
    return DataEnvelope(data=await service.search(image_bytes, top_k, request_id=request_id_of(request)))


async def _read_single_image(request: Request, max_bytes: int) -> bytes:
    if request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "multipart/form-data":
        raise ValidationFailedError("The multipart body must contain exactly one image part.")
    parser = _MemoryImageParser(request, max_bytes)
    try:
        form = await parser.parse()
        if not parser.complete or len(form.multi_items()) != 1:
            raise ValidationFailedError("The multipart body must contain exactly one complete image part.")
        part = form[IMAGE_FIELD]
        if not isinstance(part, UploadFile):
            raise ValidationFailedError("The multipart body must contain exactly one image part named image.")
        data = await part.read()
        if not data:
            raise InvalidImageError()
        return data
    except MultiPartException as exc:
        raise ValidationFailedError("The multipart body must contain exactly one image part.") from exc
    finally:
        # Includes malformed bodies, disconnects and cancellation. Every handle remains in memory and is closed here.
        parser.close()


class _MemoryImageParser(MultiPartParser):
    """Use the pinned Starlette parser with a per-request, strictly memory-only file budget.

    File bytes are checked in the parser callback BEFORE Starlette queues a write. The spool threshold is above
    that enforced budget, so no accepted or rejected upload can roll over to a filesystem temporary file. This is
    instance-local: other routes keep their ordinary parser limits and no global tempfile setting is changed.
    """

    def __init__(self, request: Request, max_bytes: int) -> None:
        super().__init__(request.headers, request.stream(), max_files=1, max_fields=0)
        self.spool_max_size = max_bytes + 1
        self._max_bytes = max_bytes
        self._received = 0
        self.complete = False

    def on_headers_finished(self) -> None:
        super().on_headers_finished()
        if self._current_part.file is None or self._current_part.field_name != IMAGE_FIELD:
            raise MultiPartException("Exactly one image file is required.")

    def on_part_data(self, data: bytes, start: int, end: int) -> None:
        self._received += end - start
        if self._received > self._max_bytes:
            raise ImageTooLargeError()
        super().on_part_data(data, start, end)

    def on_end(self) -> None:
        self.complete = True

    def close(self) -> None:
        for handle in self._files_to_close_on_error:
            handle.close()
