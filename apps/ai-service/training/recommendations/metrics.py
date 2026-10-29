"""Pure ranking metrics for the offline product-recommendation evaluation (Task 04.4).

No I/O and no numpy: every function takes plain sequences and mappings so that the hand-computed unit tests in
``training/tests/test_recommendation_metrics.py`` define the behaviour. ``ranked_ids`` is assumed to hold unique ids.
"""

from __future__ import annotations

import math
from collections import Counter
from collections.abc import Callable, Hashable, Iterable, Mapping, Sequence
from typing import TypeVar

T = TypeVar("T", bound=Hashable)


def _check_k(k: int) -> None:
    if k < 1:
        raise ValueError("k must be >= 1")


def recall_at_k(ranked_ids: Sequence[T], relevant_ids: Iterable[T], k: int) -> float | None:
    """|top-k intersect relevant| / min(k, |relevant|). ``None`` when there are no relevant items (query excluded)."""
    _check_k(k)
    relevant = set(relevant_ids)
    if not relevant:
        return None
    top_k = set(ranked_ids[:k])
    return len(top_k & relevant) / min(k, len(relevant))


def ndcg_at_k(ranked_ids: Sequence[T], gains: Mapping[T, int], k: int) -> float | None:
    """Graded NDCG@k with gain ``2**g - 1`` and discount ``1/log2(rank + 1)`` (rank is 1-based).

    Items missing from ``gains`` have gain 0. The ideal DCG sorts *all* gains of the pool, not only the ranked list.
    ``None`` when the ideal DCG is 0 (no item in the pool has a positive gain).
    """
    _check_k(k)
    for grade in gains.values():
        if not isinstance(grade, int) or isinstance(grade, bool) or grade < 0:
            raise ValueError("gains must be non-negative integers")
    dcg = 0.0
    for rank, item in enumerate(ranked_ids[:k], start=1):
        grade = gains.get(item, 0)
        if grade:
            dcg += (2**grade - 1) / math.log2(rank + 1)
    ideal = sorted(gains.values(), reverse=True)[:k]
    idcg = sum((2**grade - 1) / math.log2(rank + 1) for rank, grade in enumerate(ideal, start=1) if grade)
    if idcg == 0:
        return None
    return float(dcg / idcg)


def catalog_coverage(lists: Iterable[Sequence[T]], eligible_count: int) -> float:
    """Distinct items recommended across all lists divided by the number of eligible catalog items."""
    if eligible_count < 1:
        raise ValueError("eligible_count must be >= 1")
    distinct: set[T] = set()
    for items in lists:
        distinct.update(items)
    return len(distinct) / eligible_count


def intra_list_diversity(
    items: Sequence[T],
    label_of: Callable[[T], Hashable] | Mapping[T, Hashable],
) -> float | None:
    """Fraction of unordered pairs in ``items`` whose labels differ. ``None`` for fewer than two items."""
    total = len(items)
    if total < 2:
        return None
    labels = [label_of[item] if isinstance(label_of, Mapping) else label_of(item) for item in items]
    pairs = total * (total - 1) // 2
    same_label_pairs = sum(count * (count - 1) // 2 for count in Counter(labels).values())
    return (pairs - same_label_pairs) / pairs
