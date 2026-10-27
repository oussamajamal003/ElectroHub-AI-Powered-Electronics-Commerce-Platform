"""Downloads reviewed Commons photos, audits duplicates/provenance and writes leakage-resistant splits.

Inputs : manifests/catalog_products.csv, manifests/commons_sources.json, manifests/review.json
Outputs: images/<family>/<pageid>.jpg (Commons rendition, re-encoded JPEG, metadata stripped)
         manifests/{image_provenance,capture_groups,train,validation,test_queries,gallery,
                    unseen_sku_queries,unseen_sku_gallery}.csv, split_audit.json, dataset_report.json,
         license_attributions.md, SHA256SUMS

Independence model (addendum section 4):
  * source family  = normalised original creator (Artist), falling back to the uploader.
  * capture group  = union of: same creator + same capture day, identical Commons SHA-1, and perceptual-hash
                     near-duplicates (Hamming <= PHASH_DISTANCE) across ALL families and creators.
  * A capture group whose members span two families is identity-ambiguous and excluded.
  * Splits are assigned per source family inside an appearance family, so train / validation / test-query photos of
    one product always come from different creators; capture groups never cross partitions.

    python data/build_dataset.py --root <dataset-root>
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import http.client
import io
import json
import re
import time
import urllib.request
from collections import defaultdict
from pathlib import Path
from typing import Any

import imagehash
from commons_collect import USER_AGENT
from PIL import Image, ImageOps
from review_sheets import candidates as reviewable

PHASH_DISTANCE = 8
# Catalog families whose physical appearance is indistinguishable in a photograph share one visual label: every AM5
# Ryzen desktop CPU has the same heat-spreader shape and differs only in printed text. Exact-SKU recognition is not
# claimed for them; relevance is the visual group.
VISUAL_GROUPS = [(re.compile(r"^AMD Ryzen [579] [789]\d{3}"), "AMD Ryzen AM5 desktop processor")]
RENDITION_WIDTH = 960  # one of the thumbnail steps Wikimedia serves (https://w.wiki/GHai)
MAX_QUERIES_PER_SOURCE = 3
_last = 0.0


def slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def visual_family(family: str) -> str:
    return next((label for pattern, label in VISUAL_GROUPS if pattern.match(family)), family)


def creator_key(item: dict[str, Any]) -> str:
    artist = re.sub(r"\b(own work|self-photographed|photo|by)\b", "", str(item.get("artist", "")).lower())
    artist = re.sub(r"[^a-z0-9]", "", artist)
    return artist or f"uploader:{str(item.get('uploader', '')).lower()}"


def capture_day(item: dict[str, Any]) -> str:
    match = re.search(r"(\d{4})[-:](\d{2})[-:](\d{2})", str(item.get("date_original", "")))
    return "-".join(match.groups()) if match else ""


def rendition_url(item: dict[str, Any]) -> str:
    thumb = str(item.get("thumb_url") or "").split("?")[0]
    if int(item.get("width") or 0) > RENDITION_WIDTH and re.search(r"/\d+px-", thumb):
        return re.sub(r"/\d+px-", f"/{RENDITION_WIDTH}px-", thumb, count=1)
    return str(item["original_url"])


def download(url: str, cache: Path) -> bytes:
    global _last
    target = cache / hashlib.sha256(url.encode()).hexdigest()
    if target.exists():
        return target.read_bytes()
    wait = 1.0 - (time.monotonic() - _last)
    if wait > 0:
        time.sleep(wait)
    if not url.startswith(("https://upload.wikimedia.org/", "https://thumb.wikimedia.org/")):
        raise ValueError("only Wikimedia upload URLs are fetched")
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})  # noqa: S310 - https host checked above
    for attempt in range(6):
        try:
            with urllib.request.urlopen(request, timeout=120) as response:  # noqa: S310 - Commons upload host only
                body = response.read()
            break
        except (OSError, http.client.HTTPException):
            if attempt == 5:
                raise
            time.sleep(5 * (attempt + 1))
    _last = time.monotonic()
    target.write_bytes(body)
    return body


class UnionFind:
    def __init__(self) -> None:
        self.parent: dict[str, str] = {}

    def find(self, key: str) -> str:
        self.parent.setdefault(key, key)
        while self.parent[key] != key:
            self.parent[key] = self.parent[self.parent[key]]
            key = self.parent[key]
        return key

    def union(self, a: str, b: str) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[max(ra, rb)] = min(ra, rb)


def write_csv(path: Path, rows: list[dict[str, Any]], fields: list[str]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    args = parser.parse_args()
    root = args.root
    manifests = root / "manifests"
    sources = json.loads((manifests / "commons_sources.json").read_text(encoding="utf-8"))
    review = json.loads((manifests / "review.json").read_text(encoding="utf-8"))
    with (manifests / "catalog_products.csv").open(encoding="utf-8") as handle:
        catalog = list(csv.DictReader(handle))
    category_of = {row["appearance_family"]: row["category"] for row in catalog}

    # 1. Download accepted files (re-encoded, metadata stripped) and compute hashes.
    cache = root / "cache" / "renditions"
    cache.mkdir(parents=True, exist_ok=True)
    images: list[dict[str, Any]] = []
    seen_pages: set[int] = set()  # the same Commons file can surface under several SKU searches; keep it once
    for family, decision in sorted(review.items()):
        accepted = reviewable(sources[family])
        for index in decision.get("accept", []):
            item = accepted[index]
            if item["title"] in decision.get("reject_titles", []):
                continue  # rejected after title/metadata review (e.g. a different model in the same series)
            if item["pageid"] in seen_pages:
                continue
            seen_pages.add(item["pageid"])
            raw = download(rendition_url(item), cache)
            with Image.open(io.BytesIO(raw)) as opened:
                picture = ImageOps.exif_transpose(opened).convert("RGB")
            relative = f"{slug(family)}/{item['pageid']}.jpg"
            target = root / "images" / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            buffer = io.BytesIO()
            picture.save(buffer, "JPEG", quality=95)  # no exif= argument: EXIF/GPS metadata is dropped
            target.write_bytes(buffer.getvalue())
            images.append(
                {
                    **{
                        key: item[key]
                        for key in (
                            "title",
                            "pageid",
                            "file_page",
                            "original_url",
                            "uploader",
                            "uploader_id",
                            "artist",
                            "credit",
                            "date_original",
                            "license_short",
                            "license_url",
                            "license_class",
                            "attribution_required",
                            "commons_sha1",
                        )
                    },
                    "image_id": f"commons-{item['pageid']}",
                    "path": relative,
                    "family": visual_family(family),
                    "sku_family": family,
                    "category": category_of[family],
                    "source_family_id": "src-" + hashlib.sha256(creator_key(item).encode()).hexdigest()[:12],
                    "creator_key": creator_key(item),
                    "capture_day": capture_day(item),
                    "download_sha256": hashlib.sha256(raw).hexdigest(),
                    "sha256": hashlib.sha256(buffer.getvalue()).hexdigest(),
                    "phash": str(imagehash.phash(picture)),
                    "width": picture.width,
                    "height": picture.height,
                    "rendition": "commons-960px" if "px-" in rendition_url(item) else "commons-original",
                    "modifications": "Commons rendition; EXIF-transposed; re-encoded JPEG q95; metadata removed",
                    "training_permission": "yes (licence permits use and adaptation)",
                    "kaggle_private_upload": "yes (private, attribution retained)",
                    "redistribution": "only with attribution"
                    + (" and share-alike" if item["license_class"] == "cc-by-sa" else ""),
                    "review_note": decision.get("notes", {}).get(str(index), decision.get("notes", {}).get("_", "")),
                }
            )
        print(f"downloaded {family}: {len(decision.get('accept', []))}", flush=True)

    # 2. Capture groups: same creator+day, identical bytes, perceptual near-duplicates (across all families).
    groups = UnionFind()
    for image in images:
        groups.find(image["image_id"])
    by_key: dict[tuple[str, ...], list[str]] = defaultdict(list)
    for image in images:
        if image["capture_day"]:
            # A photographer's session is one capture group per product: a store visit covering several different
            # products is not identity leakage, while near-identical files are caught by the hash rules below.
            by_key[("session", image["family"], image["creator_key"], image["capture_day"])].append(image["image_id"])
        by_key[("sha1", image["commons_sha1"])].append(image["image_id"])
        by_key[("sha256", image["sha256"])].append(image["image_id"])
    for members in by_key.values():
        for other in members[1:]:
            groups.union(members[0], other)
    hashes = [(image["image_id"], imagehash.hex_to_hash(image["phash"])) for image in images]
    near_duplicate_pairs = []
    for i, (left, left_hash) in enumerate(hashes):
        for right, right_hash in hashes[i + 1 :]:
            if left_hash - right_hash <= PHASH_DISTANCE:
                groups.union(left, right)
                near_duplicate_pairs.append([left, right, int(left_hash - right_hash)])
    members_of: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for image in images:
        image["capture_group_id"] = "cg-" + groups.find(image["image_id"]).removeprefix("commons-")
        members_of[image["capture_group_id"]].append(image)
    ambiguous = {gid for gid, members in members_of.items() if len({m["family"] for m in members}) > 1}
    for gid in ambiguous:
        for image in members_of[gid]:
            image["excluded"] = "capture group spans several products (identity ambiguous)"
    # A capture group is owned by one source family (the creator of its earliest page) so it can never be split.
    for members in members_of.values():
        owner = min(members, key=lambda m: int(m["pageid"]))["source_family_id"]
        for image in members:
            image["split_source"] = owner

    usable = [image for image in images if not image.get("excluded")]
    by_family: dict[str, dict[str, list[dict[str, Any]]]] = defaultdict(lambda: defaultdict(list))
    for image in usable:
        by_family[image["family"]][image["split_source"]].append(image)

    # 3. Splits per appearance family by independent source family.
    split: dict[str, list[dict[str, Any]]] = defaultdict(list)
    protocol: dict[str, str] = {}
    for family in sorted(by_family):
        creators = sorted(by_family[family].items(), key=lambda kv: (-len(kv[1]), kv[0]))
        if len(creators) >= 3:
            protocol[family] = "known-sku (train + validation + test from 3+ independent creators)"
            *train_sources, (_, validation_images), (_, test_images) = creators
            for _, members in train_sources:
                split["train"].extend(members)
            split["validation"].extend(validation_images[:MAX_QUERIES_PER_SOURCE])
            split["validation_extra"].extend(validation_images[MAX_QUERIES_PER_SOURCE:])
            split["test_queries"].extend(test_images[:MAX_QUERIES_PER_SOURCE])
        elif len(creators) == 2:
            protocol[family] = "unseen-sku (never trained; queries and gallery from 2 independent creators)"
            (_, gallery_images), (_, query_images) = creators
            split["unseen_sku_gallery"].extend(gallery_images)
            split["unseen_sku_queries"].extend(query_images[:MAX_QUERIES_PER_SOURCE])
        else:
            members = creators[0][1]
            if len({m["capture_group_id"] for m in members}) >= 2:
                protocol[family] = "train-only (one creator; positives for metric learning, not evaluable)"
                split["train"].extend(members)
            else:
                protocol[family] = "insufficient (one capture group)"
    # Known-SKU gallery: every non-query image of trained families (train + spare validation images); validation and
    # test queries come from creators absent from this gallery for the same family.
    split["gallery"] = split["train"] + split["validation_extra"]
    # Unseen-SKU gallery also contains the known gallery as distractors.
    split["unseen_sku_gallery"] = split["unseen_sku_gallery"] + split["gallery"]

    # 4. Leakage audit.
    partitions = ["train", "validation", "test_queries", "unseen_sku_queries"]
    group_sets = {name: {image["capture_group_id"] for image in split[name]} for name in partitions}
    leaks = {
        f"{a}|{b}": sorted(group_sets[a] & group_sets[b])
        for i, a in enumerate(partitions)
        for b in partitions[i + 1 :]
        if group_sets[a] & group_sets[b]
    }
    source_leaks = []
    for name in ("validation", "test_queries"):
        for image in split[name]:
            train_sources = {m["split_source"] for m in split["train"] if m["family"] == image["family"]}
            if image["split_source"] in train_sources:
                source_leaks.append([name, image["image_id"]])
    query_gallery_leaks = sorted(
        {image["capture_group_id"] for image in split["test_queries"]}
        & {image["capture_group_id"] for image in split["gallery"]}
    )
    unseen_leaks = sorted(
        {image["family"] for image in split["unseen_sku_queries"]} & {image["family"] for image in split["train"]}
    )
    audit = {
        "capture_group_leaks": leaks,
        "creator_leaks": source_leaks,
        "test_query_gallery_leaks": query_gallery_leaks,
        "unseen_families_in_training": unseen_leaks,
        "near_duplicate_pairs": near_duplicate_pairs,
        "ambiguous_cross_family_groups": sorted(ambiguous),
    }
    audit["passed"] = not (leaks or source_leaks or query_gallery_leaks or unseen_leaks)

    fields = [
        "image_id",
        "path",
        "family",
        "sku_family",
        "category",
        "capture_group_id",
        "source_family_id",
        "sha256",
        "phash",
        "title",
        "file_page",
        "license_short",
    ]
    for name in ("train", "validation", "test_queries", "gallery", "unseen_sku_queries", "unseen_sku_gallery"):
        write_csv(manifests / f"{name}.csv", split[name], fields)
        audit[f"{name}_digest"] = hashlib.sha256((manifests / f"{name}.csv").read_bytes()).hexdigest()
    provenance_fields = [
        "image_id",
        "path",
        "family",
        "sku_family",
        "category",
        "title",
        "pageid",
        "file_page",
        "original_url",
        "uploader",
        "uploader_id",
        "artist",
        "credit",
        "date_original",
        "license_short",
        "license_url",
        "license_class",
        "attribution_required",
        "commons_sha1",
        "download_sha256",
        "sha256",
        "phash",
        "width",
        "height",
        "rendition",
        "modifications",
        "training_permission",
        "kaggle_private_upload",
        "redistribution",
        "source_family_id",
        "capture_group_id",
        "excluded",
        "review_note",
    ]
    write_csv(manifests / "image_provenance.csv", images, provenance_fields)
    write_csv(
        manifests / "capture_groups.csv",
        images,
        ["capture_group_id", "image_id", "family", "source_family_id", "capture_day", "phash"],
    )
    (manifests / "split_audit.json").write_text(json.dumps(audit, indent=2), encoding="utf-8")

    attributions = [
        "# Licence attributions",
        "",
        "All photographs are from Wikimedia Commons. Each is used under the",
        "licence shown; files were resized by Wikimedia and re-encoded without metadata.",
        "",
    ]
    for image in sorted(usable, key=lambda m: (m["family"], int(m["pageid"]))):
        artist = image["artist"] or image["uploader"]
        attributions.append(
            f"- {image['family']}: [{image['title']}]({image['file_page']}) by {artist}, "
            f"{image['license_short']} ({image['license_url'] or 'public domain'})"
        )
    (root / "license_attributions.md").write_text("\n".join(attributions) + "\n", encoding="utf-8")
    with (root / "SHA256SUMS").open("w", encoding="utf-8") as handle:
        for image in sorted(usable, key=lambda m: m["path"]):
            handle.write(f"{image['sha256']}  images/{image['path']}\n")

    families_in = {name: sorted({m["family"] for m in split[name]}) for name in split}
    report = {
        "catalogProducts": len(catalog),
        "catalogFamilies": len({row["appearance_family"] for row in catalog}),
        "commonsCandidates": sum(len(v["candidates"]) for v in sources.values()),
        "autoPassed": sum(1 for v in sources.values() for c in v["candidates"] if not c["auto_reject"]),
        "acceptedImages": len(images),
        "excludedImages": len(images) - len(usable),
        "sourceFamilies": len({m["source_family_id"] for m in usable}),
        "captureGroups": len({m["capture_group_id"] for m in usable}),
        "familiesWithPhotos": len(by_family),
        "protocolByFamily": protocol,
        "splitImages": {name: len(rows) for name, rows in split.items()},
        "splitFamilies": {name: len(v) for name, v in families_in.items()},
        "familiesWithoutCommonsPhotos": sorted({row["appearance_family"] for row in catalog} - set(by_family)),
        "licences": {
            cls: sum(1 for m in usable if m["license_class"] == cls) for cls in ("public-domain", "cc-by", "cc-by-sa")
        },
        "auditPassed": audit["passed"],
    }
    (root / "dataset_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "protocolByFamily"}, indent=1))


if __name__ == "__main__":
    main()
