"""Assemble the Task 04.2-Q training dataset and the untouched final benchmark.

Inputs (all under <root>, git-ignored):
  provenance.csv + raw/          licensed photos from realphoto_collect.py
  review_keep.json               visual review: {class: {"keep"|"drop": [n, ...], "relabel": {"n": "class"}}};
                                 n = position of the row within its collected class. With "keep", anything not kept or
                                 relabelled is excluded; with "drop" (used for the "other" negatives, reviewed up to
                                 "reviewedThrough"), everything reviewed except the listed rows is kept.
  gallery/gallery.csv + images/  catalog illustrations (gallery_snapshot.py), the deployment gallery
  --commons <dir>                the earlier reviewed Commons dataset (kaggle-run2/dataset), family-labelled photos
  --catalog <csv>                catalog_products.csv (product_id -> appearance_family)

Splits are assigned per source group (photographer/uploader), never per image, so no source appears in two of
train / dev / final. Near-duplicates (64-bit difference hash, Hamming <= 6) that would cross splits are dropped from
the evaluation side. The final benchmark is written to its own folder and is never read by training.

Output: <out>/manifests/images.csv, <out>/images/, <out>/license_attributions.md, <out>/dataset_report.json and
<out>/final_benchmark/{benchmark.csv, images/}.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path

from PIL import Image, ImageOps

FIELDS = ("image_id", "path", "category", "family", "product_id", "domain", "source_group", "split")
MAX_SIDE = 800


def dhash(image: Image.Image) -> int:
    small = image.convert("L").resize((9, 8), Image.Resampling.LANCZOS)
    pixels = list(small.getdata())
    bits = 0
    for row in range(8):
        for col in range(8):
            bits = (bits << 1) | (pixels[row * 9 + col] > pixels[row * 9 + col + 1])
    return bits


def group_split(group: str, dev: float, final: float, salt: str) -> str:
    bucket = int(hashlib.sha256(f"{salt}:{group}".encode()).hexdigest()[:8], 16) / 0xFFFFFFFF
    return "final" if bucket < final else "dev" if bucket < final + dev else "train"


def save_rgb(source: Path, target: Path) -> Image.Image:
    with Image.open(source) as opened:
        image = ImageOps.exif_transpose(opened)
        if image.mode in ("RGBA", "LA", "P"):
            image = image.convert("RGBA")
            canvas = Image.new("RGB", image.size, (255, 255, 255))
            canvas.paste(image, mask=image.getchannel("A"))
            image = canvas
        image = image.convert("RGB")
        image.thumbnail((MAX_SIDE, MAX_SIDE))
        target.parent.mkdir(parents=True, exist_ok=True)
        image.save(target, quality=92)  # re-encoded: no EXIF/GPS metadata is kept
        return image


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("--commons", type=Path, required=True)
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument(
        "--used-qa", type=Path, help="CSV of earlier QA photos (probe.csv); their Commons pages are excluded"
    )
    parser.add_argument("--dev", type=float, default=0.15)
    parser.add_argument("--final", type=float, default=0.15)
    parser.add_argument("--salt", default="04.2-Q")
    parser.add_argument(
        "--final-groups", type=Path, help="source groups (one per line) forming the final benchmark; others never do"
    )
    parser.add_argument("--provenance", type=Path, help="snapshot of provenance.csv (default: <root>/provenance.csv)")
    args = parser.parse_args()

    families = {r["product_id"]: r["appearance_family"] for r in csv.DictReader(args.catalog.open(encoding="utf-8"))}
    review = json.loads((args.root / "review_keep.json").read_text(encoding="utf-8"))
    provenance = list(csv.DictReader((args.provenance or args.root / "provenance.csv").open(encoding="utf-8")))
    used_pages = {
        r["image_id"].removeprefix("commons-")
        for name in ("train", "gallery", "unseen_sku_gallery", "validation", "test_queries", "unseen_sku_queries")
        for r in csv.DictReader((args.commons / "manifests" / f"{name}.csv").open(encoding="utf-8"))
    }
    if args.used_qa:
        used_pages |= {
            r["file"].rsplit("-", 1)[1].split(".")[0] for r in csv.DictReader(args.used_qa.open(encoding="utf-8"))
        }
    candidates: list[dict[str, str]] = []
    position: Counter[str] = Counter()
    for row in provenance:
        n = position[row["label"]]
        position[row["label"]] += 1
        decision = review.get(row["label"])
        if decision is None:
            continue
        if "drop" in decision:
            kept = n <= decision["reviewedThrough"] and n not in decision["drop"]
        else:
            kept = n in decision.get("keep", [])
        label = decision.get("relabel", {}).get(str(n)) or (row["label"] if kept else None)
        if label is None or (row["source"] == "commons" and row["source_id"] in used_pages):
            continue
        candidates.append(
            {
                "source_path": str(args.root / "raw" / row["file"]),
                "category": label,
                "family": "",
                "source_group": row["source_group"],
                "attribution": f"{row['title']} by {row['creator'] or 'unknown'} ({row['licence']}) "
                + row["landing_url"],
                "image_id": f"rp-{row['sha256'][:16]}",
            }
        )
    for name in ("train", "gallery", "unseen_sku_gallery", "validation", "test_queries", "unseen_sku_queries"):
        for row in csv.DictReader((args.commons / "manifests" / f"{name}.csv").open(encoding="utf-8")):
            candidates.append(
                {
                    "source_path": str(args.commons / "images" / row["path"]),
                    "category": row["category"],
                    "family": row["sku_family"],
                    "source_group": f"commons-src:{row['source_family_id']}",
                    "attribution": f"{row['title']} ({row['license_short']}) {row['file_page']}",
                    "image_id": row["image_id"],
                    "earlier_qa": "1",  # used by earlier evaluations: never part of the new final benchmark
                }
            )

    rows: list[dict[str, str]] = []
    attributions: list[str] = []
    hashes: dict[str, list[tuple[int, str]]] = defaultdict(list)
    final_groups = set(args.final_groups.read_text(encoding="utf-8").splitlines()) if args.final_groups else None
    seen_ids: set[str] = set()
    for c in candidates:
        if c["image_id"] in seen_ids:  # the earlier Commons manifests list some images twice (train and gallery)
            continue
        seen_ids.add(c["image_id"])
        split = group_split(c["source_group"], args.dev, args.final, args.salt)
        if final_groups is not None:
            split = "final" if c["source_group"] in final_groups else "dev" if split == "final" else split
        if split == "final" and c.get("earlier_qa"):
            split = "dev"
        target = (
            args.out / "final_benchmark" / "images" / f"{c['image_id']}.jpg"
            if split == "final"
            else args.out / "images" / "photos" / f"{c['image_id']}.jpg"
        )
        try:
            image = save_rgb(Path(c["source_path"]), target)
        except OSError:
            continue
        code = dhash(image)
        clash = [s for h, s in hashes[c["category"]] if bin(h ^ code).count("1") <= 6 and s != split]
        if clash and split != "train":
            target.unlink()
            continue
        hashes[c["category"]].append((code, split))
        rows.append(
            {
                "image_id": c["image_id"],
                "path": target.relative_to(args.out / ("final_benchmark" if split == "final" else "")).as_posix(),
                "category": c["category"],
                "family": c["family"],
                "product_id": "",
                "domain": "photo",
                "source_group": c["source_group"],
                "split": split,
            }
        )
        attributions.append(f"- {c['image_id']}: {c['attribution']}")

    for row in csv.DictReader((args.root / "gallery" / "gallery.csv").open(encoding="utf-8")):
        target = args.out / "images" / "catalog" / f"{row['product_image_id']}.jpg"
        save_rgb(args.root / "gallery" / row["path"], target)
        rows.append(
            {
                "image_id": row["product_image_id"],
                "path": target.relative_to(args.out / "images").as_posix(),
                "category": row["category"],
                "family": families.get(row["product_id"], row["name"]),
                "product_id": row["product_id"],
                "domain": "catalog",
                "source_group": "electrohub-catalog",
                "split": "train",
            }
        )
    for row in rows:
        if row["domain"] == "photo" and row["split"] != "final":
            row["path"] = row["path"].removeprefix("images/")

    (args.out / "manifests").mkdir(parents=True, exist_ok=True)
    with (args.out / "manifests" / "images.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(r for r in rows if r["split"] != "final")
    final_rows = [r for r in rows if r["split"] == "final"]
    with (args.out / "final_benchmark" / "benchmark.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(final_rows)
    (args.out / "license_attributions.md").write_text(
        "# Image attributions (CC0 / public domain / CC BY / CC BY-SA)\n\n" + "\n".join(attributions) + "\n",
        encoding="utf-8",
    )
    report = {
        split: dict(Counter(r["category"] for r in rows if r["split"] == split and r["domain"] == "photo"))
        for split in ("train", "dev", "final")
    }
    groups = {s: len({r["source_group"] for r in rows if r["split"] == s and r["domain"] == "photo"}) for s in report}
    overlap = {r["source_group"] for r in rows if r["split"] == "train" and r["domain"] == "photo"} & {
        r["source_group"] for r in rows if r["split"] in ("dev", "final")
    }
    summary = {"photosPerSplit": report, "sourceGroups": groups, "crossSplitSourceGroups": len(overlap)}
    (args.out / "dataset_report.json").write_text(json.dumps(summary, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps(summary, indent=1, sort_keys=True))


if __name__ == "__main__":
    main()
