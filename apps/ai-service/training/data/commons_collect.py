"""Discover Wikimedia Commons candidate photographs for every catalog appearance family (metadata only).

Uses the official MediaWiki API with a descriptive User-Agent and at most one request per second. For each family it
searches the File namespace, fetches imageinfo + extmetadata and keeps raster photographs whose licence is
public-domain, CC0, CC BY or CC BY-SA. Nothing is downloaded here except API JSON; eligibility is decided later by
review. Output: manifests/commons_sources.json (all candidates with the full provenance record and a reject reason).

    python data/commons_collect.py --root <dataset-root>
"""

from __future__ import annotations

import argparse
import csv
import html
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

API = "https://commons.wikimedia.org/w/api.php"
USER_AGENT = "ElectroHubVisionDataset/0.1 (portfolio research; contact ouss03zam@gmail.com) python-urllib"
ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp"}
MIN_SIDE = 320
_last_call = 0.0


def api(params: dict[str, str]) -> dict[str, Any]:
    global _last_call
    wait = 1.0 - (time.monotonic() - _last_call)
    if wait > 0:
        time.sleep(wait)
    # POST keeps long title batches out of the URL (Commons rejects over-long query strings with HTTP 414).
    form = urllib.parse.urlencode({**params, "format": "json", "formatversion": "2", "maxlag": "5"}).encode()
    request = urllib.request.Request(
        API, data=form, headers={"User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded"}
    )
    last_error = ""
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:  # noqa: S310 - fixed Commons API host
                _last_call = time.monotonic()
                body: dict[str, Any] = json.load(response)
            if "error" in body and body["error"].get("code") == "maxlag":
                time.sleep(5 * (attempt + 1))
                continue
            return body
        except OSError as failure:
            last_error = repr(failure)[:200]
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"Commons API unavailable: {last_error}")


