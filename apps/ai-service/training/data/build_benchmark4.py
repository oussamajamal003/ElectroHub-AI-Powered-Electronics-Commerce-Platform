"""Split the reviewed open-set collection into dev photos and a fresh locked final benchmark (Task 04.2-Q round 4).

Classes are "stocked.<category>", "unstocked.<family>" (unsold device families used for development), "unseen.<family>"
(unsold families reserved for the benchmark: never written to dev, never named in the taxonomy prompts) and "other"
(unrelated objects). Exclusion against every earlier collection, benchmark and image folder works as in
build_benchmark3.py (file hash, source page, source group, difference hash within Hamming 6). Whole source groups are
then assigned in a fixed hash order: a group goes to the benchmark while any of its classes still needs photos (at most
--cap photos per group, the rest of that group is discarded so no group is split), otherwise to dev (at most --dev-cap
photos per group; unseen photos are never used for dev). The benchmark is never read by selection and is never rebuilt
once locked.

    python training/data/build_benchmark4.py training/.data/realphoto-v4 training/.data/final-benchmark-4 \
        training/.data/realphoto-v4/dev --earlier <roots> --earlier-images <dirs> --commons-provenance <csv>
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path

from build_benchmark3 import image_codes  # type: ignore[import-not-found]
from build_realphoto_dataset import dhash, save_rgb  # type: ignore[import-not-found]
from select_final_groups import reviewed  # type: ignore[import-not-found]

FIELDS = (
    "image_id",
    "path",
    "class",
    "category",
    "family",
    "evaluation_group",
    "expected",
    "source_group",
    "licence",
    "licence_url",
    "creator",
    "landing_url",
    "sha256",
)
GROUPS = {
    "stocked": "known",
    "unstocked": "unstocked-electronics",
    "unseen": "unstocked-electronics",
    "other": "unrelated",
}


def describe(label: str) -> dict[str, str]:
    kind, _, name = label.partition(".")
    return {
        "class": label,
        "category": name if kind == "stocked" else "other",
        "family": name if kind in ("unstocked", "unseen") else "",
        "evaluation_group": GROUPS[kind],
        "expected": "category match" if kind == "stocked" else "no match",
    }


def target(label: str, args: argparse.Namespace) -> int:
    kind = label.partition(".")[0]
    return {"stocked": args.stocked, "unstocked": args.unstocked, "unseen": args.unseen, "other": args.other}[kind]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("dev_out", type=Path)
    parser.add_argument("--earlier", type=Path, nargs="+", required=True)
    parser.add_argument("--earlier-images", type=Path, nargs="+", required=True)
    parser.add_argument("--commons-provenance", type=Path, required=True)
    parser.add_argument("--cap", type=int, default=2)
    parser.add_argument("--dev-cap", type=int, default=4)
    parser.add_argument("--stocked", type=int, default=7, help="benchmark photos per stocked category")
    parser.add_argument("--unstocked", type=int, default=3, help="benchmark photos per development unstocked family")
    parser.add_argument("--unseen", type=int, default=8, help="benchmark photos per reserved unseen family")
    parser.add_argument("--other", type=int, default=40)
    parser.add_argument("--bench-prefix", default="fb4", help="image id prefix for benchmark photos")
    parser.add_argument("--dev-prefix", default="dev4", help="image id prefix for development photos")
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

    excluded: Counter[str] = Counter()
    by_group: dict[str, list[dict[str, str]]] = defaultdict(list)
    codes: list[int] = []
    seen_sha: set[str] = set()
    staging = args.out / "_staging"
    for row in sorted(reviewed(args.root), key=lambda r: hashlib.sha256(r["sha256"].encode()).hexdigest()):
        if (
            row["sha256"] in seen_sha
            or {row["sha256"], f"{row['source']}:{row['source_id']}", row["landing_url"]} & old_keys
        ):
            excluded["same file or page as earlier data"] += 1
            continue
        if row["source_group"] in old_groups:
            excluded["source group already used"] += 1
            continue
        target_path = staging / f"{row['sha256'][:16]}.jpg"
        try:
            code = dhash(save_rgb(args.root / "raw" / row["file"], target_path))
        except OSError:
            excluded["unreadable"] += 1
            continue
        if any(bin(code ^ c).count("1") <= 6 for c in (*old_codes, *codes)):
            target_path.unlink()
            excluded["near-duplicate"] += 1
            continue
        seen_sha.add(row["sha256"])
        codes.append(code)
        by_group[row["source_group"]].append({**row, "staged": str(target_path)})

    bench: list[dict[str, str]] = []
    dev: list[dict[str, str]] = []
    count: Counter[str] = Counter()
    for group in sorted(by_group, key=lambda g: hashlib.sha256(g.encode()).hexdigest()):
        rows = by_group[group]
        needed = [r for r in rows if count[r["category"]] < target(r["category"], args)]
        if needed:
            for r in needed[: args.cap]:
                count[r["category"]] += 1
                bench.append(r)
        else:
            dev.extend([r for r in rows if not r["category"].startswith("unseen.")][: args.dev_cap])

    def write(rows: list[dict[str, str]], folder: Path, prefix: str, manifest: str) -> list[dict[str, str]]:
        out = []
        for r in rows:
            image = folder / "images" / f"{prefix}-{r['sha256'][:16]}.jpg"
            image.parent.mkdir(parents=True, exist_ok=True)
            Path(r["staged"]).replace(image)
            out.append(
                {
                    "image_id": image.stem,
                    "path": f"images/{image.name}",
                    **describe(r["category"]),
                    **{k: r[k] for k in ("source_group", "licence", "licence_url", "creator", "landing_url", "sha256")},
                }
            )
        with (folder / manifest).open("w", newline="", encoding="utf-8") as h:
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

    bench_rows = write(bench, args.out, args.bench_prefix, "benchmark.csv")
    dev_rows = write(dev, args.dev_out, args.dev_prefix, "dev.csv")
    for leftover in staging.glob("*.jpg"):
        leftover.unlink()
    staging.rmdir()
    files = [*sorted(args.out.rglob("*.jpg")), args.out / "benchmark.csv"]
    lock = {
        "photos": len(bench_rows),
        "perGroup": dict(Counter(r["evaluation_group"] for r in bench_rows)),
        "perClass": dict(sorted(Counter(r["class"] for r in bench_rows).items())),
        "excluded": dict(excluded),
        "sha256": {p.relative_to(args.out).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in files},
    }
    (args.out / "lock.json").write_text(json.dumps(lock, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    summary = {k: lock[k] for k in ("photos", "perGroup", "perClass", "excluded")}
    summary["dev"] = dict(sorted(Counter(r["class"] for r in dev_rows).items()))
    summary["devGroups"] = len({r["source_group"] for r in dev_rows})
    summary["benchmarkCsvSha256"] = lock["sha256"]["benchmark.csv"]
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
