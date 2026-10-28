"""Durable, separate-process catalog media embedding worker (Task 04.3).

Run with ``python -m app.media_sync``. It consumes the backend's transactional media outbox, fetches only canonical
sources resolved from the private database view, and publishes compatible ACTIVE-version vectors through the narrow
``ai.publish_media_embedding`` SQL function. It never writes the immutable base snapshot or changes the active index.
"""

from __future__ import annotations

import argparse
import hashlib
import logging
import math
import os
import signal
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from uuid import UUID, uuid4

import psycopg

from app.core.config import ConfigurationError, get_settings
from app.core.logging import configure_logging, log_event
from app.models.descriptor import ModelDescriptor
from app.models.siglip_loader import load_encoder
from app.processors.image import decode_image

MAX_SOURCE_BYTES = 12 * 1024 * 1024
SOURCE_TIMEOUT_SECONDS = 10
LEASE_SECONDS = 120
MAX_ATTEMPTS = 12
POLL_SECONDS = 2.0
RECONCILE_INTERVAL_SECONDS = 30.0
RECONCILE_BATCH_SIZE = 100
HEARTBEAT_INTERVAL_SECONDS = 10.0
HEARTBEAT_STALE_AFTER_SECONDS = 60
HEARTBEAT_RETENTION_DAYS = 7

_CLAIM_SQL = """
WITH candidate AS (
    SELECT id FROM public.catalog_media_events
    WHERE state IN ('READY', 'RETRY_WAIT', 'CLAIMED')
      AND "nextAttemptAt" <= clock_timestamp()
      AND ("claimedUntil" IS NULL OR "claimedUntil" <= clock_timestamp())
    ORDER BY "createdAt", id
    FOR UPDATE SKIP LOCKED
    LIMIT 1
)
UPDATE public.catalog_media_events AS event
SET state = 'CLAIMED',
    "attemptCount" = event."attemptCount" + 1,
    "claimedUntil" = clock_timestamp() + (%s * interval '1 second'),
    "leaseToken" = %s::uuid,
    "updatedAt" = now()
FROM candidate
WHERE event.id = candidate.id
RETURNING event.id, event."productId", event."productImageId", event.operation,
          event."sourceRevision", event."sourceSha256", event."attemptCount", event."leaseToken"
"""

# Exact-ID claims are reserved for controlled one-shot QA and are used only after an operator
# has verified the event's ownership and current source eligibility.
_CLAIM_EVENT_SQL = """
WITH candidate AS (
    SELECT event.id FROM public.catalog_media_events AS event
    WHERE event.id = %s::uuid
      AND event.state IN ('READY', 'RETRY_WAIT', 'CLAIMED')
      AND event."nextAttemptAt" <= clock_timestamp()
      AND (event."claimedUntil" IS NULL OR event."claimedUntil" <= clock_timestamp())
    FOR UPDATE OF event SKIP LOCKED
    LIMIT 1
)
UPDATE public.catalog_media_events AS event
SET state = 'CLAIMED',
    "attemptCount" = event."attemptCount" + 1,
    "claimedUntil" = clock_timestamp() + (%s * interval '1 second'),
    "leaseToken" = %s::uuid,
    "updatedAt" = now()
FROM candidate
WHERE event.id = candidate.id
RETURNING event.id, event."productId", event."productImageId", event.operation,
          event."sourceRevision", event."sourceSha256", event."attemptCount", event."leaseToken"
"""

# A worker that dies repeatedly must not keep re-leasing an event forever. Bound the maintenance
# update so a backlog cannot make one poll transaction unbounded; SKIP LOCKED keeps workers parallel.
_EXHAUSTED_LEASE_SQL = """
WITH exhausted AS (
    SELECT id FROM public.catalog_media_events
    WHERE state = 'CLAIMED'
      AND "claimedUntil" <= clock_timestamp()
      AND "attemptCount" >= %s
    ORDER BY "claimedUntil", id
    FOR UPDATE SKIP LOCKED
    LIMIT 100
)
UPDATE public.catalog_media_events AS event
SET state = 'PERMANENT_FAILURE',
    "completedAt" = clock_timestamp(),
    "claimedUntil" = NULL,
    "leaseToken" = NULL,
    "lastErrorCode" = 'LEASE_EXHAUSTED',
    "updatedAt" = clock_timestamp()
FROM exhausted
WHERE event.id = exhausted.id
"""

_SOURCE_SQL = """
SELECT product_id, source_revision, source_sha256, eligible, storage_provider, storage_bucket, storage_path, url
FROM ai.catalog_media_sources
WHERE product_image_id = %s
"""

_RECONCILE_SQL = "SELECT ai.enqueue_missing_media_events(%s)"

_ACTIVE_SQL = """
SELECT a.embedding_version, m.model_version, m.preprocess_version, m.embedding_dimension,
       m.artifact_format, m.artifact_sha256, m.status
FROM ai.active_index AS a
JOIN ai.model_versions AS m ON m.embedding_version = a.embedding_version
WHERE a.singleton
"""

