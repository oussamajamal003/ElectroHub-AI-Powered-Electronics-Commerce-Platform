#!/usr/bin/env python3
"""Disposable-only real D3/PostgreSQL media-freshness proof for Task 04.3.

Reads apps/backend/.isolated-docker/media-qa.json; verifies the exact loopback:55434
electrohub_disposable_media_* target and TLS before creating uniquely named roles/fixtures.
Uses no hosted credentials, and removes all QA rows and LOGIN roles in finally.
"""
from __future__ import annotations

import hashlib
import argparse
import faulthandler
import json
import re
import secrets
import sys
import threading
import time
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit
from uuid import UUID, uuid4

import numpy as np
import psycopg
from psycopg import sql
from psycopg.conninfo import make_conninfo

BACKEND = Path(__file__).resolve().parents[1]
PROJECT = BACKEND.parent.parent
CONFIG = BACKEND / ".isolated-docker" / "media-qa.json"
ASCII_CA = Path.home() / ".electrohub-isolated" / "ca.crt"
ARTIFACT = PROJECT / "apps/ai-service/models/siglip2-b16-p256-d1"
IMAGE_A = PROJECT / "apps/frontend/public/images/catalog/headphones.jpg"
IMAGE_B = PROJECT / "apps/frontend/public/images/catalog/laptops.jpg"
DB_NAME = re.compile(r"^electrohub_disposable_media_[a-z0-9]+$")
MAX_BYTES = 12 * 1024 * 1024


class QaFailure(RuntimeError):
    pass


def progress(phase: str) -> None:
    print(f"product-media-ai-qa: phase={phase}", file=sys.stderr, flush=True)


@dataclass(frozen=True)
class Canonical:
    name: str
    data: bytes
    digest: str
    width: int
    height: int


def need(ok: bool, message: str) -> None:
    if not ok:
        raise QaFailure(message)


def config() -> tuple[dict[str, Any], str, str, Path]:
    need(CONFIG.is_file() and CONFIG.resolve().parent == (BACKEND / ".isolated-docker").resolve(),
         "isolated QA config missing or outside approved folder")
    try:
        env = json.loads(CONFIG.read_text(encoding="utf-8"))
        dsn, run, ca_value = env["DATABASE_URL"], env["PRODUCT_MEDIA_QA_RUN"], env["DB_SSL_CA_CERT_PATH"]
        parts = urlsplit(dsn)
        database = parts.path.lstrip("/")
        ca = Path(ca_value).expanduser()
    except Exception as exc:
        raise QaFailure("isolated QA config is invalid or incomplete") from exc
    need(parts.scheme in {"postgres", "postgresql"}, "database protocol is not PostgreSQL")
    need((parts.hostname or "").lower() in {"localhost", "127.0.0.1", "::1"} and parts.port == 55434,
         "database target is not approved loopback:55434")
    need(bool(DB_NAME.fullmatch(database)) and database == run, "database name/run tag do not match disposable pattern")
    need(ca.is_file() and ASCII_CA.is_file(), "isolated CA or verified ASCII-path copy is missing")
    try:
        need(hashlib.sha256(ca.read_bytes()).digest() == hashlib.sha256(ASCII_CA.read_bytes()).digest(),
             "ASCII-path CA copy differs from isolated config certificate")
    except OSError as exc:
        raise QaFailure("isolated CA certificate could not be verified") from exc
    return env, dsn, database, ASCII_CA


def admin_dsn(raw: str, ca: Path) -> str:
    # The guarded target is a local IPv4 WSL forwarding socket. Preserve the
    # localhost hostname for TLS verification while avoiding Windows IPv6 waits.
    return make_conninfo(raw, hostaddr="127.0.0.1", sslmode="verify-full", sslrootcert=str(ca), connect_timeout=5,
                         application_name="product-media-ai-qa-admin", options="-c statement_timeout=20000")


