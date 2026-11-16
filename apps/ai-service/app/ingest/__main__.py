"""Offline catalog-embedding ingestion and index activation (Task 04.2). Never run by the online service.

    python -m app.ingest stage    --artifact-dir <dir> --catalog-root apps/frontend/public
    python -m app.ingest activate --embedding-version <v>
    python -m app.ingest rollback
    python -m app.ingest status

`stage` uses AI_VECTOR_INGEST_DATABASE_URL (the narrow ai_vector_ingest role): it registers the model as a STAGING
version, encodes every storefront-visible product image with the SAME verified encoder the service loads, and upserts
vectors idempotently (re-running skips images whose bytes are unchanged). `activate` and `rollback` use
AI_VECTOR_ADMIN_DATABASE_URL (operator/migration role): they verify completeness and switch ai.active_index in one
transaction. Connection strings are read from the environment only and are never printed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import uuid
from collections import Counter
from pathlib import Path, PurePosixPath
from typing import Any

import psycopg

from app.core.errors import AIServiceError
from app.models.siglip_loader import load_encoder
from app.processors.image import decode_image

MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_IMAGE_PIXELS = 40_000_000
BATCH = 32

_SNAPSHOT_COUNTS_SQL = """
SELECT count(*) AS eligible,
       count(e.product_image_id) AS matched,
       count(*) FILTER (
           WHERE source.source_revision IS NOT NULL
             AND e.image_sha256 IS DISTINCT FROM source.source_sha256
       ) AS digest_mismatch
FROM ai.catalog_media_sources AS source
LEFT JOIN ai.product_image_embeddings AS e
  ON e.embedding_version = %s
 AND e.product_image_id = source.product_image_id
 AND e.product_id = source.product_id
WHERE source.eligible
"""

_SNAPSHOT_STALE_SQL = """
SELECT count(*)
FROM ai.product_image_embeddings AS e
LEFT JOIN ai.catalog_media_sources AS source
  ON source.product_image_id = e.product_image_id
 AND source.product_id = e.product_id
 AND source.eligible
WHERE e.embedding_version = %s
  AND source.product_image_id IS NULL