_READINESS_SQL = """
SELECT pg_has_role(current_user, 'ai_media_worker', 'MEMBER'),
       EXISTS (
           SELECT 1 FROM pg_roles AS runtime_role
           WHERE runtime_role.rolname = current_user
             AND runtime_role.rolcanlogin AND runtime_role.rolinherit
             AND NOT runtime_role.rolsuper AND NOT runtime_role.rolbypassrls
             AND NOT runtime_role.rolcreatedb AND NOT runtime_role.rolcreaterole
             AND NOT runtime_role.rolreplication
       ),
       NOT EXISTS (
           SELECT 1 FROM pg_auth_members AS membership
           JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
           WHERE membership.member = (SELECT oid FROM pg_roles WHERE rolname = current_user)
             AND granted_role.rolname <> 'ai_media_worker'
       ),
       NOT has_schema_privilege(current_user, 'ai', 'CREATE'),
       NOT has_schema_privilege(current_user, 'extensions', 'CREATE'),
       NOT has_schema_privilege(current_user, 'public', 'CREATE'),
       NOT EXISTS (
           SELECT 1
           FROM pg_class AS relation
           JOIN pg_namespace AS relation_schema ON relation_schema.oid = relation.relnamespace
           WHERE relation_schema.nspname IN ('ai', 'public')
             AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
             AND CASE
                 WHEN relation_schema.nspname = 'ai'
                      AND relation.relname IN ('catalog_media_sources', 'active_index', 'model_versions') THEN
                     has_table_privilege(current_user, relation.oid, 'INSERT')
                     OR has_table_privilege(current_user, relation.oid, 'UPDATE')
                     OR has_table_privilege(current_user, relation.oid, 'DELETE')
                     OR has_table_privilege(current_user, relation.oid, 'TRUNCATE')
                     OR has_table_privilege(current_user, relation.oid, 'REFERENCES')
                     OR has_table_privilege(current_user, relation.oid, 'TRIGGER')
                     OR has_any_column_privilege(current_user, relation.oid, 'INSERT')
                     OR has_any_column_privilege(current_user, relation.oid, 'UPDATE')
                     OR has_any_column_privilege(current_user, relation.oid, 'REFERENCES')
                 WHEN relation_schema.nspname = 'public' AND relation.relname = 'catalog_media_events' THEN
                     has_table_privilege(current_user, relation.oid, 'INSERT')
                     OR has_table_privilege(current_user, relation.oid, 'DELETE')
                     OR has_table_privilege(current_user, relation.oid, 'TRUNCATE')
                     OR has_table_privilege(current_user, relation.oid, 'REFERENCES')
                     OR has_table_privilege(current_user, relation.oid, 'TRIGGER')
                     OR has_any_column_privilege(current_user, relation.oid, 'INSERT')
                     OR has_any_column_privilege(current_user, relation.oid, 'REFERENCES')
                     OR EXISTS (
                         SELECT 1 FROM pg_attribute AS column_info
                         WHERE column_info.attrelid = relation.oid
                           AND column_info.attnum > 0 AND NOT column_info.attisdropped
                           AND (
                               (has_column_privilege(current_user, relation.oid, column_info.attname, 'SELECT')
                                AND column_info.attname NOT IN ('id', 'productId', 'productImageId', 'operation',
                                    'sourceRevision', 'sourceSha256', 'state', 'attemptCount', 'nextAttemptAt',
                                    'claimedUntil', 'leaseToken', 'createdAt'))
                               OR
                               (has_column_privilege(current_user, relation.oid, column_info.attname, 'UPDATE')
                                AND column_info.attname NOT IN ('state', 'attemptCount', 'nextAttemptAt',
                                    'claimedUntil', 'leaseToken', 'lastErrorCode', 'completedAt', 'updatedAt'))
                           )
                     )
                 WHEN relation_schema.nspname = 'ai' AND relation.relname = 'media_worker_heartbeats' THEN
                     has_table_privilege(current_user, relation.oid, 'TRUNCATE')
                     OR has_table_privilege(current_user, relation.oid, 'REFERENCES')
                     OR has_table_privilege(current_user, relation.oid, 'TRIGGER')
                 ELSE
                     has_table_privilege(current_user, relation.oid, 'SELECT')
                     OR has_table_privilege(current_user, relation.oid, 'INSERT')
                     OR has_table_privilege(current_user, relation.oid, 'UPDATE')
                     OR has_table_privilege(current_user, relation.oid, 'DELETE')
                     OR has_table_privilege(current_user, relation.oid, 'TRUNCATE')
                     OR has_table_privilege(current_user, relation.oid, 'REFERENCES')
                     OR has_table_privilege(current_user, relation.oid, 'TRIGGER')
                     OR has_any_column_privilege(current_user, relation.oid, 'SELECT')
                     OR has_any_column_privilege(current_user, relation.oid, 'INSERT')
                     OR has_any_column_privilege(current_user, relation.oid, 'UPDATE')
                     OR has_any_column_privilege(current_user, relation.oid, 'REFERENCES')
             END
       ),
       NOT EXISTS (
           SELECT 1 FROM pg_class AS sequence
           JOIN pg_namespace AS sequence_schema ON sequence_schema.oid = sequence.relnamespace
           WHERE sequence_schema.nspname IN ('ai', 'public') AND sequence.relkind = 'S'
             AND (has_sequence_privilege(current_user, sequence.oid, 'USAGE')
                  OR has_sequence_privilege(current_user, sequence.oid, 'SELECT')
                  OR has_sequence_privilege(current_user, sequence.oid, 'UPDATE'))
       ),
       NOT EXISTS (
           SELECT 1 FROM pg_namespace AS function_schema
           JOIN pg_proc AS privileged_function ON privileged_function.pronamespace = function_schema.oid
           WHERE function_schema.nspname IN ('ai', 'public')
             AND privileged_function.prosecdef
             AND NOT (function_schema.nspname = 'ai'
                      AND privileged_function.proname IN ('publish_media_embedding', 'enqueue_missing_media_events'))
             AND has_function_privilege(current_user, privileged_function.oid, 'EXECUTE')
       ),
       has_schema_privilege(current_user, 'ai', 'USAGE'),
       has_schema_privilege(current_user, 'extensions', 'USAGE'),
       has_schema_privilege(current_user, 'public', 'USAGE'),
       has_table_privilege(current_user, 'ai.catalog_media_sources', 'SELECT'),
       has_table_privilege(current_user, 'ai.active_index', 'SELECT'),
       has_table_privilege(current_user, 'ai.model_versions', 'SELECT'),
       has_column_privilege(current_user, 'public.catalog_media_events', 'id', 'SELECT')
         AND has_column_privilege(current_user, 'public.catalog_media_events', 'productId', 'SELECT')
         AND has_column_privilege(current_user, 'public.catalog_media_events', 'productImageId', 'SELECT')
         AND has_column_privilege(current_user, 'public.catalog_media_events', 'operation', 'SELECT')
         AND has_column_privilege(current_user, 'public.catalog_media_events', 'sourceRevision', 'SELECT')
         AND has_column_privilege(current_user, 'public.catalog_media_events', 'sourceSha256', 'SELECT')
         AND has_column_privilege(current_user, 'public.catalog_media_events', 'state', 'SELECT')
         AND has_column_privilege(current_user, 'public.catalog_media_events', 'attemptCount', 'SELECT')
         AND has_column_privilege(current_user, 'public.catalog_media_events', 'nextAttemptAt', 'SELECT')
         AND has_column_privilege(current_user, 'public.catalog_media_events', 'claimedUntil', 'SELECT')
         AND has_column_privilege(current_user, 'public.catalog_media_events', 'leaseToken', 'SELECT')
         AND has_column_privilege(current_user, 'public.catalog_media_events', 'createdAt', 'SELECT'),
       has_column_privilege(current_user, 'public.catalog_media_events', 'state', 'UPDATE'),
       has_column_privilege(current_user, 'public.catalog_media_events', 'attemptCount', 'UPDATE'),
       has_column_privilege(current_user, 'public.catalog_media_events', 'nextAttemptAt', 'UPDATE'),
       has_column_privilege(current_user, 'public.catalog_media_events', 'claimedUntil', 'UPDATE'),
       has_column_privilege(current_user, 'public.catalog_media_events', 'leaseToken', 'UPDATE'),
       has_column_privilege(current_user, 'public.catalog_media_events', 'lastErrorCode', 'UPDATE'),
       has_column_privilege(current_user, 'public.catalog_media_events', 'completedAt', 'UPDATE'),
       has_column_privilege(current_user, 'public.catalog_media_events', 'updatedAt', 'UPDATE'),
       has_table_privilege(current_user, 'ai.media_worker_heartbeats', 'SELECT'),
       has_table_privilege(current_user, 'ai.media_worker_heartbeats', 'INSERT'),
       has_table_privilege(current_user, 'ai.media_worker_heartbeats', 'UPDATE'),
       has_table_privilege(current_user, 'ai.media_worker_heartbeats', 'DELETE'),
       EXISTS (
           SELECT 1 FROM pg_proc p
           WHERE p.pronamespace = 'ai'::regnamespace AND p.proname = 'enqueue_missing_media_events'
             AND has_function_privilege(current_user, p.oid, 'EXECUTE')
       ),
       EXISTS (
           SELECT 1 FROM pg_proc p
           WHERE p.pronamespace = 'ai'::regnamespace AND p.proname = 'publish_media_embedding'
             AND has_function_privilege(current_user, p.oid, 'EXECUTE')
       )
"""

