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
import sys
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
        connect: Any = psycopg.connect,
    ) -> None:
        self._dsn = dsn
        self._encoder = encoder
        self._storage_base_url = storage_base_url
        self._catalog_root = catalog_root
        self._connect = connect
        self._next_reconcile_at = 0.0

    def _connect_db(self) -> Any:
        return self._connect(
            self._dsn,
            options="-c search_path=ai,extensions,public -c statement_timeout=15000",
            connect_timeout=15,
            application_name="electrohub-ai-media-worker",
        )

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

    def claim(self) -> MediaEvent | None:
        token = uuid4()
        with self._connect_db() as conn, conn.transaction():
            conn.execute(_EXHAUSTED_LEASE_SQL, (MAX_ATTEMPTS,))
            row = conn.execute(_CLAIM_SQL, (LEASE_SECONDS, token)).fetchone()
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
                return self._mark_complete(event, vector=None)
            if event.source_revision is None or event.source_sha256 is None:
                return self._mark_complete(event, vector=None)
            if row[1] != event.source_revision or str(row[2]).strip() != event.source_sha256:
                return self._mark_complete(event, vector=None)
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
            if not self._mark_complete(event, vector=vector):
                log_event("ai.media_event_lease_lost", eventId=event.event_id)
                return False
            log_event("ai.media_event_completed", eventId=event.event_id, imageId=event.image_id)
            return True
        except psycopg.errors.SerializationFailure:
            # The active pointer changed after the preflight descriptor check. Keep the event retryable
            # so the next worker build can encode it with the newly active model.
            self._mark_failed(event, "ACTIVE_MODEL_CHANGED")
            log_event(
                "ai.media_event_failed",
                level=logging.WARNING,
                eventId=event.event_id,
                code="ACTIVE_MODEL_CHANGED",
            )
            return False
        except MediaSyncError as exc:
            self._mark_failed(event, exc.code)
            log_event("ai.media_event_failed", level=logging.WARNING, eventId=event.event_id, code=exc.code)
            return False
        except Exception as exc:
            self._mark_failed(event, "WORKER_ERROR")
            log_event(
                "ai.media_event_failed",
                level=logging.ERROR,
                eventId=event.event_id,
                exception=type(exc).__name__,
            )
            return False

    def run_once(self) -> bool:
        self.reconcile_if_due()
        event = self.claim()
        if event is None:
            return False
        self.process(event)
        return True


def build_worker() -> MediaSyncWorker:
    settings = get_settings()
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
    )


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m app.media_sync")
    parser.add_argument("--once", action="store_true", help="process at most one outbox event and exit")
    parser.add_argument("--poll-seconds", type=float, default=POLL_SECONDS)
    args = parser.parse_args(argv)
    if args.poll_seconds < 0.1 or args.poll_seconds > 60:
        parser.error("--poll-seconds must be between 0.1 and 60")
    configure_logging(os.environ.get("AI_LOG_LEVEL", "INFO"))
    worker = build_worker()
    try:
        while True:
            claimed = worker.run_once()
            if args.once:
                return
            if not claimed:
                time.sleep(args.poll_seconds)
    finally:
        worker._encoder.close()


if __name__ == "__main__":
    main(sys.argv[1:])