def preflight(dsn: str, database: str) -> None:
    try:
        with psycopg.connect(dsn) as conn:
            row = conn.execute(
                "SELECT current_database(),ssl,(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) "
                "FROM pg_stat_ssl WHERE pid=pg_backend_pid()"
            ).fetchone()
            need(row is not None and row[0] == database and bool(DB_NAME.fullmatch(row[0])), "connected database identity mismatch")
            need(row[1] is True, "PostgreSQL TLS is not active")
            need(row[2] is True, "isolated QA database role cannot provision disposable LOGIN roles")
            need(conn.execute("SELECT count(*) FROM ai.active_index").fetchone()[0] == 0,
                 "isolated database already has an active model; refusing pointer change")
            need(conn.execute("SELECT count(*) FROM public.catalog_media_events").fetchone()[0] == 0,
                 "isolated database has queued media events; refusing to let the worker consume unrelated work")
            need(conn.execute("SELECT to_regclass('ai.media_image_embeddings')").fetchone()[0] is not None,
                 "overlay migration is not installed")
            need(conn.execute("SELECT to_regclass('ai.catalog_media_sources')").fetchone()[0] is not None,
                 "media-source view is not installed")
            need(conn.execute("SELECT to_regprocedure('ai.publish_media_embedding(uuid,uuid,character varying,character varying,character varying,character,uuid,uuid,uuid,character,extensions.vector)')").fetchone()[0] is not None,
                 "media publication function is not installed")
    except QaFailure:
        raise
    except Exception as exc:
        raise QaFailure(f"isolated PostgreSQL preflight failed ({type(exc).__name__})") from exc


def canonical(path: Path) -> Canonical:
    from io import BytesIO
    from PIL import Image, ImageOps
    try:
        with Image.open(path) as im:
            oriented = ImageOps.exif_transpose(im)
            w, h = oriented.size
            need(getattr(im, "n_frames", 1) == 1, f"{path.name} is multi-frame")
            need(w >= 128 and h >= 128 and w <= 6000 and h <= 6000 and w * h <= 20_000_000,
                 f"{path.name} exceeds image dimension policy")
            if oriented.mode in {"RGBA", "LA"} or "transparency" in oriented.info:
                rgba = oriented.convert("RGBA")
                bg = Image.new("RGBA", rgba.size, "white")
                bg.alpha_composite(rgba)
                rgb = bg.convert("RGB")
            else:
                rgb = oriented.convert("RGB")
            out = BytesIO()
            rgb.save(out, format="WEBP", quality=90, method=4)
            data = out.getvalue()
    except QaFailure:
        raise
    except Exception as exc:
        raise QaFailure(f"{path.name} normalization failed ({type(exc).__name__})") from exc
    need(bool(data) and len(data) <= MAX_BYTES, f"{path.name} canonical bytes exceed worker limit")
    return Canonical(path.name, data, hashlib.sha256(data).hexdigest(), w, h)


class ObjectServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, objects: dict[str, bytes]) -> None:
        self.objects = objects
        self.requests: dict[str, str] = {}
        super().__init__(("127.0.0.1", 0), Handler)


class Handler(BaseHTTPRequestHandler):
    server: ObjectServer

    def do_GET(self) -> None:  # noqa: N802
        self.server.requests[self.path] = "RECEIVED"
        data = self.server.objects.get(self.path)
        if data is None:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", "image/webp")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)
        self.wfile.flush()
        self.server.requests[self.path] = "SENT"

    def log_message(self, _format: str, *_args: object) -> None:
        return


def role_dsns(dsn: str, conn: psycopg.Connection[Any], suffix: str, ca: Path) -> tuple[str, str, list[str]]:
    reader, worker = f"media_qa_reader_{suffix}", f"media_qa_worker_{suffix}"
    passwords = {reader: secrets.token_hex(32), worker: secrets.token_hex(32)}
    for role, parent in ((reader, "ai_vector_reader"), (worker, "ai_media_worker")):
        conn.execute(sql.SQL("CREATE ROLE {} LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS CONNECTION LIMIT 4 PASSWORD {}")
                     .format(sql.Identifier(role), sql.Literal(passwords[role])))
        conn.execute(sql.SQL("GRANT {} TO {}").format(sql.Identifier(parent), sql.Identifier(role)))
    conn.commit()
    common = {"sslmode": "verify-full", "sslrootcert": str(ca), "connect_timeout": 5,
              "options": "-c search_path=ai,extensions,public -c statement_timeout=15000"}
    rd = make_conninfo(dsn, user=reader, password=passwords[reader], application_name="media-qa-reader", **common)
    wd = make_conninfo(dsn, user=worker, password=passwords[worker], application_name="media-qa-worker", **common)
    return rd, wd, [reader, worker]


def vec_literal(vector: Any) -> str:
    return "[" + ",".join(f"{float(x):.8f}" for x in vector) + "]"


def vector(encoder: Any, data: bytes) -> Any:
    from app.processors.image import decode_image
    return encoder.encode(decode_image(data))


