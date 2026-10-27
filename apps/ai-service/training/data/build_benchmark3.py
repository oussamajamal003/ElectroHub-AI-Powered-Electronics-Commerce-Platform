"""Split a new reviewed collection into extra dev photos and a fresh locked final benchmark (Task 04.2-Q round 3).

A candidate photo is excluded when its file hash, source page, Commons page or source group (photographer/uploader)
appears in any earlier collection or dataset, or when its 64-bit difference hash is within Hamming 6 of any earlier
image (training/dev photos, both earlier benchmarks, catalog gallery, owner regression photos) or of a photo already
kept. Whole source groups are then assigned, in a fixed hash order: the benchmark takes groups until each class
reaches its target (at most --cap photos per group); the remaining phone/tablet groups become extra dev photos. Other
leftovers are not used. The benchmark is never read by training or selection and is never rebuilt once locked.

Labels (labels.json, visual review): {"<sha256>": {"family": "...", "skuVisible": bool, "productIds": [...]}}.
Rows without a family label keep family "" (category-level only).

    python training/data/build_benchmark3.py training/.data/realphoto-v3 training/.data/final-benchmark-3 \
        training/.data/realphoto-v3/dev --earlier training/.data/realphoto-v1 training/.data/realphoto-final2 \
        --earlier-images <dir> ... \\
        --commons-provenance training/.data/kaggle-run2/dataset/manifests/image_provenance.csv
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path

from build_realphoto_dataset import dhash, save_rgb  # type: ignore[import-not-found]
from PIL import Image
from select_final_groups import reviewed  # type: ignore[import-not-found]

FIELDS = (
    "image_id",
    "path",
    "category",
    "family",
    "stocked",
    "evaluation_group",
    "expected",
    "sku_visible",
    "product_ids",
    "source_group",
    "licence",
    "licence_url",
    "creator",
    "landing_url",
    "sha256",
)
DEV_CLASSES = ("smartphones", "tablets")
UNSTOCKED = "unstocked"
OTHER = "other"


def image_codes(directories: list[Path]) -> list[int]:
    codes = []
    for directory in directories:
        for path in sorted(p for p in directory.rglob("*") if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp")):
            try:
                with Image.open(path) as image:
                    codes.append(dhash(image))
            except OSError:
                continue
    return codes


def targets(spec: str) -> dict[str, int]:
    return {name: int(n) for name, n in (part.split("=") for part in spec.split(","))}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("dev_out", type=Path)
    parser.add_argument("--earlier", type=Path, nargs="+", required=True, help="earlier collection roots")
    parser.add_argument("--earlier-images", type=Path, nargs="+", required=True, help="every earlier image folder")
    parser.add_argument("--commons-provenance", type=Path, required=True)
    parser.add_argument("--cap", type=int, default=2)
    parser.add_argument("--dev-cap", type=int, default=3)
    parser.add_argument(
        "--targets",
        default="smartphones=15,tablets=15,unstocked=15,other=15,laptops=6,keyboards-mice=5,speakers-audio=5,"
        "networking-wifi=5,gaming=5,cameras-photography=4,headphones=4,smartwatches=4,monitors=3,"
        "printers-scanners=3,smart-home=4,storage-ssds=3,computer-components=3",
    )
    args = parser.parse_args()
    if (args.out / "lock.json").exists():
        raise SystemExit("benchmark is locked; refusing to rebuild it")

    old_keys: set[str] = set()
    old_groups: set[str] = set()
    for root in args.earlier:
        for r in csv.DictReader((root / "provenance.csv").open(encoding="utf-8")):
            old_keys |= {r["sha256"], f"{r['source']}:{r['source_id']}", r["landing_url"]}
            old_groups.add(r["source_group"])
    for r in csv.DictReader(args.commons_provenance.open(encoding="utf-8")):
        old_keys |= {r["sha256"], r["file_page"]}
        old_groups.add(f"commons:{r['uploader']}")
    old_codes = image_codes(args.earlier_images)
    labels_file = args.root / "labels.json"
    labels = json.loads(labels_file.read_text(encoding="utf-8")) if labels_file.exists() else {}

    excluded: Counter[str] = Counter()
    by_group: dict[str, list[dict[str, str]]] = defaultdict(list)
    codes: list[int] = []
    staging = args.out / "_staging"
    for row in sorted(reviewed(args.root), key=lambda r: hashlib.sha256(r["sha256"].encode()).hexdigest()):
        if {row["sha256"], f"{row['source']}:{row['source_id']}", row["landing_url"]} & old_keys:
            excluded["same file or page as earlier data"] += 1
            continue
        if row["source_group"] in old_groups:
            excluded["source group already used"] += 1
            continue
        target = staging / f"{row['sha256'][:16]}.jpg"
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
        by_group[row["source_group"]].append({**row, "staged": str(target)})

    want = targets(args.targets)
    bench: list[dict[str, str]] = []
    dev: list[dict[str, str]] = []
    count: Counter[str] = Counter()
    for group in sorted(by_group, key=lambda g: hashlib.sha256(g.encode()).hexdigest()):
        rows = by_group[group]
        needed = [r for r in rows if count[r["category"]] < want.get(r["category"], 0)]
        if needed:
            for r in needed[: args.cap]:
                count[r["category"]] += 1
                bench.append(r)
        else:
            dev.extend(r for r in rows[: args.dev_cap] if r["category"] in DEV_CLASSES)

    def write(rows: list[dict[str, str]], folder: Path, prefix: str) -> list[dict[str, str]]:
        out = []
        for r in rows:
            image = folder / "images" / f"{prefix}-{r['sha256'][:16]}.jpg"
            image.parent.mkdir(parents=True, exist_ok=True)
            Path(r["staged"]).replace(image)
            label = labels.get(r["sha256"], {})
            stocked = r["category"] not in (UNSTOCKED, OTHER)
            out.append(
                {
                    "image_id": image.stem,
                    "path": f"images/{image.name}",
                    "category": r["category"] if stocked else OTHER,
                    "family": label.get("family", ""),
                    "stocked": "yes" if stocked else "no",
                    "evaluation_group": "known"
                    if stocked
                    else ("unstocked-electronics" if r["category"] == UNSTOCKED else "unrelated"),
                    "expected": "category match" if stocked else "no match",
                    "sku_visible": "yes" if label.get("skuVisible") else "no",
                    "product_ids": " ".join(label.get("productIds", [])),
                    "source_group": r["source_group"],
                    "licence": r["licence"],
                    "licence_url": r["licence_url"],
                    "creator": r["creator"],
                    "landing_url": r["landing_url"],
                    "sha256": r["sha256"],
                }
            )
        manifest = folder / ("benchmark.csv" if prefix == "fb3" else "dev.csv")
        with manifest.open("w", newline="", encoding="utf-8") as h:
            writer = csv.DictWriter(h, fieldnames=FIELDS)
            writer.writeheader()
            writer.writerows(out)
        (folder / "attributions.md").write_text(
            "\n".join(
                f"- {r['image_id']}: {r['creator']}, {r['licence']} ({r['licence_url']}) {r['landing_url']}"
                for r in out
            )
            + "\n",
            encoding="utf-8",
        )
        return out

    bench_rows = write(bench, args.out, "fb3")
    dev_rows = write(dev, args.dev_out, "dev3")
    for leftover in staging.glob("*.jpg"):
        leftover.unlink()
    staging.rmdir()
    files = [*sorted(args.out.rglob("*.jpg")), args.out / "benchmark.csv"]
    lock = {
        "photos": len(bench_rows),
        "perGroup": dict(Counter(r["evaluation_group"] for r in bench_rows)),
        "perClass": dict(sorted(count.items())),
        "familyLabelled": sum(bool(r["family"]) for r in bench_rows),
        "excluded": dict(excluded),
        "sha256": {p.relative_to(args.out).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in files},
    }
    (args.out / "lock.json").write_text(json.dumps(lock, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    summary = {k: lock[k] for k in ("photos", "perGroup", "perClass", "familyLabelled", "excluded")}
    summary["dev"] = dict(Counter(r["category"] for r in dev_rows))
    summary["benchmarkCsvSha256"] = lock["sha256"]["benchmark.csv"]
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
