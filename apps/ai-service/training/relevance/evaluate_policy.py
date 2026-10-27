"""Evaluate an encoder + relevance gate + Express category rerank exactly as served (Task 04.2-Q).

Every image goes through app.processors.image.decode_image and the serving preprocessing; the gallery is the 412
catalog illustrations (gallery_snapshot.py), grouped per product by maximum similarity, as pgvector does. The policy is
the shipped one: reject when electronics mass < min_mass; keep the top-K products within `gap` of the best; Express
reorders those by similarity + weight * hint(category).

    python training/relevance/evaluate_policy.py encode --model models/effb0-commons-v2 \
        --relevance models/relevance-imagenet-v1 --gallery <gallery dir> --queries <csv> --root <image root> --out x.npz
    python training/relevance/evaluate_policy.py score x.npz --min-mass 0.08 --gap 0.1 --weight 0.5
"""

from __future__ import annotations

import argparse
import csv
import json
import time
from pathlib import Path
from typing import Any

import numpy as np

from app.models.siglip_loader import load_encoder
from app.processors.image import decode_image

TOP_K = 12


def _encode(encoder: Any, path: Path) -> tuple[np.ndarray, float, dict[str, float], float]:
    started = time.perf_counter()
    image = decode_image(path.read_bytes(), max_pixels=40_000_000)
    vector, assessment = encoder.encode_assessed(image)
    elapsed = time.perf_counter() - started
    if assessment is None:
        return np.array(vector), 1.0, {}, elapsed
    return np.array(vector), assessment.electronics_mass, dict(assessment.category_hints), elapsed


def encode(args: argparse.Namespace) -> None:
    encoder = load_encoder(args.model, torch_threads=4, relevance_dir=args.relevance)
    gallery = list(csv.DictReader((args.gallery / "gallery.csv").open(encoding="utf-8")))
    g = np.stack([_encode(encoder, args.gallery / r["path"])[0] for r in gallery])
    queries = list(csv.DictReader(args.queries.open(encoding="utf-8")))
    q, mass, hints, latency = [], [], [], []
    for row in queries:
        vector, m, h, elapsed = _encode(encoder, args.root / row["path"])
        q.append(vector)
        mass.append(m)
        hints.append(json.dumps(h))
        latency.append(elapsed)
    np.savez(
        args.out,
        gallery=g,
        gallery_meta=np.array([json.dumps(r) for r in gallery]),
        queries=np.stack(q),
        query_meta=np.array([json.dumps(r) for r in queries]),
        mass=np.array(mass),
        hints=np.array(hints),
        latency=np.array(latency),
        model=str(args.model),
    )
    print(len(gallery), "gallery", len(queries), "queries", f"encode p50 {float(np.median(latency)):.3f}s")


def ranked(data: Any, catalog: dict[str, str]) -> tuple[list[str], np.ndarray, dict[str, str], dict[str, str]]:
    gallery = [json.loads(m) for m in data["gallery_meta"]]
    products = sorted({r["product_id"] for r in gallery})
    index = {p: i for i, p in enumerate(products)}
    sims = data["queries"] @ data["gallery"].T
    product_sims = np.full((sims.shape[0], len(products)), -2.0)
    for j, r in enumerate(gallery):
        product_sims[:, index[r["product_id"]]] = np.maximum(product_sims[:, index[r["product_id"]]], sims[:, j])
    category = {r["product_id"]: r["category"] for r in gallery}
    family = {r["product_id"]: catalog.get(r["product_id"], r["name"]) for r in gallery}
    return products, product_sims, category, family


def results(
    data: Any,
    catalog: dict[str, str],
    min_mass: float,
    gap: float,
    weight: float,
    *,
    floor: float = 0.0,
    ratio: float = 0.0,
    fallback: float = 0.0,
    depth: int = 48,
) -> list[dict[str, Any]]:
    """Mirror of the served policy: gate (mass, similarity floor, gap), Express category filter, then rerank."""
    products, sims, category, family = ranked(data, catalog)
    out = []
    for i, raw in enumerate(data["query_meta"]):
        query = json.loads(raw)
        order = np.argsort(-sims[i], kind="stable")[:TOP_K]
        rejected = data["mass"][i] < min_mass or sims[i][order[0]] < floor
        kept = [] if rejected else [j for j in order if sims[i][j] >= sims[i][order[0]] - gap]
        hints = json.loads(str(data["hints"][i]))
        if ratio > 0 and hints:
            strongest = max(hints.values())
            kept = [j for j in kept if hints.get(category[products[j]], 0.0) >= ratio * strongest]
        strongest_hint = max(hints, key=lambda c: hints[c]) if hints else None
        offered = fallback > 0 and data["mass"][i] >= min_mass and strongest_hint and hints[strongest_hint] >= fallback
        if not kept and offered:  # served category fallback: deeper candidates of the top category, within the gap
            deep = np.argsort(-sims[i], kind="stable")[:depth]
            same = [j for j in deep if category[products[j]] == strongest_hint]
            kept = [j for j in same if sims[i][j] >= sims[i][same[0]] - gap] if same else []
        kept.sort(key=lambda j: -(sims[i][j] + weight * hints.get(category[products[j]], 0.0)))
        out.append(
            {
                "query": query,
                "products": [products[j] for j in kept],
                "categories": [category[products[j]] for j in kept],
                "families": [family[products[j]] for j in kept],
                "top_similarity": float(sims[i][order[0]]),
                "mass": float(data["mass"][i]),
            }
        )
    return out


