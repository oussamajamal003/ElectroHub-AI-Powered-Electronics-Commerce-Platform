"""Image input contract for the future encoder (decoding/validation itself arrives in 04.2)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

ImageContentType = Literal["image/jpeg", "image/png", "image/webp"]


@dataclass(frozen=True, slots=True)
class ValidatedImage:
    """An upload whose magic bytes, decode, pixel bounds and metadata stripping already passed.

    Instances are short-lived and never logged or persisted (U11).
    """

    content_type: ImageContentType
    width: int
    height: int
    data: bytes

    def __repr__(self) -> str:
        # Never render the image bytes into logs or tracebacks.
        return (
            f"ValidatedImage(content_type={self.content_type!r}, width={self.width}, "
            f"height={self.height}, bytes={len(self.data)})"
        )