def event(conn: psycopg.Connection[Any], *, event_id: UUID, product: UUID, image: UUID,
          revision: UUID, digest: str, key: str, earlier: int = 0) -> None:
    conn.execute(
        'INSERT INTO public.catalog_media_events (id,"idempotencyKey","requestSha256","productId","productImageId",operation,'
        '"sourceRevision","sourceSha256",state,"attemptCount","nextAttemptAt","createdAt","updatedAt") '
        "VALUES (%s,%s,%s,%s,%s,'REPLACED',%s,%s,'READY',0,now(),now()-(%s*interval '1 second'),now())",
        (event_id, key, hashlib.sha256(key.encode()).hexdigest(), product, image, revision, digest, earlier),
    )


def process_expected(worker: Any, event_id: UUID, label: str) -> bool:
    claimed = worker.claim()
    need(claimed is not None and claimed.event_id == event_id,
         f"worker claimed an unexpected event before {label}")
    return worker.process(claimed)


def defer_retry(dsn: str, event_id: UUID) -> None:
    """Keep an intentionally failing disposable event from being reclaimed during later proofs."""
    with psycopg.connect(dsn) as conn:
        updated = conn.execute(
            'UPDATE public.catalog_media_events SET "nextAttemptAt"=now()+interval \'1 hour\' '
            'WHERE id=%s AND state=\'RETRY_WAIT\'', (event_id,)).rowcount
        need(updated == 1, "expected failure event did not enter RETRY_WAIT before deferral")
        conn.commit()


class SearchReader:
    """Exercise the production gateway or its exact SQL under the restricted reader LOGIN."""

    def __init__(self, loop: Any, gateway: Any, dsn: str, descriptor: Any,
                 mode: str = "PGVECTOR_GATEWAY") -> None:
        self.loop, self.gateway, self.dsn, self.descriptor = loop, gateway, dsn, descriptor
        self.mode = mode
        from app.integrations.pgvector_gateway import _NEAREST_SQL
        self.nearest_sql = _NEAREST_SQL

    def nearest(self, query: Any) -> list[tuple[UUID, float]]:
        if self.mode == "PGVECTOR_GATEWAY":
            ranked = self.loop.run_until_complete(self.gateway.nearest(
                [float(x) for x in query], top_k=5, descriptor=self.descriptor))
            return [(UUID(str(row.product_id)), float(row.score)) for row in ranked]
        literal = "[" + ",".join(f"{float(x):.8f}" for x in query) + "]"
        with psycopg.connect(self.dsn) as conn:
            rows = conn.execute(self.nearest_sql, (self.descriptor.embedding_version,
                self.descriptor.embedding_version, literal, 5)).fetchall()
        return [(UUID(str(row[0])), 1.0 - float(row[1])) for row in rows]


def rank(reader: SearchReader, query: Any, product: UUID, expected: bool, phase: str,
         expected_score: float | None = None) -> None:
    progress("reader-query: " + phase)
    rows = reader.nearest(query)
    progress("reader-result: " + phase)
    found = any(row[0] == product for row in rows)
    need(found == expected, f"reader freshness assertion failed: {phase}")
    if expected:
        need(bool(rows) and rows[0][0] == product, f"D3 nearest ranking failed: {phase}")
        if expected_score is not None:
            need(abs(rows[0][1] - expected_score) < 0.015,
                 f"reader returned stale vector score: {phase}")


def denied(dsn: str, statement: str, label: str) -> None:
    try:
        with psycopg.connect(dsn) as conn:
            conn.execute(statement)
    except psycopg.errors.InsufficientPrivilege:
        return
    except psycopg.Error as exc:
        if exc.sqlstate == "42501":
            return
        raise QaFailure(f"privilege probe failed unexpectedly: {label} ({exc.sqlstate or type(exc).__name__})") from exc
    raise QaFailure(f"privilege probe unexpectedly succeeded: {label}")


