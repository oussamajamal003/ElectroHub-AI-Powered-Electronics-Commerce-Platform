"""Re-run the repository taxonomy evaluator on a supplied catalog snapshot into this directory."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from collections.abc import Sequence
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from training.recommendations.evaluate import (
    label_products,
    load_descriptor,
    parse_catalog,
    run_evaluation,
)
from training.recommendations.judgments.evaluate_agent_judgments import (
    DESCRIPTOR,
    fetch_read_only_centroids,
)

HERE = Path(__file__).resolve().parent
OUTPUT = HERE / "taxonomy_evaluation_206.json"
TAXONOMY = Path(__file__).resolve().parents[2] / "taxonomy" / "device_families.json"


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Evaluate a catalog snapshot without replacing an artifact for a different catalog."
    )
    parser.add_argument("catalog", type=Path)
    parser.add_argument(
        "--output",
        type=Path,
        help="explicit output path; may replace an existing artifact at that path",
    )
    arguments = parser.parse_args(argv)
    catalog_path = arguments.catalog.resolve()
    output_path = arguments.output.resolve() if arguments.output else OUTPUT
    try:
        catalog_bytes = catalog_path.read_bytes()
        catalog_sha256 = hashlib.sha256(catalog_bytes).hexdigest()
        if arguments.output is None and output_path.exists():
            existing = json.loads(output_path.read_text(encoding="utf-8"))
            existing_sha256 = existing.get("catalog", {}).get("file_sha256")
            if existing_sha256 != catalog_sha256:
                raise ValueError(
                    "default output already records a different catalog digest; "
                    f"pass --output to write {catalog_path.name}"
                )
        entries = parse_catalog(json.loads(catalog_bytes.decode("utf-8")))
        taxonomy = json.loads(TAXONOMY.read_text(encoding="utf-8"))
        products, label_stats = label_products(entries, taxonomy)
        descriptor = load_descriptor(DESCRIPTOR)
        dsn = os.environ.get("AI_VECTOR_DATABASE_URL", "")
        parsed = urlsplit(dsn)
        if (
            parsed.scheme != "postgresql"
            or parsed.hostname not in {"localhost", "127.0.0.1", "::1"}
            or parsed.port != 55434
            or parsed.path != "/electrohub_disposable"
            or parse_qs(parsed.query).get("sslmode") != ["verify-full"]
            or (parsed.username or "") != "ai_vector_reader"
        ):
            raise ValueError("refusing vector DSN outside the TLS-verified disposable QA read-only target")
        vectors = fetch_read_only_centroids(dsn, descriptor, [product.id for product in products])
        report = run_evaluation(products, vectors)
    except (OSError, ValueError, KeyError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    report["catalog"] = {
        "file": catalog_path.name,
        "file_sha256": catalog_sha256,
        "entries": len(entries),
        "with_centroid": sum(product.id in vectors for product in products),
        "without_centroid": sum(product.id not in vectors for product in products),
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
    report["limitations"] = [
        "This is the repository's taxonomy-derived evaluation, not independent human relevance judgments.",
        "The candidate pool is the supplied catalog snapshot intersected with currently eligible active D3 centroids.",
        "Each centroid chunk uses a read-only snapshot; active identity is rechecked per chunk.",
    ]
    output_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {"output": str(output_path), "catalog": report["catalog"], "strategies": report["strategies"]},
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
