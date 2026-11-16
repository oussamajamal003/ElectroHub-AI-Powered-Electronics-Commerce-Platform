"""Offline evaluation of product recommendations (Task 04.4).

Compares three strategies on the same anchors and the same candidate pool:

* ``category_baseline``: other products of the anchor's category, ordered by product id (a category listing).
* ``popularity_baseline``: only with ``--popularity``; otherwise reported as not evaluated (no measured data).
* ``d3_centroid``: the production recommender's ranking, cosine similarity of per-product centroids (mean of the
  eligible unit image vectors of the active D3 SigLIP2 embedding version), ties by product id ascending.

Product centroids come from the read-only vector store through ``PgVectorGateway.product_centroids``. Everything after
the fetch (labelling, ranking, metrics, failure table) is a pure function over in-memory data, so it can be checked
without a database. Relevance labels are frozen before any result is inspected; see ``LABEL_DEFINITION``.

Run from ``apps/ai-service`` with ``AI_VECTOR_DATABASE_URL`` set to the read-only role::

    venv/Scripts/python -m training.recommendations.evaluate --catalog <catalog.json> [--popularity <scores.json>]
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import importlib.util
import json
import math
import os
import sys
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType
from typing import Any
from uuid import UUID

import numpy as np

from app.core.config import check_vector_database_url
from app.integrations.pgvector_gateway import MAX_PRODUCT_LOOKUP, PgVectorGateway
from app.models.descriptor import ModelDescriptor

from .metrics import catalog_coverage, intra_list_diversity, ndcg_at_k, recall_at_k

APP_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DESCRIPTOR = APP_ROOT / "models" / "siglip2-b16-p256-d1" / "descriptor.json"
DEFAULT_TAXONOMY = APP_ROOT / "training" / "taxonomy" / "device_families.json"
FAMILY_RULES_PATH = APP_ROOT / "training" / "data" / "family_coverage.py"
RESULTS_DIR = Path(__file__).resolve().parent / "results"

LABEL_DEFINITION = (
    "graded relevance between anchor A and candidate C: same family and same brand = 3; same family = 2; "
    "same category only = 1; otherwise 0. Brands match when both are present and equal (case and surrounding "
    "whitespace ignored). Recall counts grade >= 2 as relevant. NDCG uses gain 2^g - 1."
)
NOT_EVALUATED_POPULARITY = "not evaluated (no measured popularity data)"
STRATEGY_ORDER = ("category_baseline", "popularity_baseline", "d3_centroid")
RECALL_KS = (1, 5, 10)
NDCG_KS = (5, 10)
DIVERSITY_K = 10
METRIC_KEYS = ("recall@1", "recall@5", "recall@10", "ndcg@5", "ndcg@10", "category_diversity@10")


def _load_family_rules() -> ModuleType:
    """Load training/data/family_coverage.py by path (training/data is a script directory, not a package)."""
    spec = importlib.util.spec_from_file_location("family_coverage", FAMILY_RULES_PATH)
    if spec is None or spec.loader is None:
        raise ImportError("cannot load family_coverage.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_family_coverage = _load_family_rules()
families_of: Callable[[dict[str, Any], dict[str, Any]], list[str]] = _family_coverage.families_of


@dataclass(frozen=True)
class Product:
    id: str
    name: str
    category: str | None
    brand: str | None
    family: str | None


@dataclass(frozen=True)
class Pool:
    """Candidate pool: products with a centroid, sorted by id. ``unit[i]`` is the unit centroid of ``products[i]``."""

    products: list[Product]
    unit: np.ndarray[Any, np.dtype[np.float64]]


# --------------------------------------------------------------------------------------------------------------------
# Inputs
# --------------------------------------------------------------------------------------------------------------------


def load_descriptor(path: Path) -> ModelDescriptor:
    """Build the gateway's ModelDescriptor from the on-disk JSON (camelCase keys mapped to the class fields)."""
    raw = json.loads(path.read_text(encoding="utf-8"))
    return ModelDescriptor(
        name=raw["name"],
        model_version=raw["modelVersion"],
        embedding_version=raw["embeddingVersion"],
        preprocess_version=raw["preprocessVersion"],
        embedding_dimension=raw["embeddingDimension"],
        artifact_format=raw["artifactFormat"],
        artifact_sha256=raw["artifactSha256"],
    )


