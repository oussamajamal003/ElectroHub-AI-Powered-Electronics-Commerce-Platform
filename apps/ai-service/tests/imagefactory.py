"""In-memory image builders for tests. Nothing here is written to disk or shipped with the service."""

from __future__ import annotations

import io
import struct
import zlib

from PIL import Image


def _save(image: Image.Image, fmt: str, **options: object) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format=fmt, **options)
    return buffer.getvalue()


def solid(width: int, height: int, color: tuple[int, int, int] = (40, 120, 200)) -> Image.Image:
    # A gradient rather than a flat fill, so the encoder sees structure.
    image = Image.new("RGB", (width, height), color)
    for x in range(0, width, max(1, width // 8)):
        for y in range(height):
            image.putpixel((x, y), (min(255, color[0] + x % 64), color[1], min(255, color[2] + y % 64)))
    return image


def png_bytes(width: int, height: int) -> bytes:
    return _save(solid(width, height), "PNG")


def jpeg_bytes(width: int, height: int) -> bytes:
    return _save(solid(width, height), "JPEG", quality=90)


def webp_bytes(width: int, height: int) -> bytes:
    return _save(solid(width, height), "WEBP", quality=90)


def padded_image_bytes(fmt: str, size: int) -> bytes:
    """A valid small decoded image with legal ignored metadata, for testing the encoded-byte budget exactly."""
    if fmt == "PNG":
        base = png_bytes(64, 48)
        payload = b"\0" * (size - len(base) - 12)
        kind = b"npAD"  # ancillary, private, safe-to-copy chunk
        chunk = struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload))
        return base[:-12] + chunk + base[-12:]
    if fmt == "JPEG":
        base = jpeg_bytes(64, 48)
        remaining = size - len(base)
        comments = bytearray()
        while remaining:
            length = min(remaining, 65_537)
            if 0 < remaining - length < 4:
                length -= 4
            comments.extend(b"\xff\xfe" + struct.pack(">H", length - 2) + b"\0" * (length - 4))
            remaining -= length
        return base[:2] + comments + base[2:]
    if fmt == "WEBP":
        base = webp_bytes(64, 48)
        payload = b"\0" * (size - len(base) - 8)
        return b"RIFF" + struct.pack("<I", size - 8) + base[8:] + b"JUNK" + struct.pack("<I", len(payload)) + payload
    raise ValueError("unsupported test format")


def rgba_png_transparent(width: int, height: int) -> bytes:
    image = Image.new("RGBA", (width, height), (255, 0, 0, 0))
    return _save(image, "PNG")


def exif_rotated_jpeg(width: int, height: int, orientation: int) -> bytes:
    exif = Image.Exif()
    exif[0x0112] = orientation
    return _save(solid(width, height), "JPEG", quality=95, exif=exif.tobytes())


def animated_webp(width: int, height: int, frames: int = 2) -> bytes:
    images = [solid(width, height, (10 * i, 200, 50)) for i in range(frames)]
    return _save(images[0], "WEBP", save_all=True, append_images=images[1:], duration=100, loop=0)


def animated_gif(width: int, height: int, frames: int = 2) -> bytes:
    images = [solid(width, height, (10 * i, 200, 50)).convert("P") for i in range(frames)]
    return _save(images[0], "GIF", save_all=True, append_images=images[1:], duration=100, loop=0)


def png_with_claimed_size(width: int, height: int) -> bytes:
    """A PNG whose IHDR claims ``width`` x ``height`` but whose IDAT is tiny: the classic decompression bomb shape."""
    signature = b"\x89PNG\r\n\x1a\n"

    def chunk(kind: bytes, payload: bytes) -> bytes:
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload))

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    idat = zlib.compress(b"\x00" * 16)
    return signature + chunk(b"IHDR", header) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")