def run(direct_sql_reader: bool = False) -> dict[str, Any]:
    import asyncio
    import selectors

    env, raw_dsn, database, ca = config()
    dsn = admin_dsn(raw_dsn, ca)
    progress("target-configuration-read")
    preflight(dsn, database)  # no DB writes before exact target and TLS assertions
    progress("disposable-target-and-tls-verified")
    sys.path.insert(0, str(PROJECT / "apps/ai-service"))
    from app.core.logging import configure_logging
    configure_logging("INFO")
    from app.models.siglip_loader import load_encoder

    need(ARTIFACT.is_dir() and (ARTIFACT / "descriptor.json").is_file(), "pinned D3 artifact unavailable")
    need(IMAGE_A.is_file() and IMAGE_B.is_file(), "catalog source images unavailable")
    descriptor_json = json.loads((ARTIFACT / "descriptor.json").read_text(encoding="utf-8"))
    progress("load-pinned-d3-artifact")
    encoder = load_encoder(ARTIFACT, torch_threads=1)
    descriptor = encoder.descriptor
    need(descriptor.embedding_version == descriptor_json.get("embeddingVersion") and
         descriptor.artifact_sha256 == descriptor_json.get("artifactSha256") and descriptor.embedding_dimension == 256,
         "loaded D3 descriptor identity mismatch")
    a, b = canonical(IMAGE_A), canonical(IMAGE_B)
    progress("run-real-d3-inference-a-and-b")
    va, vb = vector(encoder, a.data), vector(encoder, b.data)
    need(len(va) == len(vb) == descriptor.embedding_dimension, "D3 output dimension mismatch")

    suffix = uuid4().hex[:12]
    product, category, image_id = uuid4(), uuid4(), uuid4()
    rev_a, rev_b = uuid4(), uuid4()
    event_a, event_b, stale_a = uuid4(), uuid4(), uuid4()
    bad_digest, lost_lease, wrong_model, retired_event = (uuid4() for _ in range(4))
    version = descriptor.embedding_version
    objects: dict[str, bytes] = {}
    path_a = f"/storage/v1/object/public/product-media/products/{product}/{image_id}/{rev_a}/original.webp"
    path_b = f"/storage/v1/object/public/product-media/products/{product}/{image_id}/{rev_b}/original.webp"
    objects[path_a], objects[path_b] = a.data, b.data
    server: ObjectServer | None = None
    gateway: Any = None
    loop = None
    if not direct_sql_reader:
        loop = asyncio.SelectorEventLoop(selectors.SelectSelector())
        asyncio.set_event_loop(loop)
    worker: Any = None
    roles: list[str] = []
    fixture = False
    evidence: dict[str, Any] = {
        "database": database, "tls": "verify-full", "embeddingVersion": version,
        "modelVersion": descriptor.model_version, "preprocessVersion": descriptor.preprocess_version,
        "artifactSha256": descriptor.artifact_sha256, "dimension": descriptor.embedding_dimension,
        "imageA": {"source": a.name, "sha256": a.digest, "width": a.width, "height": a.height, "bytes": len(a.data)},
        "imageB": {"source": b.name, "sha256": b.digest, "width": b.width, "height": b.height, "bytes": len(b.data)},
    }
    try:
        progress("model-and-canonical-images-ready")
        server = ObjectServer(objects)
        threading.Thread(target=server.serve_forever, daemon=True, name="media-qa-object-server").start()
        base_url = f"http://127.0.0.1:{server.server_address[1]}"
        url_a, url_b = base_url + path_a, base_url + path_b
        progress("create-isolated-fixture-and-active-d3-pointer")
        with psycopg.connect(dsn) as conn:
            need(conn.execute("SELECT count(*) FROM ai.model_versions WHERE embedding_version=%s", (version,)).fetchone()[0] == 0,
                 "D3 descriptor already registered in disposable DB")
            before = conn.execute("SELECT count(*) FROM ai.product_image_embeddings WHERE embedding_version=%s", (version,)).fetchone()[0]
            need(before == 0, "D3 base snapshot is not empty in disposable DB")
            now = "now()"
            conn.execute('INSERT INTO public.categories (id,name,slug,"isActive","createdAt","updatedAt") VALUES (%s,%s,%s,true,now(),now())',
                         (category, f"Media QA {suffix}", f"media-qa-{suffix}"))
            conn.execute('INSERT INTO public.products (id,"categoryId",sku,name,slug,price,status,"isTestFixture","storefrontVisible","createdAt","updatedAt") '
                         "VALUES (%s,%s,%s,%s,%s,1.00,'ACTIVE',false,true,now(),now())",
                         (product, category, f"MEDIA-QA-{suffix}", f"Media QA D3 {suffix}", f"media-qa-d3-{suffix}"))
            conn.execute('INSERT INTO public.product_images (id,"productId",url,"position","isPrimary","storageProvider","mediaState","createdAt","updatedAt") '
                         "VALUES (%s,%s,%s,0,true,'LEGACY_LOCAL','PUBLISHED',now(),now())",
                         (image_id, product, "/images/catalog/headphones.jpg"))
            conn.execute("INSERT INTO ai.model_versions (embedding_version,model_version,preprocess_version,embedding_dimension,artifact_format,artifact_sha256,expected_images) "
                         "VALUES (%s,%s,%s,%s,%s,%s,1)",
                         (version, descriptor.model_version, descriptor.preprocess_version, descriptor.embedding_dimension,
                          descriptor.artifact_format, descriptor.artifact_sha256))
            conn.execute("INSERT INTO ai.product_image_embeddings (product_image_id,product_id,embedding_version,image_sha256,embedding) "
                         "VALUES (%s,%s,%s,%s,%s::extensions.vector)", (image_id, product, version, a.digest, vec_literal(va)))
            conn.execute("UPDATE ai.model_versions SET status='VERIFIED',verified_at=now() WHERE embedding_version=%s", (version,))
            conn.execute("UPDATE ai.model_versions SET status='ACTIVE',activated_at=now() WHERE embedding_version=%s", (version,))
            conn.execute("INSERT INTO ai.active_index (singleton,embedding_version) VALUES (true,%s)", (version,))
            conn.commit()
            fixture = True
            base_count = before + 1

        reader_dsn = worker_dsn = None
        with psycopg.connect(dsn) as conn:
            reader_dsn, worker_dsn, roles = role_dsns(dsn, conn, suffix, ca)
        assert reader_dsn and worker_dsn
        with psycopg.connect(reader_dsn) as conn:
            need(conn.execute("SELECT current_user").fetchone()[0] == roles[0], "reader LOGIN identity mismatch")
        with psycopg.connect(worker_dsn) as conn:
            need(conn.execute("SELECT current_user").fetchone()[0] == roles[1], "worker LOGIN identity mismatch")
        denied(reader_dsn, "SELECT id FROM public.users LIMIT 0", "reader cannot read users")
        denied(reader_dsn, "UPDATE ai.active_index SET embedding_version=embedding_version WHERE singleton", "reader cannot switch index")
        denied(worker_dsn, "SELECT id FROM public.users LIMIT 0", "worker cannot read users")
        denied(worker_dsn, f"UPDATE ai.product_image_embeddings SET image_sha256=image_sha256 WHERE embedding_version='{version}'",
               "worker cannot rewrite base snapshot")
        evidence["leastPrivilege"] = {"readerPublicUsers": "DENIED", "readerActivePointerWrite": "DENIED",
                                      "workerPublicUsers": "DENIED", "workerBaseWrite": "DENIED"}

        from app.integrations.pgvector_gateway import _ACTIVE_SQL, _COVERAGE_SQL, _identity_matches
        try:
            with psycopg.connect(reader_dsn) as reader_conn:
                active_row = reader_conn.execute(_ACTIVE_SQL).fetchone()
                coverage = reader_conn.execute(_COVERAGE_SQL,
                    (descriptor.embedding_version, descriptor.embedding_version)).fetchone()
        except psycopg.Error as exc:
            raise QaFailure(f"restricted reader ACTIVE/COVERAGE SQL failed ({exc.sqlstate or type(exc).__name__})") from exc
        need(active_row is not None and _identity_matches(active_row, descriptor) and int(active_row[7]) > 0,
             "restricted reader SQL could not validate the exact active D3 descriptor")
        need(coverage is not None and int(coverage[0]) >= 1 and int(coverage[1]) >= 1,
             "restricted reader SQL found no eligible D3 coverage")
        if direct_sql_reader:
            reader = SearchReader(None, None, reader_dsn, descriptor, mode="DIRECT_RESTRICTED_SQL")
        else:
            from app.integrations.pgvector_gateway import PgVectorGateway
            gateway = PgVectorGateway(dsn=reader_dsn)
            assert loop is not None
            gateway_ready = loop.run_until_complete(gateway.is_ready(descriptor))
            reader = SearchReader(loop, gateway, reader_dsn, descriptor)
            if not gateway_ready:
                raise QaFailure("Async pgvector gateway reported index unavailable; use --direct-sql-reader for bounded SQL-only proof")
        progress("restricted-reader-descriptor-and-coverage-verified")
        evidence["readerMode"] = reader.mode
        evidence["readerActiveIdentity"] = "VERIFIED"
        evidence["readerCoverage"] = {"eligible": int(coverage[0]), "indexed": int(coverage[1])}
        rank(reader, va, product, True, "legacy A baseline")
        evidence["baseline"] = "legacy source A ranked first via " + reader.mode
        from app.media_sync import MediaSyncWorker
        worker = MediaSyncWorker(dsn=worker_dsn, encoder=encoder, storage_base_url=base_url,
                                 catalog_root=PROJECT / "apps/frontend/public")

        # Publish first canonical A revision through the actual worker.
        with psycopg.connect(dsn) as conn:
            conn.execute('UPDATE public.product_images SET url=%s,"storageProvider"=\'SUPABASE_STORAGE\',"storageBucket"=\'product-media\',"storagePath"=%s,'
                         '"sourceRevision"=%s,"sourceSha256"=%s,"sourceMimeType"=\'image/webp\',width=%s,height=%s,"byteSize"=%s,"updatedAt"=now() WHERE id=%s',
                         (url_a, f"products/{product}/{image_id}/{rev_a}/original.webp", rev_a, a.digest, a.width, a.height, len(a.data), image_id))
            event(conn, event_id=event_a, product=product, image=image_id, revision=rev_a, digest=a.digest, key=f"media-qa-{suffix}-a")
            conn.commit()
        progress("worker-publish-a")
        a_started = time.perf_counter()
        a_processed = process_expected(worker, event_a, "A publication")
        a_elapsed = time.perf_counter() - a_started
        with psycopg.connect(dsn) as conn:
            state, error_code, attempts = conn.execute(
                'SELECT state,"lastErrorCode","attemptCount" FROM public.catalog_media_events WHERE id=%s',
                (event_a,)).fetchone()
            overlay_a = conn.execute("SELECT source_revision::text,source_sha256 FROM ai.media_image_embeddings WHERE embedding_version=%s AND product_image_id=%s", (version, image_id)).fetchone()
        need(state == "COMPLETED" and overlay_a == (str(rev_a), a.digest),
             f"worker A publication mismatch: processed={a_processed} elapsedSeconds={a_elapsed:.3f} state={state} errorCode={error_code} attempts={attempts} overlayPresent={overlay_a is not None} identityMatches={overlay_a == (str(rev_a), a.digest)}")
        rank(reader, va, product, True, "published A overlay")

        # Commit B while worker is idle; A must disappear from the reader snapshot before any worker resumes.
        with psycopg.connect(dsn) as conn:
            conn.execute('UPDATE public.product_images SET url=%s,"storagePath"=%s,"sourceRevision"=%s,"sourceSha256"=%s,'
                         'width=%s,height=%s,"byteSize"=%s,"updatedAt"=now() WHERE id=%s',
                         (url_b, f"products/{product}/{image_id}/{rev_b}/original.webp", rev_b, b.digest, b.width, b.height, len(b.data), image_id))
            event(conn, event_id=stale_a, product=product, image=image_id, revision=rev_a, digest=a.digest, key=f"media-qa-{suffix}-stale-a", earlier=10)
            event(conn, event_id=event_b, product=product, image=image_id, revision=rev_b, digest=b.digest, key=f"media-qa-{suffix}-b")
            conn.commit()
        rank(reader, va, product, False, "A-to-B commit with worker stopped")
        rank(reader, vb, product, False, "B remains pending before worker")
        evidence["replacementImmediate"] = {"revision": str(rev_b), "digest": b.digest, "AExcluded": True, "BPending": True}
        progress("replace-a-with-b-and-consume-stale-event")
        need(process_expected(worker, stale_a, "stale A supersession"), "worker did not consume stale A event")
        with psycopg.connect(dsn) as conn:
            stale_state = conn.execute('SELECT state FROM public.catalog_media_events WHERE id=%s', (stale_a,)).fetchone()[0]
        need(stale_state == "SUPERSEDED", "stale A event was not superseded")
        rank(reader, va, product, False, "stale A event consumed")
        b_started = time.perf_counter()
        b_processed = process_expected(worker, event_b, "B publication")
        b_elapsed = time.perf_counter() - b_started
        with psycopg.connect(dsn) as conn:
            b_state, b_error, b_attempts = conn.execute(
                'SELECT state,"lastErrorCode","attemptCount" FROM public.catalog_media_events WHERE id=%s',
                (event_b,)).fetchone()
            overlay_b = conn.execute("SELECT source_revision::text,source_sha256 FROM ai.media_image_embeddings WHERE embedding_version=%s AND product_image_id=%s", (version, image_id)).fetchone()
            active = conn.execute("SELECT embedding_version FROM ai.active_index WHERE singleton").fetchone()[0]
            base_after = conn.execute("SELECT count(*) FROM ai.product_image_embeddings WHERE embedding_version=%s", (version,)).fetchone()[0]
        need(b_state == "COMPLETED" and overlay_b == (str(rev_b), b.digest),
             f"worker B publication mismatch: processed={b_processed} elapsedSeconds={b_elapsed:.3f} state={b_state} errorCode={b_error} attempts={b_attempts} overlayPresent={overlay_b is not None} identityMatches={overlay_b == (str(rev_b), b.digest)} objectRequest={server.requests.get(path_b, 'NOT_RECEIVED')}")
        need(active == version and base_after == base_count, "worker changed active D3 pointer or base snapshot")
        rank(reader, vb, product, True, "B overlay published")
        rank(reader, va, product, True, "current B vector answers former A query",
             expected_score=float(np.dot(va / np.linalg.norm(va), vb / np.linalg.norm(vb))))
        evidence["workerPublication"] = {"eventState": b_state, "revision": overlay_b[0], "digest": overlay_b[1],
                                         "BSearchable": True, "formerAQueryUsesCurrentB": True, "activeVersionUnchanged": active,
                                         "baseRowsUnchanged": base_after}

        # Digest mismatch: bytes at the trusted immutable key change, but source identity still claims B.
        progress("digest-lease-and-model-failure-guards")
        objects[path_b] = a.data
        progress("retirement-exclusion-and-overlay-retention")
        with psycopg.connect(dsn) as conn:
            event(conn, event_id=bad_digest, product=product, image=image_id, revision=rev_b,
                  digest=b.digest, key=f"media-qa-{suffix}-bad-digest")
            conn.commit()
        process_expected(worker, bad_digest, "digest mismatch guard")
        with psycopg.connect(dsn) as conn:
            digest_result = conn.execute('SELECT state,"lastErrorCode" FROM public.catalog_media_events WHERE id=%s', (bad_digest,)).fetchone()
            after_bad = conn.execute("SELECT source_revision::text,source_sha256 FROM ai.media_image_embeddings WHERE embedding_version=%s AND product_image_id=%s", (version, image_id)).fetchone()
        need(digest_result == ("RETRY_WAIT", "SOURCE_DIGEST_MISMATCH") and after_bad == overlay_b,
             "digest mismatch was not safely rejected")
        defer_retry(dsn, bad_digest)
        objects[path_b] = b.data

        # Replace the lease after claim; SECURITY DEFINER publication must refuse the stale token.
        with psycopg.connect(dsn) as conn:
            event(conn, event_id=lost_lease, product=product, image=image_id, revision=rev_b,
                  digest=b.digest, key=f"media-qa-{suffix}-lost-lease")
            conn.commit()
        claimed = worker.claim()
        need(claimed is not None and claimed.event_id == lost_lease, "worker claimed an unexpected event before lease guard")
        new_lease = uuid4()
        with psycopg.connect(dsn) as conn:
            conn.execute('UPDATE public.catalog_media_events SET "leaseToken"=%s WHERE id=%s', (new_lease, lost_lease))
            conn.commit()
        need(worker.process(claimed) is False, "worker accepted superseded lease token")
        with psycopg.connect(dsn) as conn:
            lease_row = conn.execute('SELECT state,"leaseToken" FROM public.catalog_media_events WHERE id=%s', (lost_lease,)).fetchone()
            after_lease = conn.execute("SELECT source_revision::text,source_sha256 FROM ai.media_image_embeddings WHERE embedding_version=%s AND product_image_id=%s", (version, image_id)).fetchone()
        need(lease_row == ("CLAIMED", new_lease) and after_lease == overlay_b, "lost lease mutated event ownership or overlay")

        # Wrong descriptor must retry without publishing a mixed-model vector.
        with psycopg.connect(dsn) as conn:
            event(conn, event_id=wrong_model, product=product, image=image_id, revision=rev_b,
                  digest=b.digest, key=f"media-qa-{suffix}-wrong-model")
            conn.commit()
        from types import SimpleNamespace
        wrong = descriptor.model_copy(update={"model_version": descriptor.model_version + ".wrong"})
        wrong_worker = MediaSyncWorker(dsn=worker_dsn,
            encoder=SimpleNamespace(descriptor=wrong, encode=encoder.encode), storage_base_url=base_url,
            catalog_root=PROJECT / "apps/frontend/public")
        process_expected(wrong_worker, wrong_model, "wrong-model guard")
        with psycopg.connect(dsn) as conn:
            wrong_result = conn.execute('SELECT state,"lastErrorCode" FROM public.catalog_media_events WHERE id=%s', (wrong_model,)).fetchone()
            after_wrong = conn.execute("SELECT source_revision::text,source_sha256 FROM ai.media_image_embeddings WHERE embedding_version=%s AND product_image_id=%s", (version, image_id)).fetchone()
        need(wrong_result == ("RETRY_WAIT", "ACTIVE_MODEL_MISMATCH") and after_wrong == overlay_b,
             "wrong descriptor was not rejected safely")
        defer_retry(dsn, wrong_model)

        # A retirement mutation removes B from the read view immediately and preserves overlay history.
        with psycopg.connect(dsn) as conn:
            conn.execute('UPDATE public.product_images SET "mediaState"=\'RETIRED\',"retiredAt"=now(),"isPrimary"=false,"updatedAt"=now() WHERE id=%s', (image_id,))
            event(conn, event_id=retired_event, product=product, image=image_id, revision=rev_b,
                  digest=b.digest, key=f"media-qa-{suffix}-retired")
            conn.commit()
        rank(reader, vb, product, False, "retired source immediate exclusion")
        need(process_expected(worker, retired_event, "retirement consumption"), "worker did not consume retire event")
        with psycopg.connect(dsn) as conn:
            retire_state = conn.execute('SELECT state FROM public.catalog_media_events WHERE id=%s', (retired_event,)).fetchone()[0]
            retained = conn.execute("SELECT count(*) FROM ai.media_image_embeddings WHERE embedding_version=%s AND product_image_id=%s", (version, image_id)).fetchone()[0]
        need(retire_state == "SUPERSEDED" and retained == 1, "retire event removed audit overlay or failed to supersede")
        rank(reader, vb, product, False, "retired source after worker")
        evidence["failureGuards"] = {"digest": digest_result[1], "lease": "REJECTED", "wrongModel": wrong_result[1]}
        evidence["retirement"] = {"eventState": retire_state, "searchExcludedImmediately": True, "overlayRetained": retained == 1}
        evidence["readerMode"] = reader.mode
        evidence["result"] = "PASS"
        return evidence
    finally:
        if gateway is not None and loop is not None:
            try:
                loop.run_until_complete(gateway.close())
            except BaseException:
                pass
        if loop is not None:
            try:
                loop.close()
            except BaseException:
                pass
        if worker is not None:
            try:
                worker._encoder.close()
            except Exception:
                pass
        if server is not None:
            try:
                server.shutdown()
                server.server_close()
            except BaseException:
                pass
        cleanup_error: Exception | None = None
        if fixture:
            try:
                cleanup(dsn, product, category, image_id, version)
            except Exception as exc:
                cleanup_error = exc
        if roles:
            # These disposable LOGIN roles are uniquely named per run. Psycopg's
            # Windows async pool can retain sessions after close; never let role
            # cleanup obscure functional evidence or broaden cleanup privileges.
            try:
                drop_roles(dsn, roles)
            except Exception:
                evidence["roleCleanup"] = "INCOMPLETE; isolated disposable DB reset required"
        if cleanup_error:
            raise cleanup_error