_HAS_HOSTED_MEDIA_SQL = """
SELECT EXISTS (
    SELECT 1 FROM ai.catalog_media_sources
    WHERE eligible AND storage_provider = 'SUPABASE_STORAGE'
)
"""

_HEARTBEAT_UPSERT_SQL = """
INSERT INTO ai.media_worker_heartbeats (
    worker_id, environment, state, heartbeat_at, active_model_version, current_event_id,
    processed_success_count, processed_failure_count, last_error_code
) VALUES (%s::uuid, %s, %s, clock_timestamp(), %s, %s::uuid, %s, %s, %s)
ON CONFLICT (worker_id) DO UPDATE SET
    environment = EXCLUDED.environment,
    state = EXCLUDED.state,
    heartbeat_at = clock_timestamp(),
    active_model_version = EXCLUDED.active_model_version,
    current_event_id = EXCLUDED.current_event_id,
    processed_success_count = EXCLUDED.processed_success_count,
    processed_failure_count = EXCLUDED.processed_failure_count,
    last_error_code = EXCLUDED.last_error_code
"""

_PURGE_OLD_HEARTBEATS_SQL = """
DELETE FROM ai.media_worker_heartbeats
WHERE heartbeat_at < clock_timestamp() - (%s * interval '1 day')
"""

