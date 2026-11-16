"""Choose the source groups that form the untouched final benchmark (Task 04.2-Q).

Only newly collected, visually reviewed photos are eligible (never earlier QA images). Whole source groups are taken,
smallest first in a fixed hash order, until each evaluation bucket reaches --per-bucket photos; at most --cap photos
of one group count towards the benchmark. Run once, before any training on the final dataset; the output file is the
benchmark definition.

    python training/data/select_final_groups.py training/.data/realphoto-v1 > <root>/final_groups.txt
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path

BUCKETS = {
    "phones-tablets": {"smartphones", "tablets", "smartwatches"},
    "laptops-mice-keyboards": {"laptops", "keyboards-mice"},
    "components-storage": {"computer-components", "storage-ssds"},
    "cameras-gaming-entertainment": {"cameras-photography", "gaming", "monitors", "headphones", "speakers-audio"},
    "networking-smart-home": {"networking-wifi", "smart-home", "printers-scanners"},
    "unsupported": {"other"},
}


def reviewed(root: Path) -> list[dict[str, str]]:
    review = json.loads((root / "review_keep.json").read_text(encoding="utf-8"))
    position: Counter[str] = Counter()
    out = []
    for row in csv.DictReader((root / "provenance.csv").open(encoding="utf-8")):
        n = position[row["label"]]
        position[row["label"]] += 1
        decision = review.get(row["label"], {})
        if "drop" in decision:
            kept = n <= decision["reviewedThrough"] and n not in decision["drop"]
        else:
            kept = n in decision.get("keep", [])
        label = decision.get("relabel", {}).get(str(n)) or (row["label"] if kept else None)
        if label:
            out.append({**row, "category": label})
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    parser.add_argument("--per-bucket", type=int, default=15)
    parser.add_argument("--cap", type=int, default=3)
    args = parser.parse_args()
    rows = reviewed(args.root)
    groups: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        groups[row["source_group"]].append(row)
    chosen: set[str] = set()
    for classes in BUCKETS.values():
        have = 0
        candidates = sorted(
            (g for g, items in groups.items() if g not in chosen and any(i["category"] in classes for i in items)),
            key=lambda g: (len(groups[g]), hashlib.sha256(g.encode()).hexdigest()),
        )
        for group in candidates:
            if have >= args.per_bucket:
                break
            # A group joins only when all its photos belong to this bucket, so it never counts towards two buckets.
            if not all(i["category"] in classes for i in groups[group]):
                continue
            chosen.add(group)
            have += min(len(groups[group]), args.cap)
    print("\n".join(sorted(chosen)))


if __name__ == "__main__":
    main()