def strip_html(value: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", " ", value or "")).strip()


def normalise(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


# Words that describe a listing rather than the physical object; dropped from the identity key.
_STOPWORDS = {
    "launch",
    "disc",
    "edition",
    "gaming",
    "wireless",
    "dual-mode",
    "keyboard",
    "mouse",
    "right-handed",
    "tactile",
    "quiet",
    "usb-c",
}
# Common alternative spellings on Commons for families whose catalog names differ from how photographers title files.
ALIASES = {
    "Apple Watch SE 2 40mm": ["Apple Watch SE (2nd generation)", "Apple Watch SE 2"],
    "Apple iPad 10": ["iPad (10th generation)", "iPad 10th generation"],
    "Apple iPad Air 11 M2": ["iPad Air M2", "iPad Air (6th generation)"],
    "Sony PlayStation 5 Launch Disc Edition": ["PlayStation 5"],
    "Lenovo Go USB-C Wireless Mouse": ["Lenovo Go mouse"],
    "Samsung Galaxy Watch6 40mm": ["Galaxy Watch6", "Galaxy Watch 6"],
}


def _rest(family: str, brand: str) -> str:
    return family[len(brand) :].strip() if family.lower().startswith(brand.lower()) else family


def identity_keys(family: str, brand: str) -> list[str]:
    """Normalised identity strings; a candidate must contain one of them, not followed by another digit."""
    names = [_rest(family, brand), *ALIASES.get(family, [])]
    keys = []
    for name in names:
        words = [
            word
            for word in re.split(r"\s+", name)
            if word.lower() not in _STOPWORDS and not re.fullmatch(r"\d+mm", word)
        ]
        if words and normalise(" ".join(words)):
            keys.append(normalise(" ".join(words)))
    return list(dict.fromkeys(keys))


def matches_identity(haystack: str, keys: list[str], brand: str) -> bool:
    """One identity key must appear, not followed by another digit (R5 vs R50). Weak keys (short, or without a digit,
    e.g. "k120", "go3", "lift") additionally require the brand name, so generic words cannot match unrelated files."""
    for key in keys:
        if not re.search(re.escape(key) + r"(?![0-9])", haystack):
            continue
        weak = len(key) < 6 or not re.search(r"[0-9]", key)
        if not weak or normalise(brand) in haystack:
            return True
    return False


def queries_for(family: str, brand: str) -> list[str]:
    return list(dict.fromkeys([family, _rest(family, brand), *ALIASES.get(family, [])]))


def license_class(short: str) -> str | None:
    value = short.strip().lower()
    if (
        value in {"cc0", "cc-zero", "public domain", "pd"}
        or value.startswith("pd-")
        or value.startswith("public domain")
    ):
        return "public-domain"
    if re.fullmatch(r"cc[ -]by[ -]sa[ -]\d\.\d( [a-z]{2,})?", value):
        return "cc-by-sa"
    if re.fullmatch(r"cc[ -]by[ -]\d\.\d( [a-z]{2,})?", value):
        return "cc-by"
    return None


def search(query: str) -> list[str]:
    body = api({"action": "query", "list": "search", "srnamespace": "6", "srlimit": "50", "srsearch": query})
    return [hit["title"] for hit in body.get("query", {}).get("search", [])]


def imageinfo(titles: list[str]) -> list[dict[str, Any]]:
    pages: list[dict[str, Any]] = []
    for start in range(0, len(titles), 50):
        body = api(
            {
                "action": "query",
                "titles": "|".join(titles[start : start + 50]),
                "prop": "imageinfo",
                "iiprop": "url|sha1|size|mime|user|userid|timestamp|extmetadata",
                "iiurlwidth": "480",
                "iiextmetadatafilter": "LicenseShortName|LicenseUrl|Artist|Credit|AttributionRequired|Copyrighted|"
                "Restrictions|ImageDescription|Categories|DateTimeOriginal|UsageTerms",
            }
        )
        pages.extend(body.get("query", {}).get("pages", []))
    return pages


def record(page: dict[str, Any], family: str, keys: list[str], brand: str) -> dict[str, Any]:
    info = (page.get("imageinfo") or [{}])[0]
    meta = {key: strip_html(value.get("value", "")) for key, value in (info.get("extmetadata") or {}).items()}
    haystack = normalise(" ".join([page["title"], meta.get("ImageDescription", ""), meta.get("Categories", "")]))
    reasons = []
    if info.get("mime") not in ALLOWED_MIME:
        reasons.append(f"mime:{info.get('mime')}")
    if min(info.get("width", 0), info.get("height", 0)) < MIN_SIDE:
        reasons.append("too-small")
    licence = license_class(meta.get("LicenseShortName", ""))
    if licence is None:
        reasons.append(f"licence:{meta.get('LicenseShortName', 'unknown')}")
    if not matches_identity(haystack, keys, brand):
        reasons.append("model-tokens-missing")
    if meta.get("Restrictions"):
        reasons.append(f"restrictions:{meta['Restrictions']}")
    return {
        "family": family,
        "title": page["title"],
        "pageid": page.get("pageid"),
        "file_page": info.get("descriptionurl"),
        "original_url": info.get("url"),
        "thumb_url": info.get("thumburl"),
        "commons_sha1": info.get("sha1"),
        "width": info.get("width"),
        "height": info.get("height"),
        "mime": info.get("mime"),
        "uploader": info.get("user"),
        "uploader_id": info.get("userid"),
        "uploaded_at": info.get("timestamp"),
        "artist": meta.get("Artist", ""),
        "credit": meta.get("Credit", ""),
        "date_original": meta.get("DateTimeOriginal", ""),
        "license_short": meta.get("LicenseShortName", ""),
        "license_url": meta.get("LicenseUrl", ""),
        "license_class": licence,
        "attribution_required": meta.get("AttributionRequired", ""),
        "usage_terms": meta.get("UsageTerms", ""),
        "description": meta.get("ImageDescription", "")[:500],
        "categories": meta.get("Categories", ""),
        "auto_reject": reasons,
    }


def rescore(item: dict[str, Any], keys: list[str], brand: str) -> list[str]:
    reasons = [reason for reason in item["auto_reject"] if reason != "model-tokens-missing"]
    haystack = normalise(" ".join([item["title"], item["description"], item["categories"]]))
    if not matches_identity(haystack, keys, brand):
        reasons.append("model-tokens-missing")
    return reasons


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--rescore", action="store_true", help="re-apply automatic checks to stored metadata only")
    args = parser.parse_args()
    manifests = args.root / "manifests"
    with (manifests / "catalog_products.csv").open(encoding="utf-8") as handle:
        families = {(row["appearance_family"], row["brand"]) for row in csv.DictReader(handle)}
    out_path = manifests / "commons_sources.json"
    existing: dict[str, Any] = json.loads(out_path.read_text(encoding="utf-8")) if out_path.exists() else {}
    if args.rescore:
        for family, entry in existing.items():
            keys = identity_keys(family, entry["brand"])
            entry["keys"] = keys
            for item in entry["candidates"]:
                item["auto_reject"] = rescore(item, keys, entry["brand"])
        out_path.write_text(json.dumps(existing, indent=1, ensure_ascii=False), encoding="utf-8")
        return
    for family, brand in sorted(families):
        if family in existing:
            continue
        keys = identity_keys(family, brand)
        titles: list[str] = []
        for query in queries_for(family, brand):
            titles.extend(search(query))
        titles = list(dict.fromkeys(titles))
        records = [record(page, family, keys, brand) for page in imageinfo(titles) if "missing" not in page]
        existing[family] = {"brand": brand, "keys": keys, "candidates": records}
        kept = sum(1 for item in records if not item["auto_reject"])
        print(f"{family}: {len(records)} hits, {kept} pass automatic checks", flush=True)
        out_path.write_text(json.dumps(existing, indent=1, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
