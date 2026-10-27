"""Simulated camera conditions for the mouse-camera investigation (Task 04.2-Q): from one clean product photo, write
dark, small-subject (product in a wider desk frame), blurred and combined variants. Real camera photos remain the
reference; these isolate which capture factor changes the ranking.

    python training/relevance/camera_degradations.py <photo> <out-dir> <name>
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter, ImageOps


def small_subject(image: Image.Image, scale: float = 0.3) -> Image.Image:
    """The product occupies `scale` of the frame width on a neutral mid-grey desk-like background."""
    width, height = image.size
    canvas = Image.new("RGB", (int(width / scale), int(height / scale)), (92, 84, 76))
    canvas.paste(image, ((canvas.width - width) // 2, (canvas.height - height) // 2 + height // 3))
    return canvas


def variants(image: Image.Image) -> dict[str, Image.Image]:
    dark = ImageEnhance.Brightness(image).enhance(0.35)
    return {
        "clean": image,
        "dark": dark,
        "small": small_subject(image),
        "blur": image.filter(ImageFilter.GaussianBlur(radius=max(image.size) / 250)),
        "dark_small": small_subject(dark),
        "dark_small_blur": small_subject(dark).filter(ImageFilter.GaussianBlur(radius=3)),
    }


def main(photo: Path, out: Path, name: str) -> None:
    out.mkdir(parents=True, exist_ok=True)
    with Image.open(photo) as opened:
        image = ImageOps.exif_transpose(opened).convert("RGB")
    for variant, picture in variants(image).items():
        picture.save(out / f"{name}-{variant}.jpg", quality=88)


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3])