_RELEASE_CLAIM_SQL = """
UPDATE public.catalog_media_events
SET state = 'RETRY_WAIT', "nextAttemptAt" = clock_timestamp(), "claimedUntil" = NULL,
    "leaseToken" = NULL, "lastErrorCode" = 'WORKER_SHUTDOWN', "updatedAt" = clock_timestamp()
WHERE id = %s::uuid AND state = 'CLAIMED' AND "leaseToken" = %s::uuid
"""

_PUBLISH_SQL = """
SELECT ai.publish_media_embedding(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::extensions.vector)
"""

_COMPLETE_SQL = """
UPDATE public.catalog_media_events
SET state = 'COMPLETED', "completedAt" = now(), "claimedUntil" = NULL, "leaseToken" = NULL,
    "lastErrorCode" = NULL, "updatedAt" = now()
WHERE id = %s AND state = 'CLAIMED' AND "leaseToken" = %s::uuid AND "claimedUntil" > clock_timestamp()
"""

_SUPERSEDE_SQL = """
UPDATE public.catalog_media_events
SET state = 'SUPERSEDED', "completedAt" = now(), "claimedUntil" = NULL, "leaseToken" = NULL,
    "lastErrorCode" = NULL, "updatedAt" = now()
WHERE id = %s AND state = 'CLAIMED' AND "leaseToken" = %s::uuid AND "claimedUntil" > clock_timestamp()
"""

_FAIL_SQL = """
UPDATE public.catalog_media_events
SET state = CASE WHEN "attemptCount" >= %s THEN 'PERMANENT_FAILURE' ELSE 'RETRY_WAIT' END,
    "nextAttemptAt" = now() + (%s * interval '1 second'),
    "claimedUntil" = NULL, "leaseToken" = NULL, "lastErrorCode" = %s, "updatedAt" = now()
WHERE id = %s AND state = 'CLAIMED' AND "leaseToken" = %s::uuid AND "claimedUntil" > clock_timestamp()
"""


class MediaSyncError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True, slots=True)
class MediaEvent:
    event_id: UUID
    product_id: UUID
    image_id: UUID
    operation: str
    source_revision: UUID | None
    source_sha256: str | None
    attempt_count: int
    lease_token: UUID


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req: Request, fp: Any, code: int, msg: str, headers: Any, newurl: str) -> None:
        return None


def _safe_sha256(value: object) -> str:
    digest = str(value or "").strip().lower()
    if len(digest) != 64 or any(char not in "0123456789abcdef" for char in digest):
        raise MediaSyncError("SOURCE_DIGEST_INVALID")
    return digest


def _resolve_local_catalog_file(root: Path, url: str) -> Path:
    if not url.startswith("/images/") or "\\" in url or "?" in url or "#" in url:
        raise MediaSyncError("SOURCE_NOT_TRUSTED")
    relative = PurePosixPath(url.lstrip("/"))
    if any(part in ("", ".", "..") for part in relative.parts):
        raise MediaSyncError("SOURCE_NOT_TRUSTED")
    root_resolved = root.resolve()
    candidate = (root_resolved / Path(*relative.parts)).resolve()
    if not candidate.is_relative_to(root_resolved) or not candidate.is_file():
        raise MediaSyncError("SOURCE_UNAVAILABLE")
    if candidate.stat().st_size > MAX_SOURCE_BYTES:
        raise MediaSyncError("SOURCE_TOO_LARGE")
    return candidate


def _canonical_object_url(
    base_url: str,
    bucket: str,
    object_path: str,
    *,
    product_id: UUID,
    image_id: UUID,
    source_revision: UUID,
) -> str:
    base = urlsplit(base_url)
    if not base.hostname or base.username or base.password or base.query or base.fragment:
        raise MediaSyncError("STORAGE_ORIGIN_INVALID")
    if bucket != "product-media":
        raise MediaSyncError("SOURCE_NOT_TRUSTED")
    path_parts = object_path.split("/")
    if len(path_parts) != 5 or path_parts[0] != "products" or path_parts[-1] != "original.webp":
        raise MediaSyncError("SOURCE_NOT_TRUSTED")
    try:
        path_product_id, path_image_id, path_revision = (str(UUID(part)) for part in path_parts[1:4])
    except ValueError as exc:
        raise MediaSyncError("SOURCE_NOT_TRUSTED") from exc
    if (path_product_id, path_image_id, path_revision) != (
        str(product_id),
        str(image_id),
        str(source_revision),
    ):
        raise MediaSyncError("SOURCE_NOT_TRUSTED")
    encoded = "/".join(quote(part, safe="-._~") for part in path_parts)
    return f"{base_url.rstrip('/')}/storage/v1/object/public/{bucket}/{encoded}"


def _fetch_public_source(url: str) -> bytes:
    parts = urlsplit(url)
    if parts.scheme not in {"https", "http"} or not parts.hostname or parts.username or parts.password:
        raise MediaSyncError("SOURCE_NOT_TRUSTED")
    if parts.scheme != "https" and parts.hostname not in {"localhost", "127.0.0.1", "::1"}:
        raise MediaSyncError("SOURCE_NOT_TRUSTED")
    request = Request(  # noqa: S310 - validated scheme and host; redirects are disabled.
        url,
        headers={"Accept": "image/jpeg,image/png,image/webp", "User-Agent": "ElectroHubMediaSync/1"},
    )
    try:
        with build_opener(_NoRedirect).open(request, timeout=SOURCE_TIMEOUT_SECONDS) as response:
            declared = response.headers.get("Content-Length")
            if declared is not None and int(declared) > MAX_SOURCE_BYTES:
                raise MediaSyncError("SOURCE_TOO_LARGE")
            data = response.read(MAX_SOURCE_BYTES + 1)
    except MediaSyncError:
        raise
    except (HTTPError, URLError, TimeoutError, OSError, ValueError) as exc:
        raise MediaSyncError("SOURCE_UNAVAILABLE") from exc
    if len(data) > MAX_SOURCE_BYTES:
        raise MediaSyncError("SOURCE_TOO_LARGE")
    if not isinstance(data, bytes):
        raise MediaSyncError("SOURCE_UNAVAILABLE")
    return data


