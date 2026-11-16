"""Collect licensed real product photographs by visual class (Task 04.2-Q dataset expansion).

Sources: Wikimedia Commons (MediaWiki API, licence from extmetadata) and Openverse (CC catalogue API, mostly Flickr).
Only CC0, public-domain marks, CC BY and CC BY-SA are kept (no NC/ND). Each source is called at most once per second
with a descriptive User-Agent. Images are stored as downloaded (<= 800 px renditions where the source offers them);
provenance goes to provenance.csv, one row per file. Labels are the search's intended class and MUST be reviewed
visually before use (review_sheets.py / review decisions file).

    python training/data/realphoto_collect.py training/.data/realphoto-v1 --per-query 30
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

UA = "ElectroHubVisionDataset/0.2 (portfolio research; contact ouss03zam@gmail.com) python-urllib"
COMMONS = "https://commons.wikimedia.org/w/api.php"
OPENVERSE = "https://api.openverse.org/v1/images/"
ALLOWED_HOSTS = (
    "https://upload.wikimedia.org/",
    "https://thumb.wikimedia.org/",
    "https://live.staticflickr.com/",
    "https://farm",
)
COMMONS_LICENCE = re.compile(r"^(CC0|Public domain|PD.*|CC BY(-SA)? [0-9.]+.*)$", re.IGNORECASE)
OPENVERSE_LICENCES = "by,by-sa,cc0,pdm"
# Titles that announce a non-photograph (renders, mock-ups, artwork, documents) are skipped before download.
NOT_A_PHOTO = re.compile(
    r"mock-?up|render|3d model|logo|icon|diagram|drawing|illustration|clip ?art|vector|screenshot|chart|map|poster",
    re.IGNORECASE,
)

# Visual class -> search queries. Classes are catalog category slugs, plus "other" for objects the catalog does not
# sell. Unsold electronics that a shopper would reasonably map to a catalog category are labelled with it (consoles ->
# gaming, Wi-Fi extenders -> networking-wifi, televisions -> monitors).
QUERIES: dict[str, list[str]] = {
    "cameras-photography": ["Canon EOS mirrorless camera", "mirrorless camera body", "DSLR camera", "Canon EOS R"],
    "computer-components": ["AMD Ryzen processor", "CPU processor chip", "desktop CPU", "Intel Core processor"],
    "gaming": ["PlayStation 5 console", "handheld gaming PC", "gaming headset", "Xbox console", "Nintendo Switch"],
    "headphones": ["over-ear headphones", "wireless earbuds", "noise cancelling headphones"],
    "keyboards-mice": ["computer mouse", "wireless mouse", "Logitech mouse", "computer keyboard", "Logitech keyboard"],
    "laptops": ["laptop computer", "MacBook Air", "ThinkPad laptop", "notebook computer"],
    "monitors": ["computer monitor", "LCD monitor", "flat screen television"],
    "networking-wifi": ["wireless router", "TP-Link router", "WiFi router", "network switch", "WiFi range extender"],
    "printers-scanners": ["laser printer", "Brother printer", "document scanner", "inkjet printer"],
    "smart-home": ["security camera indoor", "smart plug", "smart bulb", "IP camera", "Tapo camera"],
    "smartphones": ["iPhone", "Samsung Galaxy smartphone", "smartphone"],
    "smartwatches": ["Apple Watch", "Galaxy Watch", "smartwatch"],
    "speakers-audio": ["JBL speaker", "bluetooth speaker", "portable speaker", "soundbar"],
    "storage-ssds": ["Samsung SSD", "M.2 NVMe SSD", "2.5 inch SSD", "portable SSD", "solid state drive"],
    "tablets": ["iPad", "Galaxy Tab", "tablet computer", "Android tablet"],
    "other": [
        "washing machine",
        "refrigerator",
        "microwave oven",
        "electric kettle",
        "toaster",
        "hair dryer",
        "vacuum cleaner",
        "electric fan",
        "desk lamp",
        "wristwatch",
        "book",
        "sneakers",
        "coffee mug",
        "chair",
        "backpack",
        "sunglasses",
        "water bottle",
        "potted plant",
    ],
}


def _get(url: str) -> Any:
    time.sleep(1.0)
    request = urllib.request.Request(url, headers={"User-Agent": UA})  # noqa: S310 -- fixed https API hosts
    with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310
        return json.load(response)


def _download(url: str) -> bytes | None:
    if not url.startswith(ALLOWED_HOSTS):
        return None
    time.sleep(0.5)
    request = urllib.request.Request(url, headers={"User-Agent": UA})  # noqa: S310 -- host allow-listed above
    try:
        with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310
            data: bytes = response.read(20 * 1024 * 1024)
            return data
    except OSError:
        return None


def commons(query: str, limit: int) -> list[dict[str, str]]:
    params = {
        "action": "query",
        "format": "json",
        "formatversion": "2",
        "generator": "search",
        "gsrsearch": f"{query} filetype:bitmap",
        "gsrnamespace": "6",
        "gsrlimit": "50",
        "prop": "imageinfo",
        "iiprop": "url|mime|extmetadata|size|user",
        "iiurlwidth": "800",
    }
    body = _get(f"{COMMONS}?{urllib.parse.urlencode(params)}")
    out = []
    for page in sorted(body.get("query", {}).get("pages", []), key=lambda p: p.get("index", 0)):
        info = (page.get("imageinfo") or [{}])[0]
        meta = info.get("extmetadata", {})
        licence = meta.get("LicenseShortName", {}).get("value", "")
        if info.get("mime") not in ("image/jpeg", "image/png") or not COMMONS_LICENCE.match(licence):
            continue
        if min(info.get("width", 0), info.get("height", 0)) < 300:
            continue
        artist = re.sub(r"<[^>]+>", "", meta.get("Artist", {}).get("value", "")).strip()
        out.append(
            {
                "source": "commons",
                "source_id": str(page["pageid"]),
                "title": page["title"],
                "landing_url": info.get("descriptionurl", ""),
                "download_url": info.get("thumburl") or info.get("url", ""),
                "licence": licence,
                "licence_url": meta.get("LicenseUrl", {}).get("value", ""),
                "creator": artist[:120],
                "source_group": "commons:" + (info.get("user") or artist or "unknown"),
            }
        )
        if len(out) >= limit:
            break
    return out


def openverse(query: str, limit: int) -> list[dict[str, str]]:
    params = {"q": query, "license": OPENVERSE_LICENCES, "page_size": "20", "mature": "false"}
    out: list[dict[str, str]] = []
    for page in (1, 2):
        try:
            body = _get(f"{OPENVERSE}?{urllib.parse.urlencode({**params, 'page': str(page)})}")
        except OSError:
            break
        for item in body.get("results", []):
            if item.get("source") == "wikimedia":  # Commons is collected directly, with its own licence metadata.
                continue
            if min(item.get("width") or 0, item.get("height") or 0) < 300:
                continue
            version = item.get("license_version") or ""
            out.append(
                {
                    "source": f"openverse:{item.get('source', '')}",
                    "source_id": str(item["id"]),
                    "title": (item.get("title") or "")[:200],
                    "landing_url": item.get("foreign_landing_url", ""),
                    "download_url": item.get("url", ""),
                    "licence": f"{item.get('license', '').upper()} {version}".strip(),
                    "licence_url": item.get("license_url", ""),
                    "creator": (item.get("creator") or "")[:120],
                    "source_group": f"{item.get('source', '')}:{item.get('creator') or 'unknown'}",
                }
            )
            if len(out) >= limit:
                return out
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("out", type=Path)
    parser.add_argument("--per-query", type=int, default=30)
    parser.add_argument("--classes", nargs="*", default=None)
    parser.add_argument("--sources", nargs="+", choices=("commons", "openverse"), default=["commons", "openverse"])
    parser.add_argument("--queries-json", type=Path, help="{class: [query, ...]} replacing the built-in queries")
    args = parser.parse_args()
    out: Path = args.out
    (out / "raw").mkdir(parents=True, exist_ok=True)
    manifest = out / "provenance.csv"
    seen: set[str] = set()
    rows: list[dict[str, str]] = []
    if manifest.exists():
        rows = list(csv.DictReader(manifest.open(encoding="utf-8")))
        seen = {r["sha256"] for r in rows} | {f"{r['source']}:{r['source_id']}" for r in rows}
    plan = json.loads(args.queries_json.read_text(encoding="utf-8")) if args.queries_json else QUERIES
    for label, queries in plan.items():
        if args.classes and label not in args.classes:
            continue
        added = 0
        for query in queries:
            for finder in [{"commons": commons, "openverse": openverse}[name] for name in args.sources]:
                try:
                    candidates = finder(query, args.per_query)
                except OSError as exc:
                    print("search failed", finder.__name__, query, type(exc).__name__, flush=True)
                    continue
                for c in candidates:
                    key = f"{c['source']}:{c['source_id']}"
                    if key in seen or NOT_A_PHOTO.search(c["title"]):
                        continue
                    data = _download(c["download_url"])
                    if not data or len(data) < 8_000:
                        continue
                    digest = hashlib.sha256(data).hexdigest()
                    if digest in seen:
                        continue
                    seen |= {key, digest}
                    ext = ".png" if data[:8] == b"\x89PNG\r\n\x1a\n" else ".jpg"
                    name = f"{label}/{digest[:16]}{ext}"
                    (out / "raw" / label).mkdir(exist_ok=True)
                    (out / "raw" / name).write_bytes(data)
                    rows.append({"file": name, "label": label, "query": query, "sha256": digest, **c})
                    added += 1
            if not rows:
                continue
            with manifest.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
                writer.writeheader()
                writer.writerows(rows)
        print(label, added, flush=True)


if __name__ == "__main__":
    main()