def parse_catalog(raw: object) -> list[dict[str, Any]]:
    """Validate the catalog file: a list of {id, name, category, brand[, specifications]} objects.

    ``category`` is a category slug or null; ``brand`` is a brand name or null. ``specifications`` is optional and has
    the public API shape (``[{"items": [{"name", "value"}]}]``); it is needed only for families that match on the
    "Device type" specification.
    """
    if not isinstance(raw, list):
        raise ValueError("catalog must be a JSON list")
    seen: set[str] = set()
    entries: list[dict[str, Any]] = []
    for position, item in enumerate(raw):
        if not isinstance(item, dict):
            raise ValueError(f"catalog entry {position} is not an object")
        try:
            product_id = str(UUID(str(item["id"])))
        except (KeyError, ValueError) as exc:
            raise ValueError(f"catalog entry {position} has no valid UUID id") from exc
        if product_id in seen:
            raise ValueError(f"catalog entry {position} duplicates an earlier id")
        seen.add(product_id)
        name = item.get("name")
        category = item.get("category")
        brand = item.get("brand")
        specifications = item.get("specifications", [])
        if not isinstance(name, str) or not name.strip():
            raise ValueError(f"catalog entry {position} has no name")
        if category is not None and not isinstance(category, str):
            raise ValueError(f"catalog entry {position} category must be a slug or null")
        if brand is not None and not isinstance(brand, str):
            raise ValueError(f"catalog entry {position} brand must be a name or null")
        if not isinstance(specifications, list):
            raise ValueError(f"catalog entry {position} specifications must be a list")
        entries.append(
            {
                "id": product_id,
                "name": name,
                "category": category,
                "brand": brand,
                "specifications": specifications,
            }
        )
    return entries


def label_products(
    entries: Sequence[dict[str, Any]],
    taxonomy: Mapping[str, Any],
) -> tuple[list[Product], dict[str, int]]:
    """Assign each product its family with the frozen rule of family_coverage.families_of.

    Exactly one family gives a label. Zero or several families leave ``family`` as None (not an anchor, still a
    candidate) and are counted in the returned stats.
    """
    products: list[Product] = []
    stats = {"without_family": 0, "ambiguous_family": 0}
    for entry in entries:
        found = families_of(
            {
                "name": entry["name"],
                "category": {"slug": entry["category"]},
                "specifications": entry["specifications"],
            },
            dict(taxonomy),
        )
        if not found:
            stats["without_family"] += 1
        elif len(found) > 1:
            stats["ambiguous_family"] += 1
        products.append(
            Product(
                id=entry["id"],
                name=entry["name"],
                category=entry["category"],
                brand=entry["brand"],
                family=found[0] if len(found) == 1 else None,
            )
        )
    return products, stats


def parse_popularity(raw: object) -> dict[str, float]:
    """Optional measured popularity: a JSON object {product id: finite number}."""
    if not isinstance(raw, dict):
        raise ValueError("popularity must be a JSON object {product id: score}")
    scores: dict[str, float] = {}
    for key, value in raw.items():
        try:
            product_id = str(UUID(str(key)))
        except ValueError as exc:
            raise ValueError("popularity keys must be product UUIDs") from exc
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError("popularity scores must be finite numbers")
        scores[product_id] = float(value)
    return scores


# --------------------------------------------------------------------------------------------------------------------
# Ranking and metrics (pure)
# --------------------------------------------------------------------------------------------------------------------


def _norm_brand(brand: str | None) -> str | None:
    if brand is None or not brand.strip():
        return None
    return brand.strip().casefold()


def relevance_grade(anchor: Product, candidate: Product) -> int:
    """Frozen graded label (see LABEL_DEFINITION)."""
    if anchor.family is not None and anchor.family == candidate.family:
        anchor_brand = _norm_brand(anchor.brand)
        same_brand = anchor_brand is not None and anchor_brand == _norm_brand(candidate.brand)
        return 3 if same_brand else 2
    if anchor.category is not None and anchor.category == candidate.category:
        return 1
    return 0


def build_pool(products: Sequence[Product], vectors: Mapping[str, Sequence[float]]) -> Pool:
    with_vector = sorted((product for product in products if product.id in vectors), key=lambda p: p.id)
    if len(with_vector) < 2:
        raise ValueError("need at least two products with centroids")
    matrix = np.array([vectors[product.id] for product in with_vector], dtype=np.float64)
    if matrix.ndim != 2 or not np.isfinite(matrix).all():
        raise ValueError("centroids must be a finite matrix")
    norms = np.linalg.norm(matrix, axis=1)
    if (norms <= 0).any():
        raise ValueError("zero-norm centroid")
    return Pool(products=with_vector, unit=matrix / norms[:, None])