def resolve_source(
    *,
    provider: str,
    bucket: str | None,
    object_path: str | None,
    url: str,
    storage_base_url: str | None,
    catalog_root: Path,
    product_id: UUID | None = None,
    image_id: UUID | None = None,
    source_revision: UUID | None = None,
) -> bytes:
    if provider == "SUPABASE_STORAGE":
        if (
            not storage_base_url
            or not bucket
            or not object_path
            or product_id is None
            or image_id is None
            or source_revision is None
        ):
            raise MediaSyncError("SOURCE_NOT_TRUSTED")
        return _fetch_public_source(
            _canonical_object_url(
                storage_base_url,
                bucket,
                object_path,
                product_id=product_id,
                image_id=image_id,
                source_revision=source_revision,
            )
        )
    if provider == "LEGACY_LOCAL":
        try:
            return _resolve_local_catalog_file(catalog_root, url).read_bytes()
        except OSError as exc:
            raise MediaSyncError("SOURCE_UNAVAILABLE") from exc
    raise MediaSyncError("SOURCE_NOT_TRUSTED")


def _vector_literal(values: list[float], descriptor: ModelDescriptor) -> str:
    if len(values) != descriptor.embedding_dimension or not all(math.isfinite(value) for value in values):
        raise MediaSyncError("ENCODER_OUTPUT_INVALID")
    norm = math.sqrt(sum(value * value for value in values))
    if not math.isfinite(norm) or abs(norm - 1.0) > 1e-3:
        raise MediaSyncError("ENCODER_OUTPUT_INVALID")
    return "[" + ",".join(f"{value:.8f}" for value in values) + "]"


def _descriptor_matches(row: tuple[Any, ...], descriptor: ModelDescriptor) -> bool:
    return (
        row[0] == descriptor.embedding_version
        and row[1] == descriptor.model_version
        and row[2] == descriptor.preprocess_version
        and int(row[3]) == descriptor.embedding_dimension
        and row[4] == descriptor.artifact_format
        and str(row[5]).strip() == descriptor.artifact_sha256
        and row[6] == "ACTIVE"
    )


