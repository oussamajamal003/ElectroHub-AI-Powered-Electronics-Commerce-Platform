"""Numbered contact sheets for visual label review (Task 04.2-Q). Sheet tiles are labelled <class>#<n>, where n is
the row's position within its class in provenance.csv; review decisions refer to those numbers.

    python training/data/contact_sheets.py training/.data/realphoto-v1 <out-dir> [class[@first-row] ...]
"""

from __future__ import annotations

import csv
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps

TILE, COLS, ROWS = 160, 8, 5


def main(root: Path, out: Path, classes: list[str]) -> None:
    out.mkdir(parents=True, exist_ok=True)
    rows = list(csv.DictReader((root / "provenance.csv").open(encoding="utf-8")))
    labels = classes or sorted({r["label"] for r in rows})
    for spec in labels:
        label, _, first = spec.partition("@")
        items = [r for r in rows if r["label"] == label]
        for start in range(int(first or 0), len(items), COLS * ROWS):
            sheet = Image.new("RGB", (COLS * TILE, ROWS * (TILE + 16)), "white")
            draw = ImageDraw.Draw(sheet)
            for k, row in enumerate(items[start : start + COLS * ROWS]):
                x, y = (k % COLS) * TILE, (k // COLS) * (TILE + 16)
                try:
                    with Image.open(root / "raw" / row["file"]) as image:
                        thumb = ImageOps.exif_transpose(image).convert("RGB")
                        thumb.thumbnail((TILE - 4, TILE - 4))
                        sheet.paste(thumb, (x + 2, y + 16))
                except OSError:
                    draw.text((x + 4, y + 40), "unreadable", fill="red")
                draw.text((x + 2, y + 2), f"{label}#{start + k}", fill="red")
            sheet.save(out / f"{label}-{start // (COLS * ROWS):02d}.jpg", quality=82)


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3:])
