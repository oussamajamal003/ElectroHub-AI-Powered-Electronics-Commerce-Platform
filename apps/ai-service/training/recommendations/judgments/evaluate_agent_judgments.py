"""Compare D3 and a category-first baseline on the frozen agent-judged candidate pools.

Run from apps/ai-service with AI_VECTOR_DATABASE_URL set to the QA read-only vector-reader DSN.
The script reuses the production centroid gateway and standard metric functions. It writes only aggregate
metrics and item-id rankings; cosine score values are not persisted.
"""

from __future__ import annotations

import json
import os
from collections import defaultdict
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

import psycopg

from app.integrations.pgvector_gateway import _ACTIVE_SQL, _CENTROIDS_SQL, _identity_matches, _parse_vector
from app.models.descriptor import ModelDescriptor
from training.recommendations.evaluate import load_descriptor
from training.recommendations.metrics import catalog_coverage, intra_list_diversity, ndcg_at_k, recall_at_k

HERE = Path(__file__).resolve().parent
JUDGMENTS = HERE / "agent_judgments.json"
METADATA = HERE / "candidate_metadata.json"
DESCRIPTOR = HERE / "d3_descriptor.json"
OUTPUT = HERE / "agent_evaluation.json"


def mean(values: list[float | None]) -> dict[str, float | int | None]:
    usable = [value for value in values if value is not None]
    return {"mean": sum(usable) / len(usable) if usable else None, "n": len(usable)}


def summarize(per_anchor: list[dict[str, Any]], strategy: str) -> dict[str, Any]:
    keys = ("recall@1", "recall@5", "recall@10", "ndcg@5", "ndcg@10", "category_diversity@10")
    summary: dict[str, Any] = {key: mean([row[strategy][key] for row in per_anchor]) for key in keys}
    summary["queries"] = len(per_anchor)
    return summary


def query_metrics(ranking: list[str], labels: dict[str, int], categories: dict[str, str]) -> dict[str, float | None]:
    relevant = [item_id for item_id, grade in labels.items() if grade >= 2]
    return {
        "recall@1": recall_at_k(ranking, relevant, 1),
        "recall@5": recall_at_k(ranking, relevant, 5),
        "recall@10": recall_at_k(ranking, relevant, 10),
        "ndcg@5": ndcg_at_k(ranking, labels, 5),
        "ndcg@10": ndcg_at_k(ranking, labels, 10),
        "category_diversity@10": intra_list_diversity(ranking[:10], categories),
    }


def fetch_read_only_centroids(dsn: str, descriptor: ModelDescriptor, ids: list[str]) -> dict[str, tuple[float, ...]]:
    vectors: dict[str, tuple[float, ...]] = {}
    options = "-c search_path=ai,extensions -c statement_timeout=2000 -c default_transaction_read_only=on"
    for start in range(0, len(ids), 200):
        chunk = ids[start : start + 200]
        with psycopg.connect(
            dsn, options=options, connect_timeout=10, application_name="electrohub-agent-judgments"
        ) as conn:
            with conn.transaction():
                conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
                identity_sql = (
                    "SELECT current_database(), inet_server_port(), current_user, "
                    "current_setting('transaction_read_only')"
                )
                identity = conn.execute(identity_sql).fetchone()
                if identity != ("electrohub_disposable", 55434, "ai_vector_reader", "on"):
                    raise ValueError("connected PostgreSQL identity is not the read-only disposable QA vector target")
                active = conn.execute(_ACTIVE_SQL).fetchone()
                if active is None or not _identity_matches(active, descriptor):
                    raise ValueError("active QA embedding identity does not match the frozen D3 descriptor")
                rows = conn.execute(
                    _CENTROIDS_SQL,
                    (descriptor.embedding_version, descriptor.embedding_version, chunk),
                ).fetchall()
                for row in rows:
                    vectors[str(row[0])] = _parse_vector(row[1], descriptor)
    return vectors