class MediaSyncWorker:
    def __init__(
        self,
        *,
        dsn: str,
        encoder: Any,
        storage_base_url: str | None,
        catalog_root: Path,
        environment: str = "test",
        connect: Any = psycopg.connect,
        heartbeat_interval_seconds: float = HEARTBEAT_INTERVAL_SECONDS,
    ) -> None:
        self._dsn = dsn
        self._encoder = encoder
        self._storage_base_url = storage_base_url
        self._catalog_root = catalog_root
        self._environment = environment
        self._connect = connect
        self._next_reconcile_at = 0.0
        self._worker_id = uuid4()
        self._status_lock = threading.Lock()
        self._state = "STARTING"
        self._active_model_version: str | None = None
        self._current_event_id: UUID | None = None
        self._processed_success_count = 0
        self._processed_failure_count = 0
        self._last_error_code: str | None = None
        self._heartbeat_interval_seconds = heartbeat_interval_seconds
        self._heartbeat_stop = threading.Event()
        self._shutdown_requested = threading.Event()
        self._heartbeat_failed = threading.Event()
        self._heartbeat_thread: threading.Thread | None = None
        self._ready = False

    def _connect_db(self) -> Any:
        return self._connect(
            self._dsn,
            options="-c search_path=ai,extensions,public -c statement_timeout=15000",
            connect_timeout=15,
            application_name="electrohub-ai-media-worker",
        )

    def _snapshot(self) -> tuple[str, str | None, UUID | None, int, int, str | None]:
        with self._status_lock:
            return (
                self._state,
                self._active_model_version,
                self._current_event_id,
                self._processed_success_count,
                self._processed_failure_count,
                self._last_error_code,
            )

    def _set_state(self, state: str, *, current_event_id: UUID | None = None) -> None:
        with self._status_lock:
            if self._state == "FAILED" and state == "STOPPING":
                return
            self._state = state
            self._current_event_id = current_event_id

    def _set_error(self, code: str) -> None:
        with self._status_lock:
            self._last_error_code = code[:80]

    def _record_success(self) -> None:
        with self._status_lock:
            self._processed_success_count += 1

    def _record_failure(self, code: str) -> None:
        with self._status_lock:
            self._processed_failure_count += 1
            self._last_error_code = code[:80]

    def _write_heartbeat(self) -> None:
        state, model_version, event_id, success_count, failure_count, error_code = self._snapshot()
        with self._connect_db() as conn, conn.transaction():
            conn.execute(
                _HEARTBEAT_UPSERT_SQL,
                (
                    self._worker_id,
                    self._environment,
                    state,
                    model_version,
                    event_id,
                    success_count,
                    failure_count,
                    error_code,
                ),
            )

    def _heartbeat_loop(self) -> None:
        while not self._heartbeat_stop.wait(self._heartbeat_interval_seconds):
            try:
                self._write_heartbeat()
            except Exception as exc:
                self._set_error("HEARTBEAT_WRITE_FAILED")
                self._heartbeat_failed.set()
                log_event(
                    "ai.media_worker_heartbeat_failed",
                    level=logging.ERROR,
                    workerId=self._worker_id,
                    exception=type(exc).__name__,
                )

    def startup(self) -> None:
        """Persist STARTING, verify role/privileges/model/storage, then publish READY."""
        self._set_state("STARTING")
        try:
            self._write_heartbeat()
            with self._connect_db() as conn, conn.transaction():
                privilege_row = conn.execute(_READINESS_SQL).fetchone()
                if privilege_row is None or not all(bool(value) for value in privilege_row):
                    raise ConfigurationError("media worker database role lacks required privileges")
                active = conn.execute(_ACTIVE_SQL).fetchone()
                if active is None or not _descriptor_matches(active, self._encoder.descriptor):
                    raise MediaSyncError("ACTIVE_MODEL_MISMATCH")
                has_hosted_sources = bool(conn.execute(_HAS_HOSTED_MEDIA_SQL).fetchone()[0])
                if self._environment in {"development", "production"} and not self._storage_base_url:
                    raise ConfigurationError("hosted media worker requires its environment Storage origin")
                if has_hosted_sources and not self._storage_base_url:
                    raise ConfigurationError("hosted media source requires a canonical Storage origin")
                conn.execute(_PURGE_OLD_HEARTBEATS_SQL, (HEARTBEAT_RETENTION_DAYS,))
            with self._status_lock:
                self._active_model_version = str(active[0])
                self._state = "READY"
            self._write_heartbeat()
            self._ready = True
            self._heartbeat_thread = threading.Thread(
                target=self._heartbeat_loop,
                name=f"media-worker-heartbeat-{self._worker_id}",
                daemon=True,
            )
            self._heartbeat_thread.start()
            log_event(
                "ai.media_worker_ready",
                workerId=self._worker_id,
                environment=self._environment,
                modelVersion=self._active_model_version,
            )
        except Exception as exc:
            code = exc.code if isinstance(exc, MediaSyncError) else "STARTUP_CHECK_FAILED"
            self._set_error(code)
            self._set_state("FAILED")
            try:
                self._write_heartbeat()
            except Exception as status_exc:
                log_event(
                    "ai.media_worker_startup_status_failed",
                    level=logging.WARNING,
                    workerId=self._worker_id,
                    exception=type(status_exc).__name__,
                )
            log_event(
                "ai.media_worker_startup_failed",
                level=logging.ERROR,
                workerId=self._worker_id,
                code=code,
                exception=type(exc).__name__,
            )
            if isinstance(exc, ConfigurationError):
                raise
            raise ConfigurationError("media worker startup verification failed") from None

    def request_shutdown(self) -> None:
        """Signal the main loop to stop claiming; any already-running bounded event is allowed to finish."""
        self._shutdown_requested.set()
        current_event_id = self._snapshot()[2]
        self._set_state("STOPPING", current_event_id=current_event_id)

    def shutdown(self) -> None:
        """Flush STOPPING/STOPPED state and join the bounded heartbeat thread."""
        self.request_shutdown()
        if self._snapshot()[0] == "FAILED":
            self._heartbeat_stop.set()
            return
        try:
            self._write_heartbeat()
        except Exception as exc:
            log_event(
                "ai.media_worker_shutdown_status_failed",
                level=logging.WARNING,
                workerId=self._worker_id,
                exception=type(exc).__name__,
            )
        self._heartbeat_stop.set()
        if self._heartbeat_thread is not None:
            # A heartbeat uses a 15-second database connect timeout and a 15-second statement timeout.
            self._heartbeat_thread.join(timeout=31.0)
            if self._heartbeat_thread.is_alive():
                log_event("ai.media_worker_heartbeat_join_timeout", level=logging.ERROR, workerId=self._worker_id)
                return
        self._set_state("STOPPED")
        try:
            self._write_heartbeat()
        except Exception as exc:
            log_event(
                "ai.media_worker_shutdown_status_failed",
                level=logging.WARNING,
                workerId=self._worker_id,
                exception=type(exc).__name__,
            )
        self._ready = False

    def reconcile_if_due(self, *, now: float | None = None) -> int:
        """Queue at most one bounded reconciliation page every 30 seconds."""
        current = time.monotonic() if now is None else now
        if current < self._next_reconcile_at:
            return 0
        self._next_reconcile_at = current + RECONCILE_INTERVAL_SECONDS
        try:
            with self._connect_db() as conn, conn.transaction():
                row = conn.execute(_RECONCILE_SQL, (RECONCILE_BATCH_SIZE,)).fetchone()
            return int(row[0]) if row is not None else 0
        except Exception as exc:
            # Reconciliation is a repair path; do not prevent already queued work from processing.
            log_event("ai.media_reconciliation_failed", level=logging.WARNING, exception=type(exc).__name__)
            return 0

    def claim(self, event_id: UUID | None = None) -> MediaEvent | None:
        if not self._ready:
            raise ConfigurationError("media worker is not ready to claim events")
        token = uuid4()
        with self._connect_db() as conn, conn.transaction():
            if event_id is None:
                conn.execute(_EXHAUSTED_LEASE_SQL, (MAX_ATTEMPTS,))
                row = conn.execute(_CLAIM_SQL, (LEASE_SECONDS, token)).fetchone()
            else:
                row = conn.execute(_CLAIM_EVENT_SQL, (event_id, LEASE_SECONDS, token)).fetchone()
        if row is None:
            return None
        return MediaEvent(
            event_id=UUID(str(row[0])),
            product_id=UUID(str(row[1])),
            image_id=UUID(str(row[2])),
            operation=str(row[3]),
            source_revision=UUID(str(row[4])) if row[4] is not None else None,
            source_sha256=str(row[5]).strip() if row[5] is not None else None,
            attempt_count=int(row[6]),
            lease_token=UUID(str(row[7])),
        )

    def _active_descriptor_matches(self) -> bool:
        with self._connect_db() as conn:
            row = conn.execute(_ACTIVE_SQL).fetchone()
        return row is not None and _descriptor_matches(row, self._encoder.descriptor)

    def _mark_complete(self, event: MediaEvent, *, vector: str | None) -> bool:
        with self._connect_db() as conn, conn.transaction():
            if vector is not None:
                descriptor = self._encoder.descriptor
                published = conn.execute(
                    _PUBLISH_SQL,
                    (
                        event.event_id,
                        event.lease_token,
                        descriptor.embedding_version,
                        descriptor.model_version,
                        descriptor.preprocess_version,
                        descriptor.artifact_sha256,
                        event.image_id,
                        event.product_id,
                        event.source_revision,
                        event.source_sha256,
                        vector,
                    ),
                ).fetchone()[0]
                if not published:
                    # A newer replacement/removal committed first. Treat this delivery as superseded; its
                    # replacement event owns the current revision.
                    cursor = conn.execute(_SUPERSEDE_SQL, (event.event_id, event.lease_token))
                    return int(cursor.rowcount) == 1
            else:
                cursor = conn.execute(_SUPERSEDE_SQL, (event.event_id, event.lease_token))
                return int(cursor.rowcount) == 1
            cursor = conn.execute(_COMPLETE_SQL, (event.event_id, event.lease_token))
            if int(cursor.rowcount) != 1:
                # Publication and acknowledgment are one transaction. A lease lost between the
                # guarded upsert and acknowledgment must roll the overlay write back as well.
                raise RuntimeError("media event lease was lost before acknowledgment")
            return True

    def _acknowledge(self, event: MediaEvent, *, vector: str | None) -> bool:
        completed = self._mark_complete(event, vector=vector)
        if completed:
            self._record_success()
        return completed

    def _mark_failed(self, event: MediaEvent, code: str) -> None:
        delay = min(3600, 2 ** min(event.attempt_count, 10))
        with self._connect_db() as conn, conn.transaction():
            conn.execute(_FAIL_SQL, (MAX_ATTEMPTS, delay, code[:80], event.event_id, event.lease_token))

    def process(self, event: MediaEvent) -> bool:
        try:
            with self._connect_db() as conn:
                row = conn.execute(_SOURCE_SQL, (event.image_id,)).fetchone()
            # Missing, retired, hidden, or superseded events are safely consumed without publishing vectors.
            if row is None or not row[3] or row[0] != event.product_id:
                return self._acknowledge(event, vector=None)
            if event.source_revision is None or event.source_sha256 is None:
                return self._acknowledge(event, vector=None)
            if row[1] != event.source_revision or str(row[2]).strip() != event.source_sha256:
                return self._acknowledge(event, vector=None)
            if not self._active_descriptor_matches():
                raise MediaSyncError("ACTIVE_MODEL_MISMATCH")
            data = resolve_source(
                provider=str(row[4]),
                bucket=str(row[5]) if row[5] is not None else None,
                object_path=str(row[6]) if row[6] is not None else None,
                url=str(row[7]),
                storage_base_url=self._storage_base_url,
                catalog_root=self._catalog_root,
                product_id=event.product_id,
                image_id=event.image_id,
                source_revision=event.source_revision,
            )
            digest = hashlib.sha256(data).hexdigest()
            if digest != event.source_sha256:
                raise MediaSyncError("SOURCE_DIGEST_MISMATCH")
            image = decode_image(data)
            vector = _vector_literal(list(self._encoder.encode(image)), self._encoder.descriptor)
            if not self._acknowledge(event, vector=vector):
                log_event("ai.media_event_lease_lost", eventId=event.event_id)
                return False
            log_event("ai.media_event_completed", eventId=event.event_id, imageId=event.image_id)
            return True
        except psycopg.errors.SerializationFailure:
            # The active pointer changed after the preflight descriptor check. Keep the event retryable
            # so the next worker build can encode it with the newly active model.
            self._record_failure("ACTIVE_MODEL_CHANGED")
            self._mark_failed(event, "ACTIVE_MODEL_CHANGED")
            log_event(
                "ai.media_event_failed",
                level=logging.WARNING,
                eventId=event.event_id,
                code="ACTIVE_MODEL_CHANGED",
            )
            return False
        except MediaSyncError as exc:
            self._record_failure(exc.code)
            self._mark_failed(event, exc.code)
            log_event("ai.media_event_failed", level=logging.WARNING, eventId=event.event_id, code=exc.code)
            return False
        except Exception as exc:
            self._record_failure("WORKER_ERROR")
            self._mark_failed(event, "WORKER_ERROR")
            log_event(
                "ai.media_event_failed",
                level=logging.ERROR,
                eventId=event.event_id,
                exception=type(exc).__name__,
            )
            return False

    def run_once(self, event_id: UUID | None = None) -> bool:
        if not self._ready:
            raise ConfigurationError("media worker is not ready to process events")
        if self._shutdown_requested.is_set() or self._heartbeat_failed.is_set():
            return False
        if event_id is None:
            self.reconcile_if_due()
        if self._shutdown_requested.is_set() or self._heartbeat_failed.is_set():
            return False
        event = self.claim() if event_id is None else self.claim(event_id)
        if event is None:
            self._set_state("READY")
            return False
        if self._shutdown_requested.is_set():
            with self._connect_db() as conn, conn.transaction():
                conn.execute(_RELEASE_CLAIM_SQL, (event.event_id, event.lease_token))
            self._set_state("STOPPING")
            self._write_heartbeat()
            return False
        self._set_state("PROCESSING", current_event_id=event.event_id)
        try:
            self._write_heartbeat()
        except Exception:
            with self._connect_db() as conn, conn.transaction():
                conn.execute(_RELEASE_CLAIM_SQL, (event.event_id, event.lease_token))
            raise ConfigurationError("media worker could not persist its processing heartbeat") from None
        try:
            self.process(event)
        finally:
            self._set_state("STOPPING" if self._shutdown_requested.is_set() else "READY")
            self._write_heartbeat()
        return True


