"""Untrusted image bytes -> validated RGB pixels for the encoder.

The declared MIME type is never trusted: the format is decided by magic bytes, then Pillow must agree with it. Only
single-frame JPEG, PNG and WebP are accepted. Dimensions and pixel counts are bounded before any full decode, and
decompression-bomb warnings are escalated to rejections. Nothing here logs bytes, names or pixels.
"""

from __future__ import annotations

import io
import threading
import warnings
from dataclasses import dataclass
from typing import Final, Literal

from PIL import Image, ImageOps

from app.core.errors import ImageTooLargeError, InvalidImageError, UnsupportedMediaTypeError

ImageContentType = Literal["image/jpeg", "image/png", "image/webp"]

ACCEPTED_CONTENT_TYPES: Final[tuple[ImageContentType, ...]] = ("image/jpeg", "image/png", "image/webp")
MIN_SIDE_PIXELS: Final = 32
MAX_SIDE_PIXELS: Final = 12_000
DEFAULT_MAX_IMAGE_PIXELS: Final = 40_000_000

_PNG_SIGNATURE: Final = b"\x89PNG\r\n\x1a\n"
_JPEG_SOI: Final = b"\xff\xd8\xff"
_FORMAT_TYPES: Final[dict[str, ImageContentType]] = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}
# Pillow's bomb check reads a process-wide threshold; serialise the header probe so the warning filter is local.
_PROBE_LOCK: Final = threading.Lock()


@dataclass(frozen=True, slots=True)
class ValidatedImage:
    """An upload that passed magic-byte, decode, frame, dimension and orientation checks, as RGB pixels.

    Instances are short-lived and never logged or persisted (U11).
    """

    content_type: ImageContentType
    width: int
    height: int
    rgb: Image.Image

    def __repr__(self) -> str:
        # Never render pixels into logs or tracebacks.
        return (
            f"ValidatedImage(content_type={self.content_type!r}, width={self.width}, height={self.height}, "
            "pixels=<redacted>)"
        )


def sniff_content_type(data: bytes) -> ImageContentType | None:
    """Identify the container from its magic bytes; the client-declared type is ignored."""
    if data.startswith(_JPEG_SOI):
        return "image/jpeg"
    if data.startswith(_PNG_SIGNATURE):
        return "image/png"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def decode_image(data: bytes, *, max_pixels: int = DEFAULT_MAX_IMAGE_PIXELS) -> ValidatedImage:
    """Decode one untrusted image into an oriented RGB ``ValidatedImage``. Raises typed 4xx errors only."""
    content_type = sniff_content_type(data)
    if content_type is None:
        raise UnsupportedMediaTypeError()

    try:
        probe = _open(data)
        try:
            _check_header(probe, content_type, max_pixels)
            probe.verify()  # structural check of the whole file; invalidates this handle
        finally:
            probe.close()

        image = _open(data)
        try:
            image.load()
            oriented = ImageOps.exif_transpose(image)
        finally:
            image.close()
        rgb = _to_rgb(oriented)
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise ImageTooLargeError() from exc
    except (OSError, SyntaxError, ValueError, EOFError) as exc:
        raise InvalidImageError() from exc

    width, height = rgb.size
    _check_dimensions(width, height, max_pixels)
    return ValidatedImage(content_type=content_type, width=width, height=height, rgb=rgb)


def _open(data: bytes) -> Image.Image:
    with _PROBE_LOCK, warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        return Image.open(io.BytesIO(data))


def _check_header(image: Image.Image, content_type: ImageContentType, max_pixels: int) -> None:
    if _FORMAT_TYPES.get(image.format or "") != content_type:
        raise UnsupportedMediaTypeError()
    if getattr(image, "n_frames", 1) != 1:
        # Animated WebP/APNG and multi-page files are refused rather than silently reduced to one frame.
        raise UnsupportedMediaTypeError()
    width, height = image.size
    _check_dimensions(width, height, max_pixels)


def _check_dimensions(width: int, height: int, max_pixels: int) -> None:
    if min(width, height) < MIN_SIDE_PIXELS:
        raise InvalidImageError()
    if max(width, height) > MAX_SIDE_PIXELS or width * height > max_pixels:
        raise ImageTooLargeError()


def _to_rgb(image: Image.Image) -> Image.Image:
    """Flatten transparency onto white; every other mode converts directly to RGB."""
    if image.mode in ("RGBA", "LA", "PA") or (image.mode == "P" and "transparency" in image.info):
        rgba = image.convert("RGBA")
        background = Image.new("RGB", rgba.size, (255, 255, 255))
        background.paste(rgba, mask=rgba.getchannel("A"))
        return background
    return image.convert("RGB")