def metrics(rows: list[dict[str, Any]]) -> dict[str, Any]:
    known = [r for r in rows if r["query"]["category"] != "other"]
    unknown = [r for r in rows if r["query"]["category"] == "other"]
    accepted = [r for r in known if r["categories"]]
    with_family = [r for r in known if r["query"].get("family")]

    def frac(n: int, d: int) -> str:
        return f"{n}/{d}"

    return {
        "categoryRecall@1": frac(
            sum(bool(r["categories"]) and r["categories"][0] == r["query"]["category"] for r in known), len(known)
        ),
        "categoryRecall@5": frac(sum(r["query"]["category"] in r["categories"][:5] for r in known), len(known)),
        "familyRecall@1": frac(
            sum(bool(r["families"]) and r["families"][0] == r["query"]["family"] for r in with_family), len(with_family)
        ),
        "familyRecall@5": frac(sum(r["query"]["family"] in r["families"][:5] for r in with_family), len(with_family)),
        "precisionOfShown": round(
            float(np.mean([np.mean([c == r["query"]["category"] for c in r["categories"]]) for r in accepted]))
            if accepted
            else 0.0,
            3,
        ),
        "unknownAccepted": frac(sum(bool(r["categories"]) for r in unknown), len(unknown)),
        "knownRejected": frac(sum(not r["categories"] for r in known), len(known)),
        "meanShown": round(float(np.mean([len(r["categories"]) for r in accepted])) if accepted else 0.0, 1),
    }


def per_class(rows: list[dict[str, Any]]) -> dict[str, str]:
    out: dict[str, list[int]] = {}
    for r in rows:
        label = r["query"]["category"]
        ok = (not r["categories"]) if label == "other" else bool(r["categories"]) and r["categories"][0] == label
        out.setdefault(label, []).append(int(ok))
    return {k: f"{sum(v)}/{len(v)}" for k, v in sorted(out.items())}


def score(args: argparse.Namespace) -> None:
    data = np.load(args.npz)
    catalog = {r["product_id"]: r["appearance_family"] for r in csv.DictReader(args.catalog.open(encoding="utf-8"))}
    policy = {"floor": args.floor, "ratio": args.ratio, "fallback": args.fallback}
    rows = results(data, catalog, args.min_mass, args.gap, args.weight, **policy)
    latency = data["latency"]
    print(
        json.dumps(
            {
                "policy": {
                    "minMass": args.min_mass,
                    "gap": args.gap,
                    "weight": args.weight,
                    "floor": args.floor,
                    "ratio": args.ratio,
                    "fallback": args.fallback,
                },
                **metrics(rows),
                "perClassTop1OrCorrectReject": per_class(rows),
                "encodeLatency": {
                    "p50": round(float(np.percentile(latency, 50)), 3),
                    "p95": round(float(np.percentile(latency, 95)), 3),
                },
            },
            indent=1,
        )
    )
    if args.cases:
        with open(args.cases, "w", newline="", encoding="utf-8") as handle:
            writer = csv.writer(handle)
            writer.writerow(
                [
                    "image_id",
                    "category",
                    "family",
                    "accepted",
                    "top1_category",
                    "top3_families",
                    "top_similarity",
                    "mass",
                ]
            )
            for r in rows:
                writer.writerow(
                    [
                        r["query"]["image_id"],
                        r["query"]["category"],
                        r["query"].get("family", ""),
                        bool(r["categories"]),
                        r["categories"][0] if r["categories"] else "",
                        "; ".join(r["families"][:3]),
                        round(r["top_similarity"], 3),
                        round(r["mass"], 3),
                    ]
                )


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    e = sub.add_parser("encode")
    e.add_argument("--model", type=Path, required=True)
    e.add_argument("--relevance", type=Path)
    e.add_argument("--gallery", type=Path, required=True)
    e.add_argument("--queries", type=Path, required=True)
    e.add_argument("--root", type=Path, required=True)
    e.add_argument("--out", type=Path, required=True)
    s = sub.add_parser("score")
    s.add_argument("npz", type=Path)
    s.add_argument(
        "--catalog", type=Path, default=Path("training/.data/kaggle-run2/dataset/manifests/catalog_products.csv")
    )
    s.add_argument("--min-mass", type=float, default=0.08)
    s.add_argument("--gap", type=float, default=0.10)
    s.add_argument("--weight", type=float, default=0.5)
    s.add_argument("--floor", type=float, default=0.0, help="minTopSimilarity")
    s.add_argument("--ratio", type=float, default=0.0, help="minCategoryRatio")
    s.add_argument("--fallback", type=float, default=0.0, help="categoryFallbackConfidence")
    s.add_argument("--cases", type=Path)
    args = parser.parse_args()
    encode(args) if args.command == "encode" else score(args)


if __name__ == "__main__":
    main()
