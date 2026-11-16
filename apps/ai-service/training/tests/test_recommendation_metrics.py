"""Hand-computed checks for the offline recommendation metrics and the pure evaluation pipeline (no database)."""

from __future__ import annotations

import math
from typing import Any
from uuid import UUID

import pytest

from training.recommendations import metrics as recommendation_metrics
from training.recommendations.evaluate import (
    Product,
    build_pool,
    gains_for,
    label_products,
    parse_catalog,
    parse_popularity,
    query_metrics,
    rank_category_baseline,
    rank_d3_centroid,
    rank_popularity,
    relevance_grade,
    run_evaluation,
)
from training.recommendations.metrics import catalog_coverage, intra_list_diversity, ndcg_at_k, recall_at_k


def pid(n: int) -> str:
    return str(UUID(int=n))


# --------------------------------------------------------------------------------------------------------------------
# metrics.py
# --------------------------------------------------------------------------------------------------------------------


def test_recall_counts_hits_over_the_complete_relevant_set() -> None:
    ranked = ["a", "b", "c", "d"]
    relevant = {"a", "c", "x"}
    assert recall_at_k(ranked, relevant, 2) == pytest.approx(1 / 3)  # top2 {a,b} hits a of {a,c,x}
    assert recall_at_k(ranked, relevant, 3) == pytest.approx(2 / 3)  # top3 {a,b,c} hits a,c of {a,c,x}
    assert recall_at_k(ranked, relevant, 5) == pytest.approx(2 / 3)  # list shorter than k


def test_recall_is_one_when_the_only_relevant_item_is_first() -> None:
    assert recall_at_k(["q", "r"], {"q"}, 1) == 1.0


def test_recall_denominator_is_not_capped_by_k_or_ranking_length() -> None:
    relevant = {"a", "b", "c", "d", "e"}
    assert recall_at_k(["a", "b", "x"], relevant, 1) == pytest.approx(1 / 5)
    assert recall_at_k(["a", "b", "x"], relevant, 10) == pytest.approx(2 / 5)


def test_recall_is_none_when_no_item_is_relevant() -> None:
    assert recall_at_k(["a", "b"], set(), 5) is None


def test_recall_rejects_k_below_one() -> None:
    with pytest.raises(ValueError):
        recall_at_k(["a"], {"a"}, 0)


GAINS = {"a": 3, "b": 0, "c": 2, "d": 1}


def test_ndcg_matches_hand_computed_value() -> None:
    # ranked [b, a, c] at k=3. DCG = 0/log2(2) + 7/log2(3) + 3/log2(4) = 7/log2(3) + 1.5.
    # IDCG from sorted gains [3, 2, 1] = 7/log2(2) + 3/log2(3) + 1/log2(4) = 7 + 3/log2(3) + 0.5.
    expected = (7 / math.log2(3) + 1.5) / (7 + 3 / math.log2(3) + 0.5)
    assert ndcg_at_k(["b", "a", "c", "d"], GAINS, 3) == pytest.approx(expected)
    assert ndcg_at_k(["b", "a", "c", "d"], GAINS, 3) == pytest.approx(0.6299, abs=1e-4)


def test_ndcg_is_one_for_the_ideal_order() -> None:
    assert ndcg_at_k(["a", "c", "d", "b"], GAINS, 4) == pytest.approx(1.0)


