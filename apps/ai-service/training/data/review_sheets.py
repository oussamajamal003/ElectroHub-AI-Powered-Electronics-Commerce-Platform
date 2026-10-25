"""Builds numbered contact sheets of auto-passing Commons candidates for manual identity review.

Thumbnails (Commons 480px renditions) are cached under <root>/cache/thumbs and are only used for review. The reviewer
records decisions in manifests/review.json: {family: {"accept": [index, ...], "notes": {index: reason}}}.

    python data/review_sheets.py --root <dataset-root> [--family "Canon EOS R5"]
"""

from __future__ import annotations

import argparse
import hashlib
import http.client
import io
import json
import time
import urllib.request
from pathlib import Path

from commons_collect import USER_AGENT
from PIL import Image, ImageDraw

CELL, LABEL, COLUMNS = 240, 22, 5
_last = 0.0


def fetch(url: str, cache: Path) -> bytes:
    global _last
    target = cache / hashlib.sha256(url.encode()).hexdigest()
    if target.exists():
        return target.read_bytes()
    wait = 1.0 - (time.monotonic() - _last)
    if wait > 0:
        time.sleep(wait)
    if not url.startswith(("https://upload.wikimedia.org/", "https://thumb.wikimedia.org/")):
        raise ValueError("only Wikimedia upload URLs are fetched")
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})  # noqa: S310 - https host checked above
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:  # noqa: S310 - Commons upload host only
                body = response.read()
            break
        except (OSError, http.client.HTTPException):
            if attempt == 3:
                raise
            time.sleep(5 * (attempt + 1))
    _last = time.monotonic()
    target.write_bytes(body)
    return body


PER_CREATOR = 6


def candidates(entry: dict[str, object]) -> list[dict[str, object]]:
    """Auto-passing candidates, at most PER_CREATOR per original creator (earliest Commons pages first), so one
    prolific photographer cannot dominate a family. Review indices refer to positions in this list."""
    from build_dataset import creator_key  # local import: build_dataset imports this module's sibling

    kept: list[dict[str, object]] = []
    seen: dict[str, int] = {}
    passing = [item for item in entry["candidates"] if not item["auto_reject"]]  # type: ignore[index,union-attr]
    for item in sorted(passing, key=lambda value: int(value["pageid"])):
        key = creator_key(item)
        if seen.get(key, 0) < PER_CREATOR:
            seen[key] = seen.get(key, 0) + 1
            kept.append(item)
    return kept


def sheet(family: str, items: list[dict[str, object]], cache: Path, out: Path) -> Path:
    rows = (len(items) + COLUMNS - 1) // COLUMNS
    canvas = Image.new("RGB", (COLUMNS * CELL, rows * (CELL + LABEL)), "white")
    draw = ImageDraw.Draw(canvas)
    for index, item in enumerate(items):
        x, y = (index % COLUMNS) * CELL, (index // COLUMNS) * (CELL + LABEL)
        try:
            with Image.open(io.BytesIO(fetch(str(item["thumb_url"]), cache))) as thumb:
                thumb = thumb.convert("RGB")
                thumb.thumbnail((CELL - 6, CELL - 6))
                canvas.paste(thumb, (x + 3, y + LABEL))
        except (OSError, http.client.HTTPException):
            draw.text((x + 10, y + 60), "unavailable", fill="red")
        uploader = str(item.get("artist") or item["uploader"])[:18]
        draw.text((x + 4, y + 4), f"#{index} {uploader}", fill="black")
    path = out / f"{family.replace('/', '-')}.jpg"
    canvas.save(path, quality=85)
    return path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--family", action="append")
    args = parser.parse_args()
    sources = json.loads((args.root / "manifests" / "commons_sources.json").read_text(encoding="utf-8"))
    cache = args.root / "cache" / "thumbs"
    out = args.root / "cache" / "sheets"
    cache.mkdir(parents=True, exist_ok=True)
    out.mkdir(parents=True, exist_ok=True)
    for family, entry in sorted(sources.items()):
        if args.family and family not in args.family:
            continue
        items = candidates(entry)
        if items:
            print(f"{family}: {len(items)} -> {sheet(family, items, cache, out)}", flush=True)


if __name__ == "__main__":
    main()
