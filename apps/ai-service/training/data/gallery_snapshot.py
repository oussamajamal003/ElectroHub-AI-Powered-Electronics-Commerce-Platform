"""Build the gallery manifest (Task 04.2-Q) from saved public-API product detail JSON: every visible product's
catalog images with the same product-image ids the ingestion CLI embeds. Files are copied from apps/frontend/public.

    # api/ holds <slug>.json from GET /api/products/<slug> (fetched with curl; see the evidence document)
    python training/data/gallery_snapshot.py training/.data/realphoto-v1/gallery
"""

from __future__ import annotations

import csv
import json
import shutil
import sys
from pathlib import Path

PUBLIC = Path(__file__).resolve().parents[3] / "frontend" / "public"


def main(out: Path) -> None:
    rows = []
    seen: set[str] = set()
    for detail_file in sorted((out / "api").glob("*.json")):
        if detail_file.name.startswith("page"):
            continue
        detail = json.loads(detail_file.read_text(encoding="utf-8"))["data"]
        for image in detail["images"]:
            if image["id"] in seen:
                continue
            seen.add(image["id"])
            source = PUBLIC / image["url"].lstrip("/")
            if not image["url"].startswith("/images/") or not source.is_file():
                raise SystemExit(f"missing catalog file for {detail['slug']}")
            target = out / "images" / image["url"].removeprefix("/images/")
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
            rows.append(
                {
                    "product_image_id": image["id"],
                    "product_id": detail["id"],
                    "slug": detail["slug"],
                    "name": detail["name"],
                    "category": detail["category"]["slug"],
                    "path": target.relative_to(out).as_posix(),
                }
            )
    with (out / "gallery.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    print(len({r["product_id"] for r in rows}), "products", len(rows), "images")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