def test_ndcg_clamps_floating_point_overshoot(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = 0

    def slightly_different_log2(_: float) -> float:
        nonlocal calls
        calls += 1
        return 1.0 if calls == 1 else math.nextafter(1.0, 2.0)

    monkeypatch.setattr(recommendation_metrics.math, "log2", slightly_different_log2)
    assert ndcg_at_k(["a"], {"a": 2}, 1) == 1.0


def test_ndcg_ideal_uses_the_whole_pool_not_only_the_ranked_list() -> None:
    # Only "b" (gain 0) is ranked, but the pool holds "a" with gain 3: IDCG@1 = 7, DCG@1 = 0.
    assert ndcg_at_k(["b"], GAINS, 1) == pytest.approx(0.0)
    assert ndcg_at_k(["a"], GAINS, 1) == pytest.approx(1.0)


def test_ndcg_items_missing_from_gains_have_zero_gain() -> None:
    # Ranked ["zzz", "a"] at k=2: DCG = 0 + 7/log2(3); IDCG@2 = 7 + 3/log2(3).
    expected = (7 / math.log2(3)) / (7 + 3 / math.log2(3))
    assert ndcg_at_k(["zzz", "a"], GAINS, 2) == pytest.approx(expected)


def test_ndcg_is_none_when_ideal_dcg_is_zero() -> None:
    assert ndcg_at_k(["a", "b"], {"a": 0, "b": 0}, 5) is None
    assert ndcg_at_k(["a"], {}, 5) is None


def test_ndcg_rejects_negative_or_non_integer_gains_and_bad_k() -> None:
    with pytest.raises(ValueError):
        ndcg_at_k(["a"], {"a": -1}, 1)
    with pytest.raises(ValueError):
        ndcg_at_k(["a"], {"a": 1.5}, 1)  # type: ignore[dict-item]
    with pytest.raises(ValueError):
        ndcg_at_k(["a"], {"a": 1}, 0)


def test_catalog_coverage_counts_distinct_items_over_eligible_count() -> None:
    assert catalog_coverage([["a", "b"], ["b", "c"]], 10) == pytest.approx(3 / 10)
    assert catalog_coverage([[]], 4) == 0.0


def test_catalog_coverage_rejects_empty_eligible_set() -> None:
    with pytest.raises(ValueError):
        catalog_coverage([["a"]], 0)


def test_intra_list_diversity_is_fraction_of_pairs_with_different_labels() -> None:
    labels = {"a": "x", "b": "x", "c": "y", "d": "z"}
    # 6 pairs; only (a, b) share a label -> 5/6.
    assert intra_list_diversity(["a", "b", "c", "d"], labels) == pytest.approx(5 / 6)
    assert intra_list_diversity(["a", "c"], labels) == 1.0
    assert intra_list_diversity(["a", "b"], labels) == 0.0


def test_intra_list_diversity_accepts_a_callable_label() -> None:
    # labels 2, 2, 1 -> 3 pairs, one same-label pair -> 2/3.
    assert intra_list_diversity(["aa", "bb", "c"], len) == pytest.approx(2 / 3)


def test_intra_list_diversity_is_none_for_fewer_than_two_items() -> None:
    assert intra_list_diversity(["a"], {"a": "x"}) is None
    assert intra_list_diversity([], {}) is None


# --------------------------------------------------------------------------------------------------------------------
# evaluate.py: pure labelling, ranking and aggregation on a synthetic catalog
# --------------------------------------------------------------------------------------------------------------------

TAXONOMY: dict[str, Any] = {
    "supported": [
        {"family": "laptop", "category": "laptops"},
        {"family": "monitor", "category": "monitors"},
        {"family": "earbuds", "category": "headphones", "match": "Buds"},
        {"family": "headphones", "category": "headphones", "match": "^(?!.*Buds).*$"},
    ],
    "unsupported": [],
}

CATALOG_RAW: list[dict[str, Any]] = [
    {"id": pid(1), "name": "Laptop A", "category": "laptops", "brand": "Acme"},
    {"id": pid(2), "name": "Laptop B", "category": "laptops", "brand": "acme "},
    {"id": pid(3), "name": "Laptop C", "category": "laptops", "brand": "Zed"},
    {"id": pid(4), "name": "Monitor D", "category": "monitors", "brand": "Acme"},
    {"id": pid(5), "name": "Earbuds E Buds", "category": "headphones", "brand": "Acme"},
    {"id": pid(6), "name": "Headphones F", "category": "headphones", "brand": "Zed"},
    {"id": pid(7), "name": "Mystery G", "category": "accessories", "brand": "Acme"},
    # Labelled laptop with no centroid: must stay out of the candidate pool.
    {"id": pid(8), "name": "Laptop H", "category": "laptops", "brand": "Acme"},
]

VECTORS: dict[str, list[float]] = {
    pid(1): [1.0, 0.0],
    pid(2): [0.9, 0.1],
    pid(3): [0.6, 0.8],
    pid(4): [0.0, 1.0],
    pid(5): [0.1, 0.9],
    pid(6): [0.5, 0.5],
    pid(7): [-1.0, 0.0],
}


def _pipeline() -> tuple[list[Product], Any]:
    products, stats = label_products(parse_catalog(CATALOG_RAW), TAXONOMY)
    return products, stats


def _index(pool: Any, name: str) -> int:
    return next(i for i, product in enumerate(pool.products) if product.name == name)


def _names(pool: Any, ranking: list[int]) -> list[str]:
    return [pool.products[i].name for i in ranking]


def test_labelling_assigns_frozen_families_and_counts_unlabelled_products() -> None:
    products, stats = _pipeline()
    by_name = {product.name: product for product in products}
    assert by_name["Laptop A"].family == "laptop"
    assert by_name["Monitor D"].family == "monitor"
    assert by_name["Earbuds E Buds"].family == "earbuds"  # "Buds" matches earbuds, not headphones
    assert by_name["Headphones F"].family == "headphones"
    assert by_name["Mystery G"].family is None
    assert stats == {"without_family": 1, "ambiguous_family": 0}


def test_labelling_marks_products_matching_two_families_as_unlabelled() -> None:
    taxonomy = {
        "supported": [
            {"family": "laptop", "category": "laptops"},
            {"family": "laptop-alt", "category": "laptops"},
        ]
    }
    products, stats = label_products(parse_catalog(CATALOG_RAW[:1]), taxonomy)
    assert products[0].family is None
    assert stats == {"without_family": 0, "ambiguous_family": 1}


def test_relevance_grades_follow_the_frozen_definition() -> None:
    anchor = Product(id=pid(1), name="A", category="laptops", brand="Acme", family="laptop")
    same_brand = Product(id=pid(2), name="B", category="laptops", brand=" ACME", family="laptop")
    other_brand = Product(id=pid(3), name="C", category="laptops", brand="Zed", family="laptop")
    same_category = Product(id=pid(4), name="D", category="laptops", brand="Acme", family="laptop-alt")
    unrelated = Product(id=pid(5), name="E", category="monitors", brand="Acme", family="monitor")
    no_brand_anchor = Product(id=pid(6), name="F", category="laptops", brand=None, family="laptop")
    assert relevance_grade(anchor, same_brand) == 3
    assert relevance_grade(anchor, other_brand) == 2
    assert relevance_grade(anchor, same_category) == 1
    assert relevance_grade(anchor, unrelated) == 0
    assert relevance_grade(no_brand_anchor, other_brand) == 2  # brand missing: same family only


def test_parse_catalog_rejects_bad_ids_and_duplicates() -> None:
    with pytest.raises(ValueError):
        parse_catalog([{"id": "not-a-uuid", "name": "x", "category": None, "brand": None}])
    with pytest.raises(ValueError):
        parse_catalog(CATALOG_RAW[:1] + CATALOG_RAW[:1])


def test_parse_popularity_requires_uuid_keys_and_finite_numbers() -> None:
    assert parse_popularity({pid(2): 1}) == {pid(2): 1.0}
    with pytest.raises(ValueError):
        parse_popularity({"nope": 1.0})
    with pytest.raises(ValueError):
        parse_popularity({pid(2): True})
    with pytest.raises(ValueError):
        parse_popularity({pid(2): math.nan})


def test_pool_excludes_products_without_centroids_and_is_sorted_by_id() -> None:
    products, _ = _pipeline()
    pool = build_pool(products, VECTORS)
    assert [product.id for product in pool.products] == [pid(n) for n in range(1, 8)]
    assert pool.unit.shape == (7, 2)
    assert pool.unit[0] == pytest.approx([1.0, 0.0])


def test_d3_ranking_matches_cosine_order_and_excludes_the_anchor() -> None:
    products, _ = _pipeline()
    pool = build_pool(products, VECTORS)
    # Cosines to Laptop A: B 0.994, F 0.707, C 0.600, E 0.110, D 0.000, G -1.
    assert _names(pool, rank_d3_centroid(pool, _index(pool, "Laptop A"))) == [
        "Laptop B",
        "Headphones F",
        "Laptop C",
        "Earbuds E Buds",
        "Monitor D",
        "Mystery G",
    ]


def test_d3_ties_break_by_product_id_ascending() -> None:
    products = [Product(id=pid(n), name=f"P{n}", category=None, brand=None, family=None) for n in (1, 2, 3)]
    pool = build_pool(products, {pid(1): [1.0, 0.0], pid(2): [1.0, 0.0], pid(3): [0.0, 1.0]})
    # Anchor P3 is orthogonal to both others: equal similarity, so id order decides.
    assert rank_d3_centroid(pool, 2) == [0, 1]


def test_category_baseline_lists_same_category_in_id_order() -> None:
    products, _ = _pipeline()
    pool = build_pool(products, VECTORS)
    assert _names(pool, rank_category_baseline(pool, _index(pool, "Laptop A"))) == ["Laptop B", "Laptop C"]
    assert rank_category_baseline(pool, _index(pool, "Monitor D")) == []


def test_popularity_ranks_scored_products_first_then_unscored_by_id() -> None:
    products, _ = _pipeline()
    pool = build_pool(products, VECTORS)
    scores = {pid(2): 1.0, pid(4): 5.0}
    ranking = rank_popularity(pool, _index(pool, "Laptop A"), scores)
    assert _names(pool, ranking) == [
        "Monitor D",
        "Laptop B",
        "Laptop C",
        "Earbuds E Buds",
        "Headphones F",
        "Mystery G",
    ]


def test_query_metrics_for_laptop_a_hand_computed() -> None:
    products, _ = _pipeline()
    pool = build_pool(products, VECTORS)
    anchor = _index(pool, "Laptop A")
    gains = gains_for(pool, anchor)
    # Laptop B: same family and brand (case/space-insensitive) -> 3. Laptop C: same family -> 2. Rest 0.
    assert gains == {_index(pool, "Laptop B"): 3, _index(pool, "Laptop C"): 2} | {
        i: 0 for i in range(len(pool.products)) if i not in (anchor, _index(pool, "Laptop B"), _index(pool, "Laptop C"))
    }
    metrics = query_metrics(pool, gains, rank_d3_centroid(pool, anchor))
    assert metrics["recall@1"] == 0.5  # top-1 finds one of the two relevant laptops
    assert metrics["recall@5"] == 1.0  # both items in the complete relevant set are in the top 5
    expected_ndcg = 8.5 / (7 + 3 / math.log2(3))  # DCG: 7/log2(2) + 3/log2(4); IDCG: 7/log2(2) + 3/log2(3)
    assert metrics["ndcg@5"] == pytest.approx(expected_ndcg)
    assert metrics["ndcg@10"] == pytest.approx(expected_ndcg)
    # Categories in ranked order: laptops, headphones, laptops, headphones, monitors, accessories.
    # 15 pairs; same-category pairs (B,C) and (F,E) -> 13/15.
    assert metrics["category_diversity@10"] == pytest.approx(13 / 15)


def test_run_evaluation_end_to_end_on_synthetic_catalog() -> None:
    products, _ = _pipeline()
    report = run_evaluation(products, VECTORS)

    assert report["candidate_pool_size"] == 7
    assert report["anchor_count"] == 6  # every pool product with a family; Mystery G is not an anchor

    d3 = report["strategies"]["d3_centroid"]
    assert d3["status"] == "evaluated"
    # Recall needs a relevant item (grade >= 2): only Laptop A, B and C have one (D, E, F are sole family members).
    assert d3["metrics"]["recall@10"]["n"] == 3
    assert d3["metrics"]["recall@1"]["mean"] == pytest.approx(1 / 3)  # A/B hit 1 of 2; C misses both
    assert d3["metrics"]["recall@5"]["mean"] == pytest.approx(1.0)
    # NDCG is None only for Monitor D (no positive gain anywhere in its pool).
    assert d3["metrics"]["ndcg@10"]["n"] == 5
    assert d3["latency_ms"]["queries"] == 6
    assert d3["catalog_coverage@10"] == pytest.approx(1.0)  # every anchor's top-10 holds the other six products

    category = report["strategies"]["category_baseline"]
    assert category["catalog_coverage@10"] == pytest.approx(5 / 7)  # A,B,C,E,F are recommended somewhere
    assert category["metrics"]["category_diversity@10"] == {"mean": 0.0, "n": 3}

    assert report["strategies"]["popularity_baseline"] == {"status": "not evaluated (no measured popularity data)"}

    assert len(report["failures"]) == 5  # anchors with an NDCG@10 value (Monitor D excluded)
    ndcgs = [row["ndcg@10"] for row in report["failures"]]
    assert ndcgs == sorted(ndcgs)
    assert all(len(row["top3"]) == 3 for row in report["failures"])


def test_run_evaluation_with_popularity_reports_it_as_evaluated() -> None:
    products, _ = _pipeline()
    report = run_evaluation(products, VECTORS, popularity={pid(2): 1.0, pid(4): 5.0})
    assert report["strategies"]["popularity_baseline"]["status"] == "evaluated"
    assert report["strategies"]["popularity_baseline"]["metrics"]["ndcg@10"]["n"] == 5


def test_run_evaluation_refuses_a_pool_without_anchors() -> None:
    products = [Product(id=pid(n), name=f"P{n}", category="laptops", brand=None, family=None) for n in (1, 2)]
    with pytest.raises(ValueError):
        run_evaluation(products, {pid(1): [1.0, 0.0], pid(2): [0.0, 1.0]})
