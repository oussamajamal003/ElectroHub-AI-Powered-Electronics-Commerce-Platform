"""Retrieval metrics over L2-normalised embeddings (pure NumPy, deterministic).

Relevance is declared per query as a set of gallery labels; ``label`` is the appearance family, so a query is a hit when
a gallery image of the same family is retrieved. Ties in similarity are broken by gallery index for determinism.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from typing import Any

import numpy as np


@dataclass(frozen=True)
class RetrievalSet:
    embeddings: np.ndarray  # (n, d) float32, rows L2-normalised
    labels: list[str]
    groups: list[str]  # capture_group_id per row; query and gallery groups must be disjoint
    categories: list[str]


def rank_gallery(queries: RetrievalSet, gallery: RetrievalSet) -> np.ndarray:
    shared = set(queries.groups) & set(gallery.groups)
    if shared:
        raise ValueError(f"query and gallery share capture groups: {sorted(shared)[:5]}")
    similarity = queries.embeddings @ gallery.embeddings.T
    # Stable sort on -similarity keeps lower gallery index first among exact ties.
    return np.argsort(-similarity, axis=1, kind="stable")


def _average_precision(relevant: np.ndarray) -> float:
    hits = np.flatnonzero(relevant)
    if hits.size == 0:
        return 0.0
    precision_at_hits = np.arange(1, hits.size + 1) / (hits + 1)
    return float(precision_at_hits.mean())


def family_level_ranking(order: np.ndarray, gallery_labels: list[str]) -> list[list[str]]:
    """Collapses image rankings to unique family rankings (what a customer sees after product grouping)."""
    rankings = []
    for row in order:
        seen: dict[str, None] = {}
        for index in row:
            seen.setdefault(gallery_labels[index], None)
        rankings.append(list(seen))
    return rankings


def evaluate(queries: RetrievalSet, gallery: RetrievalSet, ks: tuple[int, ...] = (1, 5, 10)) -> dict[str, Any]:
    order = rank_gallery(queries, gallery)
    gallery_labels = np.array(gallery.labels)
    families = family_level_ranking(order, gallery.labels)
    recalls = {k: [] for k in ks}
    average_precisions, reciprocal_ranks = [], []
    per_category: dict[str, list[float]] = defaultdict(list)
    failures = []
    evaluable = 0
    for row, (label, category) in enumerate(zip(queries.labels, queries.categories, strict=True)):
        relevant = gallery_labels[order[row]] == label
        if not relevant.any():
            continue  # no relevant gallery item: excluded and counted, never scored as a miss or a hit
        evaluable += 1
        family_rank = families[row].index(label) + 1
        for k in ks:
            recalls[k].append(float(family_rank <= k))
        average_precisions.append(_average_precision(relevant))
        reciprocal_ranks.append(1.0 / family_rank)
        per_category[category].append(float(family_rank == 1))
        if family_rank > 1:
            failures.append({"query": row, "label": label, "top1": families[row][0], "rank": family_rank})
    if evaluable == 0:
        raise ValueError("no query has a relevant gallery item")
    return {
        "queries": len(queries.labels),
        "evaluableQueries": evaluable,
        "galleryImages": len(gallery.labels),
        "galleryFamilies": len(set(gallery.labels)),
        **{f"recall@{k}": float(np.mean(values)) for k, values in recalls.items()},
        "mAP": float(np.mean(average_precisions)),
        "MRR": float(np.mean(reciprocal_ranks)),
        "perCategoryRecall@1": {
            key: {"n": len(v), "recall@1": float(np.mean(v))} for key, v in sorted(per_category.items())
        },
        "failures": failures,
    }
