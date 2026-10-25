"""Read-only snapshot of the customer-visible catalog from the public ElectroHub search API.

Writes manifests/catalog_products.csv with one row per visible SKU plus its appearance family. Only public storefront
fields are read (no users, orders, payments or credentials). Usage:

    python data/catalog_snapshot.py --api http://localhost:5000 --out <dataset-root>
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import urllib.request
from pathlib import Path

# Colour suffix ("— Blue"), storage/memory and connectivity tokens do not change what a photograph can show, so they
# are attributes of one appearance family rather than separate visual identities.
_VARIANT_TOKENS = re.compile(r"\b(\d+\s?(GB|TB)|Wi-?Fi|GPS|Bluetooth Edition|V1|EU|E27)\b", re.IGNORECASE)


def appearance_family(name: str) -> tuple[str, str]:
    base, _, colour = name.partition(" — ")
    family = _VARIANT_TOKENS.sub("", base)
    family = re.sub(r"\s{2,}", " ", family).strip()
    # MacBook Air variants also carry unified-memory size ("M3 16GB 1TB" -> "M3"), already removed above.
    return family, colour.strip()


def fetch_all(api: str) -> list[dict[str, object]]:
    products: list[dict[str, object]] = []
    page = 1
    while True:
        url = f"{api}/api/search/products?pageSize=100&page={page}&sort=name-asc"
        with urllib.request.urlopen(url, timeout=30) as response:  # noqa: S310 - fixed local API URL
            body = json.load(response)
        products.extend(body["data"])
        if page >= body["meta"]["totalPages"]:
            return products
        page += 1


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", default="http://localhost:5000")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    rows = []
    for product in fetch_all(args.api):
        family, colour = appearance_family(str(product["name"]))
        category = product["category"]
        brand = product["brand"]
        rows.append(
            {
                "product_id": product["id"],
                "slug": product["slug"],
                "name": product["name"],
                "brand": brand["name"] if isinstance(brand, dict) else brand,
                "category": category["slug"] if isinstance(category, dict) else category,
                "appearance_family": family,
                "colour": colour,
            }
        )
    rows.sort(key=lambda row: (row["category"], row["appearance_family"], row["name"]))
    out = args.out / "manifests"
    out.mkdir(parents=True, exist_ok=True)
    with (out / "catalog_products.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    families = {row["appearance_family"] for row in rows}
    print(
        json.dumps(
            {"products": len(rows), "families": len(families), "categories": len({row["category"] for row in rows})}
        )
    )


if __name__ == "__main__":
    main()