def gains_for(pool: Pool, anchor_index: int) -> dict[int, int]:
    anchor = pool.products[anchor_index]
    return {
        index: relevance_grade(anchor, product) for index, product in enumerate(pool.products) if index != anchor_index
    }


def rank_category_baseline(pool: Pool, anchor_index: int) -> list[int]:
    anchor = pool.products[anchor_index]
    if anchor.category is None:
        return []
    return [
        index
        for index, product in enumerate(pool.products)
        if index != anchor_index and product.category == anchor.category
    ]


def rank_popularity(pool: Pool, anchor_index: int, scores: Mapping[str, float]) -> list[int]:
    """Measured score descending, ties by id. Candidates without a score follow, ordered by id."""
    candidates = [index for index in range(len(pool.products)) if index != anchor_index]

    def key(index: int) -> tuple[int, float, str]:
        product_id = pool.products[index].id
        score = scores.get(product_id)
        if score is None:
            return (1, 0.0, product_id)
        return (0, -score, product_id)

    return sorted(candidates, key=key)


def rank_d3_centroid(pool: Pool, anchor_index: int) -> list[int]:
    """Cosine similarity of centroids to the anchor's centroid. The pool is sorted by id, so a stable sort breaks
    ties by product id ascending, as the production ORDER BY does."""
    similarities = pool.unit @ pool.unit[anchor_index]
    order = np.argsort(-similarities, kind="stable")
    return [int(index) for index in order if index != anchor_index]


def query_metrics(pool: Pool, gains: Mapping[int, int], ranking: Sequence[int]) -> dict[str, float | None]:
    relevant = [index for index, grade in gains.items() if grade >= 2]
    top = ranking[:DIVERSITY_K]
    metrics: dict[str, float | None] = {}
    for k in RECALL_KS:
        metrics[f"recall@{k}"] = recall_at_k(ranking, relevant, k)
    for k in NDCG_KS:
        metrics[f"ndcg@{k}"] = ndcg_at_k(ranking, gains, k)
    metrics["category_diversity@10"] = intra_list_diversity(top, lambda index: pool.products[index].category)
    return metrics


def _mean(values: Sequence[float]) -> float | None:
    return sum(values) / len(values) if values else None


def aggregate(per_query: Sequence[Mapping[str, float | None]]) -> dict[str, dict[str, float | int | None]]:
    summary: dict[str, dict[str, float | int | None]] = {}
    for key in METRIC_KEYS:
        values = [value for metrics in per_query if (value := metrics[key]) is not None]
        summary[key] = {"mean": _mean(values), "n": len(values)}
    return summary


def _latency_summary(latencies_ms: Sequence[float]) -> dict[str, float | int | None]:
    if not latencies_ms:
        return {"mean": None, "p95": None, "queries": 0}
    return {
        "mean": _mean(latencies_ms),
        "p95": float(np.percentile(latencies_ms, 95)),
        "queries": len(latencies_ms),
    }


def _failure_table(pool: Pool, results: Mapping[int, dict[str, Any]], limit: int = 10) -> list[dict[str, Any]]:
    scored = [
        (result["metrics"]["d3_centroid"]["ndcg@10"], pool.products[anchor].id, anchor)
        for anchor, result in results.items()
        if result["metrics"]["d3_centroid"]["ndcg@10"] is not None
    ]
    scored.sort(key=lambda row: (row[0], row[1]))
    rows: list[dict[str, Any]] = []
    for ndcg, _, anchor in scored[:limit]:
        result = results[anchor]
        product = pool.products[anchor]
        top3 = [
            {
                "id": pool.products[index].id,
                "name": pool.products[index].name,
                "family": pool.products[index].family,
                "category": pool.products[index].category,
                "grade": result["gains"][index],
            }
            for index in result["rankings"]["d3_centroid"][:3]
        ]
        rows.append(
            {
                "anchor": {
                    "id": product.id,
                    "name": product.name,
                    "family": product.family,
                    "category": product.category,
                },
                "ndcg@10": ndcg,
                "top3": top3,
            }
        )
    return rows