def cleanup(dsn: str, product: UUID, category: UUID, image_id: UUID, version: str) -> None:
    try:
        with psycopg.connect(dsn) as conn:
            conn.execute('DELETE FROM public.catalog_media_events WHERE "productId"=%s', (product,))
            conn.execute("DELETE FROM ai.media_image_embeddings WHERE product_image_id=%s", (image_id,))
            conn.execute("DELETE FROM ai.product_image_embeddings WHERE product_image_id=%s AND embedding_version=%s", (image_id, version))
            conn.execute("DELETE FROM public.product_images WHERE id=%s", (image_id,))
            conn.execute("DELETE FROM public.products WHERE id=%s", (product,))
            conn.execute("DELETE FROM public.categories WHERE id=%s", (category,))
            conn.execute("DELETE FROM ai.active_index WHERE singleton AND embedding_version=%s", (version,))
            conn.execute("DELETE FROM ai.model_versions WHERE embedding_version=%s", (version,))
            conn.commit()
    except Exception as exc:
        raise QaFailure(f"QA fixture cleanup failed ({type(exc).__name__}); target remains disposable-only") from exc


def drop_roles(dsn: str, roles: list[str]) -> None:
    try:
        with psycopg.connect(dsn) as conn:
            for role in roles:
                conn.execute(sql.SQL("DROP ROLE IF EXISTS {}").format(sql.Identifier(role)))
            conn.commit()
    except Exception as exc:
        raise QaFailure(f"QA LOGIN role cleanup failed ({type(exc).__name__})") from exc


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--direct-sql-reader", action="store_true",
                        help="use exact pgvector gateway SQL under the restricted reader role; do not start async gateway pool")
    args = parser.parse_args()
    faulthandler.dump_traceback_later(60, repeat=True)
    try:
        result = run(direct_sql_reader=args.direct_sql_reader)
    except QaFailure as exc:
        print(f"product-media-ai-qa: FAIL: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"product-media-ai-qa: FAIL: unexpected {type(exc).__name__}", file=sys.stderr)
        return 1
    finally:
        faulthandler.cancel_dump_traceback_later()
    print("product-media-ai-qa: " + json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


