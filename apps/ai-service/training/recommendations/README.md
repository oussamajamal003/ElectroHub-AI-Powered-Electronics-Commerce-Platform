# Product recommendation offline evaluation (Task 04.4)

## Purpose

`evaluate.py` measures how well the shipped product recommender ranks related products, offline, against
catalog-derived labels. It compares three strategies on the same anchors and the same candidate pool:

| Strategy | What it is |
|---|---|
| `category_baseline` | Other products of the anchor's category, ordered by product id (a category listing). |
| `popularity_baseline` | Only with `--popularity`. Without measured data it is reported as "not evaluated". |
| `d3_centroid` | The production ranking: cosine similarity of per-product centroids (mean of eligible unit image vectors of the active D3 SigLIP2 embedding version), ties by product id ascending. |

Metrics: Recall@1/5/10 (relevant = grade >= 2), NDCG@5/10 (graded), catalog coverage@10, intra-list category
diversity@10, and mean local scoring latency for `d3_centroid`. Database latency is not measured here.
The output also has a failure table with the 10 anchors where `d3_centroid` has the lowest NDCG@10.

## How to run

Run from `apps/ai-service`. The vector store is read through the read-only role in `AI_VECTOR_DATABASE_URL`.
Set the variable in your shell; do not put it in a file or command line that is shared.

```powershell
cd "apps/ai-service"
$env:AI_VECTOR_DATABASE_URL = "<read-only postgresql:// URL with sslmode for a remote host>"
venv/Scripts/python -m training.recommendations.evaluate --catalog <catalog.json> [--popularity <scores.json>] [--out <file.json>]
```

Options:

- `--catalog` (required): catalog JSON, shape below.
- `--anchors all`: the only value. Anchors are every candidate-pool product with a centroid and exactly one family.
- `--popularity`: optional JSON object `{"<product uuid>": <finite number>}`.
- `--out`: default `results/eval-<embedding_version>.json` next to this file. The JSON records the catalog file
  SHA-256, the descriptor identity, the anchor count, the label definition, per-strategy metrics and the failure table.
  The markdown table is printed to stdout.
- `--descriptor`, `--taxonomy`, `--chunk-size`: defaults point at the shipped descriptor, the frozen taxonomy and
  the gateway limit of 200 product ids per lookup.

The script exits 0 on success, 2 for input or configuration errors (missing DSN, invalid URL, bad catalog) and 1 when
the centroid lookup fails. Only the exception type is printed for lookup failures, so driver messages with
connection details are not shown.

## Catalog JSON

A list of objects, one per catalog product:

```json
[
  {"id": "3f2c1d0e-0000-4000-8000-000000000001", "name": "Example headphones", "category": "headphones", "brand": "Acme"},
  {"id": "3f2c1d0e-0000-4000-8000-000000000002", "name": "Example router", "category": "networking-wifi", "brand": null}
]
```

- `id`: product UUID as stored in the vector store.
- `name`: display name.
- `category`: category slug, or `null`.
- `brand`: brand name, or `null`.
- `specifications` (optional): the public API shape, `[{"items": [{"name": "...", "value": "..."}]}]`. Include it
  for catalogs where a family matches on the "Device type" specification (for example the wireless router rule).
  Without it, those products are labelled from the name only and may end up unlabelled.

## Labels (frozen before results were inspected)

Family comes from `training/taxonomy/device_families.json` using the rule in
`training/data/family_coverage.py` (`families_of`, loaded by path). A product gets a family only when exactly one
supported family matches. Products with zero or several matches have no family: they are not anchors but stay in
the candidate pool.

Graded relevance between anchor A and candidate C:

- same family and same brand: **3**
- same family: **2**
- same category only: **1**
- otherwise: **0**

Brands match when both are present and equal, ignoring case and surrounding spaces. Recall counts grade >= 2 as
relevant. NDCG uses gain `2^g - 1` and discount `1/log2(rank + 1)`, with the ideal ordering taken over the whole
candidate pool. Queries with no relevant item (Recall) or no positive gain (NDCG) are left out of that metric's mean,
and the `n` for each metric is reported.

## Data inventory and decision: no trained behaviour ranker (NO-GO)

A trained ranker that learns from user behaviour was evaluated as an option and rejected for now:

- DEV has 54 paid orders from 10 QA users.
- The maximum co-purchase support for any pair is 2, across 6 distinct pairs.
- There is no interaction history (no views, clicks or carts).
- That data is not representative of customer behaviour, and there is no consent basis for exporting it for training.

Result: no trained ranker. The shipped ML is the D3 SigLIP2 learned embedding space, and `d3_centroid` is the
strategy this evaluation measures.

## Honest limitations

- The labels are catalog taxonomy (family, brand, category), not human judgements of relevance. A high score means
  agreement with the taxonomy, not that customers find the recommendations useful.
- Whether the D3 embedding was trained on labels that overlap with this taxonomy was not checked here. If it was,
  the agreement is not independent evidence.
- The candidate pool is only the products in the catalog file that also have a centroid. Products without a current
  eligible image vector are not scored.
- Anchors are every labelled product, so some families are small. Many anchors have no relevant item, which
  reduces the Recall count (`n`).
- Popularity is not evaluated unless measured scores are supplied. The script never invents them.
- Latency covers local numpy scoring only. Database latency for the centroid lookup is measured elsewhere.
- The centroid lookup runs one read transaction per chunk of 200 products. An index activation between chunks is
  detected by the gateway's identity check, but the chunks are not one shared snapshot.
- Distances are computed by the same cosine rule as production, with normalised vectors in numpy. Ties decided by
  floating-point differences in pgvector can differ from this ordering at the last digit. Ties in exact arithmetic
  follow product id as in production.
- Results depend on the catalog snapshot and the active descriptor. Keep the output JSON with the catalog file it was
  produced from.

## Tests

```powershell
cd "apps/ai-service"
venv/Scripts/python -m pytest -q -p no:cacheprovider training/tests/test_recommendation_metrics.py
```

The tests cover the metric functions with hand-computed values and run the labelling, ranking and aggregation
pipeline on a synthetic in-memory catalog. They do not connect to a database.