def run_evaluation(
    products: Sequence[Product],
    vectors: Mapping[str, Sequence[float]],
    popularity: Mapping[str, float] | None = None,
) -> dict[str, Any]:
    """Pure evaluation over in-memory data. Anchors are every pool product that has a family label."""
    pool = build_pool(products, vectors)
    anchors = [index for index, product in enumerate(pool.products) if product.family is not None]
    if not anchors:
        raise ValueError("no anchors: no product has both a centroid and a family label")

    results: dict[int, dict[str, Any]] = {
        anchor: {"gains": gains_for(pool, anchor), "rankings": {}, "metrics": {}} for anchor in anchors
    }
    d3_latencies_ms: list[float] = []
    for anchor in anchors:
        rankings = results[anchor]["rankings"]
        rankings["category_baseline"] = rank_category_baseline(pool, anchor)
        if popularity is not None:
            rankings["popularity_baseline"] = rank_popularity(pool, anchor, popularity)
        started = time.perf_counter()
        rankings["d3_centroid"] = rank_d3_centroid(pool, anchor)
        d3_latencies_ms.append((time.perf_counter() - started) * 1000.0)

    strategies: dict[str, dict[str, Any]] = {}
    for name in STRATEGY_ORDER:
        if name == "popularity_baseline" and popularity is None:
            strategies[name] = {"status": NOT_EVALUATED_POPULARITY}
            continue
        per_query: list[dict[str, float | None]] = []
        rankings_by_anchor: dict[int, list[int]] = {}
        for anchor in anchors:
            ranking = results[anchor]["rankings"][name]
            rankings_by_anchor[anchor] = ranking
            metrics = query_metrics(pool, results[anchor]["gains"], ranking)
            results[anchor]["metrics"][name] = metrics
            per_query.append(metrics)
        coverage = catalog_coverage(
            (ranking[:DIVERSITY_K] for ranking in rankings_by_anchor.values()),
            len(pool.products),
        )
        strategies[name] = {
            "status": "evaluated",
            "metrics": aggregate(per_query),
            "catalog_coverage@10": coverage,
        }
    strategies["d3_centroid"]["latency_ms"] = _latency_summary(d3_latencies_ms)

    return {
        "label_definition": LABEL_DEFINITION,
        "anchor_rule": "every candidate-pool product with a centroid and exactly one family label",
        "candidate_pool_size": len(pool.products),
        "anchor_count": len(anchors),
        "strategies": strategies,
        "failures": _failure_table(pool, results),
    }


# --------------------------------------------------------------------------------------------------------------------
# Database fetch (the only I/O besides the CLI)
# --------------------------------------------------------------------------------------------------------------------


async def fetch_centroids(
    dsn: str,
    descriptor: ModelDescriptor,
    product_ids: Sequence[str],
    chunk_size: int,
) -> dict[str, tuple[float, ...]]:
    if not 1 <= chunk_size <= MAX_PRODUCT_LOOKUP:
        raise ValueError(f"chunk size must be between 1 and {MAX_PRODUCT_LOOKUP}")
    gateway = PgVectorGateway(dsn=dsn)
    vectors: dict[str, tuple[float, ...]] = {}
    try:
        for start in range(0, len(product_ids), chunk_size):
            chunk = [UUID(product_id) for product_id in product_ids[start : start + chunk_size]]
            found = await gateway.product_centroids(chunk, descriptor=descriptor)
            for product_id, product_vector in found.items():
                vectors[str(product_id)] = product_vector.vector
    finally:
        await gateway.close()
    return vectors


# --------------------------------------------------------------------------------------------------------------------
# Output and CLI
# --------------------------------------------------------------------------------------------------------------------


def _fmt(value: float | int | None) -> str:
    if value is None:
        return "n/a"
    if isinstance(value, int):
        return str(value)
    return f"{value:.3f}"


