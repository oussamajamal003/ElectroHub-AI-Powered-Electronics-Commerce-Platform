# Agent-judged blinded relevance set

Frozen 2026-10-29 from the isolated QA public catalog and corresponding local catalog photos. These are **agent-judged, not human judgments**. The judge selected three anchors and candidate items manually, inspected names and primary photos for 17 of 19 candidates, and assigned labels before reading any embedding scores, recommendations, rankings, or evaluation metrics. The TP-Link Archer AX23 and Logitech Signature M650 judgments were name-led; their primary photos were not inspected. No score or ranking data was queried during this work.

This is a small, convenience-sampled seed set (24 anchor-candidate pairs), not a representative test set. It has no human inter-rater agreement and must not be described as human validation.

## Grade guide used

- `3`: same model or a clearly interchangeable SKU variant
- `2`: same kind of product and primary function; plausible alternative
- `1`: adjacent/complementary product with a direct use-case connection
- `0`: no meaningful product/use-case relationship

Judgments are based on the product as a shopper would understand it from the catalog name and primary image, not on the taxonomy-family labels. Rationales are short audit notes. IDs are QA database product IDs and should not be mixed with DEV/PROD IDs.

## Files

- `agent_judgments.json`: frozen pair labels, anchor/candidate names, and rationales.
- `candidate_metadata.json`: category slugs from the same public storefront snapshot, used only to order the category baseline and calculate category diversity.
- `d3_descriptor.json`: the active QA vector identity recorded when the comparisons were run.
- `evaluate_agent_judgments.py`: same-candidate D3/category evaluator. It accepts only TLS `verify-full` to loopback port 55434 database `electrohub_disposable` with user `ai_vector_reader`; the database connection also verifies its identity and is forced read-only. It uses the same eligible-image mean-centroid SQL as the application gateway.
- `agent_evaluation.json`: the current run, with per-anchor rankings and aggregate metrics. Cosine score values are not saved.
- `evaluate_taxonomy_snapshot.py` and `taxonomy_evaluation_206.json`: separate re-run of the repository's taxonomy evaluator on the saved 206-product QA catalog snapshot. This output does not replace any historical evaluation result.

Run both evaluations from `apps/ai-service` after assigning the existing QA reader DSN to `AI_VECTOR_DATABASE_URL` in the shell (do not print or save the DSN):

```powershell
$roles = Get-Content ..\backend\.isolated-docker\ai-vector-roles.json -Raw | ConvertFrom-Json
$env:AI_VECTOR_DATABASE_URL = $roles.dsn.AI_VECTOR_DATABASE_URL
.\venv\Scripts\python.exe -m training.recommendations.judgments.evaluate_agent_judgments
.\venv\Scripts\python.exe -m training.recommendations.judgments.evaluate_taxonomy_snapshot ..\backend\.isolated-docker\recommendation-catalog.json
```

For each agent-judged anchor the category baseline sorts same-category items first and then remaining candidates, with ID ascending within both groups. The category-first order is extended to a full permutation so it can be compared against D3 on the exact same judged candidate pool. This differs from a live category listing, which stops after the same-category subset.

