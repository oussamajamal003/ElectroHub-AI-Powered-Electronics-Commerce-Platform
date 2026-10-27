from __future__ import annotations

import pytest
from PIL import Image

from app.core.errors import ImageTooLargeError, InvalidImageError, UnsupportedMediaTypeError
from app.processors.image import decode_image, sniff_content_type
from tests.imagefactory import (
    animated_gif,
    animated_webp,
    exif_rotated_jpeg,
    jpeg_bytes,
    png_bytes,
    png_with_claimed_size,
    rgba_png_transparent,
    webp_bytes,
)


@pytest.mark.parametrize(
    ("data", "content_type"),
    [
        (jpeg_bytes(64, 48), "image/jpeg"),
        (png_bytes(64, 48), "image/png"),
        (webp_bytes(64, 48), "image/webp"),
    ],
)
def test_each_supported_format_decodes_to_rgb(data: bytes, content_type: str) -> None:
    image = decode_image(data)
    assert image.content_type == content_type
    assert (image.width, image.height) == (64, 48)
    assert image.rgb.mode == "RGB" and image.rgb.size == (64, 48)


def test_format_is_decided_by_magic_bytes_not_by_declared_type() -> None:
    # A PNG renamed or labelled as JPEG by the client is still decoded as the PNG it is.
    assert decode_image(png_bytes(40, 40)).content_type == "image/png"
    assert sniff_content_type(b"GIF89a....") is None


@pytest.mark.parametrize(
    "payload",
    [
        b"",
        b"<html><script>alert(1)</script></html>",
        b"%PDF-1.7 not an image",
        b"GIF89a" + b"\x00" * 32,
        b"RIFF\x00\x00\x00\x00WAVEfmt ",
    ],
)
def test_unsupported_or_spoofed_payloads_are_415(payload: bytes) -> None:
    with pytest.raises(UnsupportedMediaTypeError):
        decode_image(payload)


def test_truncated_jpeg_is_rejected() -> None:
    data = jpeg_bytes(128, 96)
    with pytest.raises(InvalidImageError):
        decode_image(data[: len(data) // 2])


def test_truncated_png_is_rejected() -> None:
    data = png_bytes(128, 96)
    with pytest.raises(InvalidImageError):
        decode_image(data[: len(data) - 40])


def test_garbage_after_a_valid_signature_is_invalid_not_a_crash() -> None:
    with pytest.raises(InvalidImageError):
        decode_image(b"\x89PNG\r\n\x1a\n" + b"\xff" * 64)


def test_png_claiming_huge_dimensions_is_rejected_before_decoding() -> None:
    with pytest.raises(ImageTooLargeError):
        decode_image(png_with_claimed_size(10_000, 10_000))  # 100 MP > 40 MP default


def test_png_claiming_an_overlong_side_is_rejected() -> None:
    with pytest.raises(ImageTooLargeError):
        decode_image(png_with_claimed_size(12_001, 32))


def test_configured_pixel_limit_is_enforced() -> None:
    data = png_bytes(64, 64)
    decode_image(data, max_pixels=4096)
    with pytest.raises(ImageTooLargeError):
        decode_image(data, max_pixels=4095)


def test_images_below_the_minimum_side_are_invalid() -> None:
    with pytest.raises(InvalidImageError):
        decode_image(png_bytes(31, 200))
    assert decode_image(png_bytes(32, 32)).width == 32


@pytest.mark.parametrize("data", [animated_webp(48, 48), animated_gif(48, 48)], ids=["webp", "gif"])
def test_animated_images_are_refused(data: bytes) -> None:
    with pytest.raises(UnsupportedMediaTypeError):
        decode_image(data)


def test_exif_orientation_is_applied_before_encoding() -> None:
    # Stored 60x30 with orientation 6 (rotate 90 degrees clockwise): the upright image is 30x60.
    image = decode_image(exif_rotated_jpeg(96, 48, orientation=6))  # rotated result stays above MIN_SIDE_PIXELS
    assert (image.width, image.height) == (48, 96)
    assert image.rgb.size == (48, 96)


def test_transparent_pixels_are_composited_onto_white() -> None:
    image = decode_image(rgba_png_transparent(40, 40))
    assert image.rgb.getpixel((5, 5)) == (255, 255, 255)


def test_repr_never_contains_pixels() -> None:
    image = decode_image(png_bytes(32, 32))
    rendered = repr(image)
    assert "pixels=<redacted>" in rendered
    assert isinstance(image.rgb, Image.Image) and "bytes" not in rendered
