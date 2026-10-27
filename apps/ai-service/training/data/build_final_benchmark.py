"""Build and lock a fresh, independent final benchmark (Task 04.2-Q correction round).

Inputs: a new collection root (realphoto_collect.py output + review_keep.json, same format as the training dataset)
and every earlier source that must not leak into it. A new photo is excluded when its file hash, source page or
source group (photographer/uploader) already appears in the earlier collection, or when its 64-bit difference hash is
within Hamming 6 of any earlier dataset photo, catalog illustration or earlier benchmark photo. At most --cap photos
per source group and --per-class photos per class are kept, in a fixed hash order.

The output folder holds benchmark.csv, images/ (re-encoded, no EXIF), attributions.md and lock.json with the
SHA-256 of every file; a locked benchmark is never rebuilt and never used for training or threshold selection.

    python training/data/build_final_benchmark.py training/.data/realphoto-final2 <out> \
        --earlier training/.data/realphoto-v1 --earlier-dataset training/.data/realphoto-v1/dataset
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import Counter
from pathlib import Path

from build_realphoto_dataset import dhash, save_rgb  # type: ignore[import-not-found]
from PIL import Image
from select_final_groups import reviewed  # type: ignore[import-not-found]

FIELDS = ("image_id", "path", "category", "family", "source_group", "licence", "landing_url")


def earlier_hashes(dataset: Path) -> list[int]:
    paths = [*(dataset / "images").rglob("*.jpg"), *(dataset / "final_benchmark" / "images").rglob("*.jpg")]
    codes = []
    for path in paths:
        with Image.open(path) as image:
            codes.append(dhash(image))
    return codes


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("--earlier", type=Path, required=True, help="earlier collection root (provenance.csv)")
    parser.add_argument("--earlier-dataset", type=Path, required=True, help="earlier built dataset (images + final)")
    parser.add_argument("--cap", type=int, default=2)
    parser.add_argument("--per-class", type=int, default=8)
    args = parser.parse_args()
    if (args.out / "lock.json").exists():
        raise SystemExit("benchmark is locked; refusing to rebuild it")

    old = list(csv.DictReader((args.earlier / "provenance.csv").open(encoding="utf-8")))
    old_keys = {r["sha256"] for r in old} | {f"{r['source']}:{r['source_id']}" for r in old}
    old_groups = {r["source_group"] for r in old}
    old_codes = earlier_hashes(args.earlier_dataset)

    candidates = sorted(reviewed(args.root), key=lambda r: hashlib.sha256(r["sha256"].encode()).hexdigest())
    kept: list[dict[str, str]] = []
    per_group: Counter[str] = Counter()
    per_class: Counter[str] = Counter()
    excluded: Counter[str] = Counter()
    codes: list[int] = []
    images = args.out / "images"
    for row in candidates:
        if row["sha256"] in old_keys or f"{row['source']}:{row['source_id']}" in old_keys:
            excluded["same file or page as earlier data"] += 1
            continue
        if row["source_group"] in old_groups:
            excluded["source group already used"] += 1
            continue
        if per_group[row["source_group"]] >= args.cap or per_class[row["category"]] >= args.per_class:
            excluded["group or class cap"] += 1
            continue
        target = images / f"fb2-{row['sha256'][:16]}.jpg"
        try:
            code = dhash(save_rgb(args.root / "raw" / row["file"], target))
        except OSError:
            excluded["unreadable"] += 1
            continue
        if any(bin(code ^ c).count("1") <= 6 for c in (*old_codes, *codes)):
            target.unlink()
            excluded["near-duplicate"] += 1
            continue
        codes.append(code)
        per_group[row["source_group"]] += 1
        per_class[row["category"]] += 1
        kept.append(
            {
                "image_id": target.stem,
                "path": f"images/{target.name}",
                "category": row["category"],
                "family": "",
                "source_group": row["source_group"],
                "licence": row["licence"],
                "landing_url": row["landing_url"],
            }
        )

    with (args.out / "benchmark.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(kept)
    (args.out / "attributions.md").write_text(
        "# Final benchmark 2 attributions\n\n"
        + "\n".join(f"- {r['image_id']}: {r['licence']} {r['landing_url']}" for r in kept)
        + "\n",
        encoding="utf-8",
    )
    files = [*sorted(args.out.rglob("*.jpg")), args.out / "benchmark.csv"]
    lock = {
        "photos": len(kept),
        "perClass": dict(sorted(per_class.items())),
        "excluded": dict(excluded),
        "sha256": {p.relative_to(args.out).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in files},
    }
    (args.out / "lock.json").write_text(json.dumps(lock, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({k: lock[k] for k in ("photos", "perClass", "excluded")}, indent=1))


if __name__ == "__main__":
    main()