def build_worker() -> MediaSyncWorker:
    settings = get_settings()
    if settings.AI_PROCESS_ROLE != "media_worker":
        raise ConfigurationError("AI_PROCESS_ROLE must be media_worker for the media worker entrypoint")
    if settings.AI_MEDIA_WORKER_DATABASE_URL is None:
        raise ConfigurationError("AI_MEDIA_WORKER_DATABASE_URL is required for the media worker")
    if settings.AI_MODEL_ARTIFACT_DIR is None:
        raise ConfigurationError("AI_MODEL_ARTIFACT_DIR is required for the media worker")
    encoder = load_encoder(
        settings.AI_MODEL_ARTIFACT_DIR,
        torch_threads=settings.AI_TORCH_THREADS,
        relevance_dir=settings.AI_RELEVANCE_ARTIFACT_DIR,
    )
    return MediaSyncWorker(
        dsn=settings.AI_MEDIA_WORKER_DATABASE_URL.get_secret_value(),
        encoder=encoder,
        storage_base_url=settings.AI_MEDIA_STORAGE_BASE_URL,
        catalog_root=Path(os.environ.get("AI_MEDIA_LEGACY_CATALOG_ROOT", "apps/frontend/public")),
        environment=settings.AI_ENVIRONMENT,
    )