def to_markdown(report: Mapping[str, Any]) -> str:
    strategies: Mapping[str, Any] = report["strategies"]
    lines = [
        "| Strategy | Recall@1 | Recall@5 | Recall@10 | NDCG@5 | NDCG@10 | Coverage@10 | Category diversity@10 "
        "| Latency mean (ms) |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for name in STRATEGY_ORDER:
        entry = strategies[name]
        if entry["status"] != "evaluated":
            lines.append(f"| {name} | {entry['status']} |  |  |  |  |  |  |  |")
            continue
        metrics = entry["metrics"]
        latency = entry.get("latency_ms", {}).get("mean")
        lines.append(
            f"| {name} | {_fmt(metrics['recall@1']['mean'])} | {_fmt(metrics['recall@5']['mean'])} | "
            f"{_fmt(metrics['recall@10']['mean'])} | {_fmt(metrics['ndcg@5']['mean'])} | "
            f"{_fmt(metrics['ndcg@10']['mean'])} | {_fmt(entry['catalog_coverage@10'])} | "
            f"{_fmt(metrics['category_diversity@10']['mean'])} | {_fmt(latency)} |"
        )
    d3_metrics = strategies["d3_centroid"]["metrics"]
    lines += [
        "",
        f"Anchors: {report['anchor_count']} (candidate pool {report['candidate_pool_size']}). "
        f"Recall n={d3_metrics['recall@10']['n']}; NDCG@10 n={d3_metrics['ndcg@10']['n']}.",
        "",
        "| Anchor | Family | NDCG@10 | Top-3 d3 results (name [family] grade) |",
        "|---|---|---|---|",
    ]
    for row in report["failures"]:
        top = "; ".join(f"{item['name']} [{item['family']}] g{item['grade']}" for item in row["top3"])
        lines.append(f"| {row['anchor']['name']} | {row['anchor']['family']} | {_fmt(row['ndcg@10'])} | {top} |")
    return "\n".join(lines)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--catalog", type=Path, required=True, help="JSON list of {id, name, category, brand}")
    parser.add_argument("--anchors", choices=["all"], default="all", help="anchor set (every labelled product)")
    parser.add_argument("--popularity", type=Path, default=None, help="optional JSON {product id: score}")
    parser.add_argument("--out", type=Path, default=None, help="output JSON (default: results/eval-<version>.json)")
    parser.add_argument("--descriptor", type=Path, default=DEFAULT_DESCRIPTOR)
    parser.add_argument("--taxonomy", type=Path, default=DEFAULT_TAXONOMY)
    parser.add_argument("--chunk-size", type=int, default=MAX_PRODUCT_LOOKUP)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        descriptor = load_descriptor(args.descriptor)
        taxonomy = json.loads(args.taxonomy.read_text(encoding="utf-8"))
        catalog_bytes = args.catalog.read_bytes()
        entries = parse_catalog(json.loads(catalog_bytes.decode("utf-8")))
        products, label_stats = label_products(entries, taxonomy)
        popularity = None
        if args.popularity is not None:
            popularity = parse_popularity(json.loads(args.popularity.read_text(encoding="utf-8")))
    except (OSError, ValueError, KeyError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    dsn = os.environ.get("AI_VECTOR_DATABASE_URL", "")
    if not dsn:
        print("error: AI_VECTOR_DATABASE_URL is not set (use the read-only vector role)", file=sys.stderr)
        return 2
    try:
        check_vector_database_url(dsn)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    try:
        if sys.platform == "win32":
            # psycopg's async driver cannot use the Proactor loop Windows defaults to (same as app/__main__.py).
            asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
        vectors = asyncio.run(fetch_centroids(dsn, descriptor, [product.id for product in products], args.chunk_size))
    except Exception as exc:
        # Only the exception type is printed: driver messages can carry connection details.
        print(f"error: centroid lookup failed ({type(exc).__name__})", file=sys.stderr)
        return 1

    report = run_evaluation(products, vectors, popularity)
    report["catalog"] = {
        "file": args.catalog.name,
        "file_sha256": hashlib.sha256(catalog_bytes).hexdigest(),
        "entries": len(entries),
        "with_centroid": sum(1 for product in products if product.id in vectors),
        "without_centroid": sum(1 for product in products if product.id not in vectors),
        **label_stats,
    }
    report["descriptor"] = {
        "name": descriptor.name,
        "model_version": descriptor.model_version,
        "embedding_version": descriptor.embedding_version,
        "preprocess_version": descriptor.preprocess_version,
        "embedding_dimension": descriptor.embedding_dimension,
        "artifact_format": descriptor.artifact_format,
        "artifact_sha256": descriptor.artifact_sha256,
    }
    out = args.out or RESULTS_DIR / f"eval-{descriptor.embedding_version}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(to_markdown(report))
    print(f"\nWrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