def run() -> dict[str, Any]:
    judgments = json.loads(JUDGMENTS.read_text(encoding="utf-8"))
    metadata = json.loads(METADATA.read_text(encoding="utf-8"))
    descriptor = load_descriptor(DESCRIPTOR)
    if judgments.get("human_judgments") is not False or judgments.get("blinded_before_scoring") is not True:
        raise ValueError("judgment provenance flags are missing or inconsistent")

    products = {row["id"]: row for row in metadata["products"]}
    pairs_by_anchor: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for pair in judgments["pairs"]:
        if pair["anchor_id"] not in products or pair["candidate_id"] not in products:
            raise ValueError("judgment references an ID absent from candidate metadata")
        pairs_by_anchor[pair["anchor_id"]].append(pair)
    ids = sorted(
        {
            product_id
            for anchor, pairs in pairs_by_anchor.items()
            for product_id in [anchor, *(p["candidate_id"] for p in pairs)]
        }
    )

    dsn = os.environ.get("AI_VECTOR_DATABASE_URL", "")
    if not dsn:
        raise ValueError("AI_VECTOR_DATABASE_URL must point at the isolated QA read-only vector role")
    parsed_dsn = urlsplit(dsn)
    query = parse_qs(parsed_dsn.query)
    if (
        parsed_dsn.scheme != "postgresql"
        or parsed_dsn.hostname not in {"localhost", "127.0.0.1", "::1"}
        or parsed_dsn.port != 55434
        or parsed_dsn.path != "/electrohub_disposable"
        or query.get("sslmode") != ["verify-full"]
        or (parsed_dsn.username or "") != "ai_vector_reader"
    ):
        raise ValueError("refusing vector DSN outside the TLS-verified disposable QA read-only target")
    vectors = fetch_read_only_centroids(dsn, descriptor, ids)

    per_anchor: list[dict[str, Any]] = []
    excluded: list[dict[str, str]] = []
    all_candidates_used: set[str] = set()
    for anchor_id, pairs in sorted(pairs_by_anchor.items()):
        if anchor_id not in vectors:
            excluded.extend(
                {
                    "anchor_id": anchor_id,
                    "candidate_id": pair["candidate_id"],
                    "reason": "anchor has no active centroid",
                }
                for pair in pairs
            )
            continue
        eligible = [pair for pair in pairs if pair["candidate_id"] in vectors]
        excluded.extend(
            {"anchor_id": anchor_id, "candidate_id": pair["candidate_id"], "reason": "candidate has no active centroid"}
            for pair in pairs
            if pair["candidate_id"] not in vectors
        )
        if not eligible:
            continue

        anchor = products[anchor_id]
        labels = {pair["candidate_id"]: int(pair["grade"]) for pair in eligible}
        candidate_ids = sorted(labels)
        anchor_vector = vectors[anchor_id]
        ranked_d3 = sorted(
            candidate_ids,
            key=lambda item_id: (
                -sum(a * b for a, b in zip(anchor_vector, vectors[item_id], strict=True))
                / ((sum(a * a for a in anchor_vector) ** 0.5) * (sum(b * b for b in vectors[item_id]) ** 0.5)),
                item_id,
            ),
        )
        ranked_category = sorted(
            candidate_ids,
            key=lambda item_id: (products[item_id]["category"] != anchor["category"], item_id),
        )

        categories = {item_id: products[item_id]["category"] for item_id in candidate_ids}

        per_anchor.append(
            {
                "anchor_id": anchor_id,
                "anchor_name": products[anchor_id]["name"],
                "candidate_count": len(candidate_ids),
                "relevant_count_grade_ge_2": sum(grade >= 2 for grade in labels.values()),
                "category_baseline": query_metrics(ranked_category, labels, categories),
                "d3_centroid": query_metrics(ranked_d3, labels, categories),
                "ranked_candidate_ids": {"category_baseline": ranked_category, "d3_centroid": ranked_d3},
            }
        )
        all_candidates_used.update(candidate_ids)

    if not per_anchor:
        raise ValueError("no anchor has both an active D3 centroid and eligible candidates")
    evaluated_candidate_count = len(all_candidates_used)
    return {
        "evaluation": "same frozen per-anchor candidate pools; grades are agent-judged, not human",
        "metric_definition": {
            "relevant": "grade >= 2",
            "ndcg_gain": "2^grade - 1",
            "ndcg_ideal": "all judged candidates for that anchor, sorted by grade",
            "category_baseline": (
                "same-category candidates first, then remaining candidates; ID ascending within each group"
            ),
            "d3_centroid": "cosine similarity of active eligible-image mean centroids; ties by candidate ID ascending",
        },
        "descriptor": {
            "embedding_version": descriptor.embedding_version,
            "model_version": descriptor.model_version,
            "preprocess_version": descriptor.preprocess_version,
            "dimension": descriptor.embedding_dimension,
            "artifact_sha256": descriptor.artifact_sha256,
        },
        "candidate_coverage": {
            "requested_unique_ids": len(ids),
            "with_active_centroid": len(vectors),
            "evaluated_anchor_queries": len(per_anchor),
            "excluded_pairs": len(excluded),
        },
        "strategies": {
            "category_baseline": {
                **summarize(per_anchor, "category_baseline"),
                "catalog_coverage@10": catalog_coverage(
                    (row["ranked_candidate_ids"]["category_baseline"][:10] for row in per_anchor),
                    evaluated_candidate_count,
                ),
            },
            "d3_centroid": {
                **summarize(per_anchor, "d3_centroid"),
                "catalog_coverage@10": catalog_coverage(
                    (row["ranked_candidate_ids"]["d3_centroid"][:10] for row in per_anchor),
                    evaluated_candidate_count,
                ),
            },
        },
        "per_anchor": per_anchor,
        "excluded_pairs": excluded,
    }


def main() -> None:
    report = run()
    OUTPUT.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {"output": OUTPUT.name, "coverage": report["candidate_coverage"], "strategies": report["strategies"]},
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