def _handle_worker_signal(signum: int, stop_event: threading.Event, worker: MediaSyncWorker | None) -> None:
    stop_event.set()
    if worker is not None:
        worker.request_shutdown()
    log_event("ai.media_worker_signal_received", signal=signal.Signals(signum).name)


def _parse_event_id(value: str) -> UUID:
    try:
        return UUID(value)
    except (AttributeError, ValueError) as exc:
        raise argparse.ArgumentTypeError("event ID must be a UUID") from exc


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.media_sync")
    parser.add_argument("--once", action="store_true", help="process at most one outbox event and exit")
    parser.add_argument(
        "--event-id",
        type=_parse_event_id,
        help="claim this pre-verified event only; requires --once and skips shared-queue reconciliation",
    )
    parser.add_argument("--poll-seconds", type=float, default=POLL_SECONDS)
    args = parser.parse_args(argv)
    if args.event_id is not None and not args.once:
        parser.error("--event-id requires --once")
    if args.poll_seconds < 0.1 or args.poll_seconds > 60:
        parser.error("--poll-seconds must be between 0.1 and 60")
    configure_logging(os.environ.get("AI_LOG_LEVEL", "INFO"))
    stop_event = threading.Event()
    worker: MediaSyncWorker | None = None
    stop_signal: int | None = None

    def handle_signal(signum: int, _frame: Any) -> None:
        nonlocal stop_signal
        stop_signal = signum
        _handle_worker_signal(signum, stop_event, worker)

    original_handlers = {sig: signal.signal(sig, handle_signal) for sig in (signal.SIGINT, signal.SIGTERM)}
    exit_code = 0
    try:
        worker = build_worker()
        if stop_event.is_set():
            worker.request_shutdown()
        else:
            worker.startup()
            while not stop_event.is_set() and not worker._heartbeat_failed.is_set():
                worker.run_once(event_id=args.event_id)
                if args.once:
                    break
                if not stop_event.is_set() and not worker._heartbeat_failed.is_set():
                    stop_event.wait(args.poll_seconds)
            if worker._heartbeat_failed.is_set():
                exit_code = 1
    finally:
        if worker is not None:
            worker.shutdown()
            worker._encoder.close()
        for sig, handler in original_handlers.items():
            signal.signal(sig, handler)
    return 128 + stop_signal if stop_signal is not None else exit_code


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
