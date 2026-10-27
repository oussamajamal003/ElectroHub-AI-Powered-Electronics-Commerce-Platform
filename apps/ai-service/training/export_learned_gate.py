"""Turn a trained category head (train_category.py: head/head.safetensors + classes.json) into a relevance-gate
artifact the service loads with AI_RELEVANCE_ARTIFACT_DIR (Task 04.2-Q).

"Electronics mass" becomes the probability of any catalog class (1 - P(other)); category hints are the per-class
probabilities. Thresholds must be chosen on the dev split (training/relevance/evaluate_policy.py), never on the final
benchmark.

    python training/export_learned_gate.py <run>/head <out-dir> --model-version effb0-realphoto-c2 \
        --min-mass 0.5 --max-gap 0.1 --category-weight 0 --min-top-similarity 0.36
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path

OTHER = "other"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("head", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("--model-version", required=True)
    parser.add_argument("--min-mass", type=float, required=True)
    parser.add_argument("--max-gap", type=float, default=0.10)
    parser.add_argument("--category-weight", type=float, default=0.5, help="Express rerank weight chosen on dev")
    parser.add_argument("--min-category-ratio", type=float, default=0.0, help="category filter chosen on dev")
    parser.add_argument("--min-top-similarity", type=float, default=0.0, help="no-match floor chosen on dev")
    args = parser.parse_args()
    classes: list[str] = json.loads((args.head / "classes.json").read_text(encoding="utf-8"))["classes"]
    if OTHER not in classes:
        raise SystemExit("head has no 'other' class")
    args.out.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(args.head / "head.safetensors", args.out / "head.safetensors")
    descriptor = {
        "relevanceVersion": f"{args.model_version}-category-head",
        "backboneModelVersion": args.model_version,
        "headSha256": hashlib.sha256((args.out / "head.safetensors").read_bytes()).hexdigest(),
        "numClasses": len(classes),
        "electronicsClassIndices": [i for i, name in enumerate(classes) if name != OTHER],
        "categoryClassIndices": {name: [i] for i, name in enumerate(classes) if name != OTHER},
        "minElectronicsMass": args.min_mass,
        "maxScoreGap": args.max_gap,
        "categoryRerankWeight": args.category_weight,
        "minTopSimilarity": args.min_top_similarity,
        "minCategoryRatio": args.min_category_ratio,
    }
    (args.out / "relevance.json").write_text(json.dumps(descriptor, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: descriptor[k] for k in ("relevanceVersion", "numClasses", "minElectronicsMass")}))


if __name__ == "__main__":
    main()