"""

_SNAPSHOT_STORED_SQL = """
SELECT count(*) FROM ai.product_image_embeddings WHERE embedding_version = %s
"""
_LOCK_CATALOG_SNAPSHOT_SQL = "LOCK TABLE public.products, public.categories, public.product_images IN SHARE MODE"


def one(row: Any) -> Any:
    """fetchone() for aggregate queries that always return exactly one row."""
    if row is None:
        raise SystemExit("unexpected empty result")
    return row


def connect(variable: str) -> psycopg.Connection[Any]:
    dsn = os.environ.get(variable, "").strip()
    if not dsn:
        raise SystemExit(f"{variable} is not set")
    return psycopg.connect(dsn, options="-c search_path=ai,extensions -c statement_timeout=60000")


def resolve_catalog_file(root: Path, url: str) -> Path | None:
    """Maps a storefront-relative image URL (/images/...) to a file under the public root; anything else is refused."""
    if not url.startswith("/images/") or "\\" in url or "?" in url:
        return None
    relative = PurePosixPath(url.lstrip("/"))
    if any(part in ("", ".", "..") for part in relative.parts):
        return None
    candidate = (root / Path(*relative.parts)).resolve()
    return candidate if candidate.is_relative_to(root.resolve()) and candidate.is_file() else None


def vector_literal(values: list[float]) -> str:
    return "[" + ",".join(f"{value:.8f}" for value in values) + "]"


def stage(args: argparse.Namespace) -> None:
    encoder = load_encoder(args.artifact_dir, torch_threads=args.threads)
    descriptor = encoder.descriptor
    root: Path = args.catalog_root
    with connect("AI_VECTOR_INGEST_DATABASE_URL") as conn:
        rows = conn.execute(
            "SELECT product_image_id, product_id, url FROM ai.catalog_images ORDER BY product_id, product_image_id"
        ).fetchall()
        digest = hashlib.sha256(json.dumps([[str(a), str(b), c] for a, b, c in rows]).encode()).hexdigest()
        existing = conn.execute(
            "SELECT status, artifact_sha256 FROM ai.model_versions WHERE embedding_version = %s",
            (descriptor.embedding_version,),
        ).fetchone()
        if existing is None:
            conn.execute(
                "INSERT INTO ai.model_versions (embedding_version, model_version, preprocess_version, "
                "embedding_dimension, artifact_format, artifact_sha256) VALUES (%s, %s, %s, %s, %s, %s)",
                (
                    descriptor.embedding_version,
                    descriptor.model_version,
                    descriptor.preprocess_version,
                    descriptor.embedding_dimension,
                    descriptor.artifact_format,
                    descriptor.artifact_sha256,
                ),
            )
        elif existing[1] != descriptor.artifact_sha256:
            raise SystemExit("embedding version already registered with a different artifact")
        elif existing[0] != "STAGING":
            raise SystemExit(f"embedding version is {existing[0]}; stage a new version instead")
        conn.execute(
            "UPDATE ai.model_versions SET expected_images = %s WHERE embedding_version = %s",
            (len(rows), descriptor.embedding_version),
        )
        job = uuid.uuid4()
        conn.execute(
            "INSERT INTO ai.ingestion_jobs (id, embedding_version, source_digest, planned) VALUES (%s, %s, %s, %s)",
            (job, descriptor.embedding_version, digest, len(rows)),
        )
        conn.commit()
        known = dict(
            conn.execute(
                "SELECT product_image_id, image_sha256 FROM ai.product_image_embeddings WHERE embedding_version = %s",
                (descriptor.embedding_version,),
            ).fetchall()
        )
        counts: Counter[str] = Counter()
        for start in range(0, len(rows), BATCH):
            for image_id, product_id, url in rows[start : start + BATCH]:
                path = resolve_catalog_file(root, url)
                if path is None or path.stat().st_size > MAX_IMAGE_BYTES:
                    counts["failed"] += 1
                    counts["error:IMAGE_SOURCE_UNAVAILABLE"] += 1
                    continue
                data = path.read_bytes()
                sha = hashlib.sha256(data).hexdigest()
                if known.get(image_id) == sha:
                    counts["skipped"] += 1
                    continue
                try:
                    vector = encoder.encode(decode_image(data, max_pixels=MAX_IMAGE_PIXELS))
                except AIServiceError as failure:
                    counts["failed"] += 1
                    counts[f"error:{failure.code}"] += 1
                    continue
                conn.execute(
                    "INSERT INTO ai.product_image_embeddings (product_image_id, product_id, embedding_version, "
                    "image_sha256, embedding) VALUES (%s, %s, %s, %s, %s::vector) "
                    "ON CONFLICT (embedding_version, product_image_id) DO UPDATE SET "
                    "image_sha256 = EXCLUDED.image_sha256, "
                    "embedding = EXCLUDED.embedding, product_id = EXCLUDED.product_id",
                    (image_id, product_id, descriptor.embedding_version, sha, vector_literal(vector)),
                )
                counts["succeeded"] += 1
            # Commit per batch so an interrupted run resumes from the last finished batch.
            conn.execute(
                "UPDATE ai.ingestion_jobs SET succeeded = %s, skipped = %s, failed = %s, error_codes = %s "
                "WHERE id = %s",
                (
                    counts["succeeded"],
                    counts["skipped"],
                    counts["failed"],
                    json.dumps({k[6:]: v for k, v in counts.items() if k.startswith("error:")}),
                    job,
                ),
            )
            conn.commit()
            print(f"{min(start + BATCH, len(rows))}/{len(rows)}", flush=True)
        state = "COMPLETED" if counts["failed"] == 0 else "FAILED"
        conn.execute("UPDATE ai.ingestion_jobs SET state = %s, finished_at = now() WHERE id = %s", (state, job))
        conn.commit()
        print(
            json.dumps(
                {
                    "embeddingVersion": descriptor.embedding_version,
                    "planned": len(rows),
                    **counts,
                    "state": state,
                    "sourceDigest": digest,
                }
            )
        )


def verify_current_snapshot(conn: Any, embedding_version: str, expected_images: int | None) -> tuple[int, int]:
    """Refuse activation unless every currently eligible image is represented by a current compatible base vector.

    Legacy sources have no authoritative source digest; their existing staged vector remains compatible. Revisioned
    media must match its canonical SHA-256. Extra hidden/retired vectors are rejected so a same-count ID swap cannot
    pass the activation gate.
    """
    counts = one(conn.execute(_SNAPSHOT_COUNTS_SQL, (embedding_version,)).fetchone())
    eligible, matched, digest_mismatch = (int(value) for value in counts)
    stored = int(one(conn.execute(_SNAPSHOT_STORED_SQL, (embedding_version,)).fetchone())[0])
    stale = int(one(conn.execute(_SNAPSHOT_STALE_SQL, (embedding_version,)).fetchone())[0])
    if (
        expected_images is None
        or stored != expected_images
        or eligible != expected_images
        or matched != eligible
        or digest_mismatch != 0
        or stale != 0
    ):
        raise SystemExit(
            "refusing to activate: snapshot is not source-current "
            f"(stored={stored}, expected={expected_images}, eligible={eligible}, matched={matched}, "
            f"digest_mismatch={digest_mismatch}, stale={stale})"
        )
    return stored, eligible


def activate(args: argparse.Namespace) -> None:
    with connect("AI_VECTOR_ADMIN_DATABASE_URL") as conn, conn.transaction():
        # Freeze the eligibility inputs from freshness verification through pointer commit. Backend media writes
        # take ROW EXCLUSIVE locks and therefore cannot slip a replacement/retirement between the checks and switch.
        conn.execute(_LOCK_CATALOG_SNAPSHOT_SQL)
        conn.execute("LOCK TABLE ai.active_index IN EXCLUSIVE MODE")
        version = conn.execute(
            "SELECT status, expected_images FROM ai.model_versions WHERE embedding_version = %s FOR UPDATE",
            (args.embedding_version,),
        ).fetchone()
        if version is None:
            raise SystemExit("unknown embedding version")
        stored, _eligible = verify_current_snapshot(conn, args.embedding_version, version[1])
        current = conn.execute("SELECT embedding_version FROM ai.active_index").fetchone()
        if version[0] == "STAGING":
            conn.execute(
                "UPDATE ai.model_versions SET status = 'VERIFIED', verified_at = now() WHERE embedding_version = %s",
                (args.embedding_version,),
            )
        conn.execute(
            "UPDATE ai.model_versions SET status = 'RETIRED' WHERE status = 'ACTIVE' AND embedding_version <> %s",
            (args.embedding_version,),
        )
        conn.execute(
            "UPDATE ai.model_versions SET status = 'ACTIVE', activated_at = now() WHERE embedding_version = %s",
            (args.embedding_version,),
        )
        conn.execute(
            "INSERT INTO ai.active_index (singleton, embedding_version, previous_version) VALUES (true, %s, %s) "
            "ON CONFLICT (singleton) DO UPDATE SET embedding_version = EXCLUDED.embedding_version, "
            "previous_version = EXCLUDED.previous_version, activated_at = now()",
            (args.embedding_version, current[0] if current else None),
        )
    print(
        json.dumps({"active": args.embedding_version, "previous": current[0] if current else None, "vectors": stored})
    )


def rollback(_: argparse.Namespace) -> None:
    with connect("AI_VECTOR_ADMIN_DATABASE_URL") as conn, conn.transaction():
        conn.execute("LOCK TABLE ai.active_index IN EXCLUSIVE MODE")
        row = conn.execute("SELECT embedding_version, previous_version FROM ai.active_index").fetchone()
        if row is None or row[1] is None:
            raise SystemExit("no previous version to roll back to")
        conn.execute("UPDATE ai.model_versions SET status = 'RETIRED' WHERE embedding_version = %s", (row[0],))
        conn.execute(
            "UPDATE ai.model_versions SET status = 'ACTIVE', activated_at = now() WHERE embedding_version = %s",
            (row[1],),
        )
        conn.execute(
            "UPDATE ai.active_index SET embedding_version = %s, previous_version = %s, activated_at = now()",
            (row[1], row[0]),
        )
    print(json.dumps({"active": row[1], "rolledBackFrom": row[0]}))


def status(_: argparse.Namespace) -> None:
    with connect("AI_VECTOR_INGEST_DATABASE_URL") as conn:
        active = conn.execute("SELECT embedding_version FROM ai.active_index").fetchone()
        versions = conn.execute(
            "SELECT m.embedding_version, m.status, m.expected_images, count(e.product_image_id), "
            "count(DISTINCT e.product_id) FROM ai.model_versions m LEFT JOIN ai.product_image_embeddings e "
            "USING (embedding_version) GROUP BY 1, 2, 3 ORDER BY 1"
        ).fetchall()
        eligible = one(conn.execute("SELECT count(*), count(DISTINCT product_id) FROM ai.catalog_images").fetchone())
    print(
        json.dumps(
            {
                "active": active[0] if active else None,
                "eligibleImages": eligible[0],
                "eligibleProducts": eligible[1],
                "versions": [
                    {"embeddingVersion": v, "status": s, "expected": e, "images": n, "products": p}
                    for v, s, e, n, p in versions
                ],
            },
            indent=2,
        )
    )


def main(argv: list[str]) -> None:
    parser = argparse.ArgumentParser(prog="python -m app.ingest")
    sub = parser.add_subparsers(dest="command", required=True)
    staging = sub.add_parser("stage")
    staging.add_argument("--artifact-dir", type=Path, required=True)
    staging.add_argument("--catalog-root", type=Path, required=True)
    staging.add_argument("--threads", type=int, default=4)
    staging.set_defaults(run=stage)
    activation = sub.add_parser("activate")
    activation.add_argument("--embedding-version", required=True)
    activation.set_defaults(run=activate)
    sub.add_parser("rollback").set_defaults(run=rollback)
    sub.add_parser("status").set_defaults(run=status)
    args = parser.parse_args(argv)
    args.run(args)


if __name__ == "__main__":
    main(sys.argv[1:])
