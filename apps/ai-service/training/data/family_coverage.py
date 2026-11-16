"""Check that every catalog product falls into exactly one supported device family (Task 04.2-Q taxonomy).

Reads the public product API responses saved by gallery_snapshot.py (the authoritative catalog view: category,
name and specifications) and training/taxonomy/device_families.json. A product belongs to a family when its category
is one of the family's categories and, if the family has a ``match`` pattern, the pattern is found in the product name
or its "Device type" specification. Run it after catalog changes (Task 04.3 / admin additions): a product with no
family, or with two, fails the check and the taxonomy must be extended before a new gate is built.

    python training/data/family_coverage.py \
        training/.data/realphoto-v1/gallery/api training/taxonomy/device_families.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any


def device_type(product: dict[str, Any]) -> str:
    for group in product.get("specifications") or []:
        for item in group.get("items", []):
            if str(item.get("name", "")).lower() == "device type":
                return str(item.get("value", ""))
    return ""


def families_of(product: dict[str, Any], taxonomy: dict[str, Any]) -> list[str]:
    category = product["category"]["slug"]
    text = f"{product['name']} {device_type(product)}"
    found = []
    for family in taxonomy["supported"]:
        categories = family["category"] if isinstance(family["category"], list) else [family["category"]]
        if category in categories and ("match" not in family or re.search(family["match"], text)):
            found.append(family["family"])
    return found


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("api_dir", type=Path, help="per-product API JSON files")
    parser.add_argument("taxonomy", type=Path)
    args = parser.parse_args()
    taxonomy = json.loads(args.taxonomy.read_text(encoding="utf-8"))
    coverage: Counter[str] = Counter()
    problems = []
    for path in sorted(args.api_dir.glob("*.json")):
        raw = json.loads(path.read_text(encoding="utf-8"))
        product = raw.get("data", raw)
        if not isinstance(product, dict) or "category" not in product:
            continue
        found = families_of(product, taxonomy)
        if len(found) != 1:
            problems.append(f"{product['name']} ({product['category']['slug']}): {found or 'no family'}")
        coverage.update(found)
    supported = {f["family"] for f in taxonomy["supported"]}
    print(
        json.dumps(
            {
                "products": sum(coverage.values()),
                "perFamily": dict(sorted(coverage.items())),
                "familiesWithoutProducts": sorted(supported - set(coverage)),
                "problems": problems,
            },
            indent=1,
        )
    )
    if problems:
        sys.exit(1)


if __name__ == "__main__":
    main()
