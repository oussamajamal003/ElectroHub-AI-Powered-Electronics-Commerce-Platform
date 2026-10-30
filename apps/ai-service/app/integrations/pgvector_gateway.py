"""pgvector-backed ``EmbeddingSearchGateway`` over the ``ai`` schema (Task 04.2).

Every connection is read-only (``default_transaction_read_only=on``), resolves only ``ai`` and ``extensions``, and is
bounded by a statement timeout. Readiness and search each run in one REPEATABLE READ transaction, so the active
version checked before a search is the version its vectors come from. Nothing here writes, and no URL, credential,
vector or product list is logged.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import logging
import math
import struct
import time
from collections.abc import AsyncIterator, Callable, Sequence
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from dataclasses import dataclass
from typing import Any, Final, Protocol
from uuid import UUID

import psycopg
from psycopg_pool import AsyncConnectionPool

from app.core.errors import IndexNotReadyError, InferenceOutputError, ValidationFailedError
from app.core.logging import log_event
from app.models.descriptor import ModelDescriptor
from app.schemas.common import RankedProduct
from app.schemas.image_search import HARD_MAX_TOP_K

APPLICATION_NAME: Final = "electrohub-ai-service"
STATEMENT_TIMEOUT_MS: Final = 2000
POOL_MAX_SIZE: Final = 4
# A TLS session to a remote pooler costs several round trips (5-9 s measured from a Windows dev machine to the DEV
# region), so connects get a generous budget and one connection is kept warm for requests to reuse.
CONNECT_TIMEOUT_SECONDS: Final = 15
POOL_MIN_SIZE: Final = 1
POOL_TIMEOUT_SECONDS: Final = 10.0
# Task 04.4: bound on product ids per centroid lookup and on candidates per recommendation retrieval.
MAX_PRODUCT_LOOKUP: Final = 200
_SESSION_OPTIONS: Final = (
    f"-c search_path=ai,extensions -c statement_timeout={STATEMENT_TIMEOUT_MS} -c default_transaction_read_only=on"
)

_ACTIVE_SQL: Final = """
SELECT a.embedding_version, m.model_version, m.preprocess_version, m.embedding_dimension,
       m.artifact_format, m.artifact_sha256, m.status, m.expected_images
FROM ai.active_index AS a
JOIN ai.model_versions AS m ON m.embedding_version = a.embedding_version
WHERE a.singleton
"""

_COVERAGE_SQL: Final = """
SELECT count(*) AS eligible,
       count(*) FILTER (WHERE covered.product_image_id IS NOT NULL) AS indexed
FROM ai.catalog_media_sources AS source
LEFT JOIN LATERAL (
    SELECT base.product_image_id
    FROM ai.product_image_embeddings AS base
    WHERE source.eligible
      AND source.source_revision IS NULL
      AND base.embedding_version = %s
      AND base.product_image_id = source.product_image_id
      AND base.product_id = source.product_id
    UNION ALL
    SELECT overlay.product_image_id
    FROM ai.media_image_embeddings AS overlay
    WHERE source.eligible
      AND source.source_revision IS NOT NULL
      AND overlay.embedding_version = %s
      AND overlay.product_image_id = source.product_image_id
      AND overlay.product_id = source.product_id
      AND overlay.source_revision = source.source_revision
      AND overlay.source_sha256 = source.source_sha256
    LIMIT 1
) AS covered ON TRUE
WHERE source.eligible
"""

_BASE_COUNT_SQL: Final = """
SELECT count(*) FROM ai.product_image_embeddings WHERE embedding_version = %s
"""

# Task 04.3 source eligibility, shared by image search and recommendations (Task 04.4): a base vector counts only for a
# legacy (revision-less) eligible source, an overlay vector only for the exact current revision and digest. Takes the
# embedding version twice.
_ELIGIBLE_VECTORS_CTE: Final = """
eligible_vectors AS (
    SELECT base.product_id, base.embedding
    FROM ai.product_image_embeddings AS base
    JOIN ai.catalog_media_sources AS source
      ON source.product_image_id = base.product_image_id
     AND source.product_id = base.product_id
    WHERE base.embedding_version = %s
      AND source.eligible
      AND source.source_revision IS NULL
    UNION ALL
    SELECT overlay.product_id, overlay.embedding
    FROM ai.media_image_embeddings AS overlay
    JOIN ai.catalog_media_sources AS source
      ON source.product_image_id = overlay.product_image_id
     AND source.product_id = overlay.product_id
    WHERE overlay.embedding_version = %s
      AND source.eligible
      AND source.source_revision IS NOT NULL
      AND overlay.source_revision = source.source_revision
      AND overlay.source_sha256 = source.source_sha256
)"""

_NEAREST_SQL: Final = f"""
WITH {_ELIGIBLE_VECTORS_CTE}, product_distances AS (
    SELECT product_id, MIN(embedding <=> %s::vector) AS d
    FROM eligible_vectors
    GROUP BY product_id
)
SELECT product_id, d FROM product_distances
ORDER BY d ASC, product_id ASC
LIMIT %s
"""  # noqa: S608 - composed only from module constants; values are bound parameters

# Task 04.4: one representation per product = mean of its current eligible unit image vectors, so a product with many
# photos is neither favoured (as MIN distance over images would) nor represented by a stale or retired image.
_CENTROIDS_SQL: Final = f"""
WITH {_ELIGIBLE_VECTORS_CTE}
SELECT product_id, avg(embedding)::text, count(*)
FROM eligible_vectors
WHERE product_id = ANY(%s::uuid[])
GROUP BY product_id
ORDER BY product_id
"""  # noqa: S608 - composed only from module constants; values are bound parameters

_NEAREST_PRODUCTS_SQL: Final = f"""
WITH {_ELIGIBLE_VECTORS_CTE}, centroids AS (
    SELECT product_id, avg(embedding) AS centroid
    FROM eligible_vectors
    GROUP BY product_id
)
SELECT product_id, centroid <=> %s::vector AS d, centroid::text
FROM centroids
WHERE NOT (product_id = ANY(%s::uuid[]))
  AND (cardinality(%s::uuid[]) = 0 OR product_id = ANY(%s::uuid[]))
ORDER BY d ASC, product_id ASC
LIMIT %s
"""  # noqa: S608 - composed only from module constants; values are bound parameters

# Task 04.4: the shared DEV database is remote and each SQL round trip is expensive from a desktop runtime. Keep
# active-identity validation, anchor/profile construction, candidate centroids and nearest-neighbour ranking in one
# statement. A single statement has one PostgreSQL snapshot, so the active descriptor and eligible vectors cannot mix
# even though this path does not need a separate SET TRANSACTION round trip.
_RECOMMENDATION_CANDIDATES_SQL: Final = f"""
WITH active_identity AS (
    SELECT a.embedding_version, m.model_version, m.preprocess_version, m.embedding_dimension,
           m.artifact_format, m.artifact_sha256, m.status
    FROM ai.active_index AS a
    JOIN ai.model_versions AS m ON m.embedding_version = a.embedding_version
    WHERE a.singleton
),
{_ELIGIBLE_VECTORS_CTE}, requested_products AS (
    SELECT product_id FROM unnest(%s::uuid[]) AS requested(product_id)
), requested_signals AS (
    SELECT product_id, weight
    FROM unnest(%s::uuid[], %s::double precision[]) AS signal(product_id, weight)
), query_centroids AS (
    SELECT eligible.product_id, extensions.avg(eligible.embedding) AS centroid
    FROM eligible_vectors AS eligible
    JOIN requested_products AS requested USING (product_id)
    GROUP BY eligible.product_id
), anchor_vector AS (
    SELECT CASE WHEN extensions.vector_norm(centroid) > 1e-12
                THEN extensions.l2_normalize(centroid) END AS vector
    FROM query_centroids
    WHERE %s::uuid IS NOT NULL AND product_id = %s::uuid
), profile_components AS (
    SELECT extensions.l2_normalize(query_centroids.centroid)
               OPERATOR(extensions.*)
               (('[' || array_to_string(
                   array_fill(requested_signals.weight, ARRAY[%s]), ','
               ) || ']')::extensions.vector)
               AS weighted_vector
    FROM requested_signals
    JOIN query_centroids USING (product_id)
    WHERE extensions.vector_norm(query_centroids.centroid) > 1e-12
), profile_sum AS (
    SELECT extensions.sum(weighted_vector) AS vector FROM profile_components
), profile_vector AS (
    SELECT CASE WHEN vector IS NOT NULL AND extensions.vector_norm(vector) > 1e-12
                THEN extensions.l2_normalize(vector) END AS vector
    FROM profile_sum
), query_vector AS (
    SELECT vector FROM anchor_vector WHERE vector IS NOT NULL
    UNION ALL
    SELECT vector FROM profile_vector WHERE %s::uuid IS NULL AND vector IS NOT NULL
), product_centroids AS (
    SELECT product_id, extensions.avg(embedding) AS centroid
    FROM eligible_vectors
    GROUP BY product_id
), active_match AS (
    SELECT EXISTS (
        SELECT 1 FROM active_identity
        WHERE embedding_version = %s
          AND model_version = %s
          AND preprocess_version = %s
          AND embedding_dimension = %s
          AND artifact_format = %s
          AND artifact_sha256 = %s
          AND status = 'ACTIVE'
    ) AS compatible
), request_state AS (
    SELECT compatible, EXISTS (SELECT 1 FROM query_vector) AS queryable FROM active_match
)
SELECT request_state.compatible, request_state.queryable, ranked.product_id, ranked.distance, ranked.centroid
FROM request_state
LEFT JOIN LATERAL (
    SELECT candidate.product_id,
           candidate.centroid OPERATOR(extensions.<=>) query_vector.vector AS distance,
           encode(extensions.vector_send(candidate.centroid), 'base64') AS centroid
    FROM query_vector
    CROSS JOIN product_centroids AS candidate
    WHERE candidate.product_id <> ALL(%s::uuid[])
      AND (cardinality(%s::uuid[]) = 0 OR candidate.product_id = ANY(%s::uuid[]))
    ORDER BY distance ASC, candidate.product_id ASC
    LIMIT %s
) AS ranked ON request_state.compatible AND request_state.queryable
"""  # noqa: S608 - composed only from module constants; all caller values are bound parameters

_REPEATABLE_READ_SQL: Final = "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"


@dataclass(frozen=True)
class ProductVector:
    vector: tuple[float, ...]
    image_count: int


@dataclass(frozen=True)
class ScoredProduct:
    product_id: UUID
    score: float
    vector: tuple[float, ...]


class _Cursor(Protocol):
    async def fetchone(self) -> Any: ...

    async def fetchall(self) -> list[Any]: ...


class _Connection(Protocol):
    def transaction(self) -> AbstractAsyncContextManager[object]: ...

    async def execute(self, query: str, params: Sequence[object] | None = None) -> _Cursor: ...


class _Pool(Protocol):
    async def open(self, wait: bool = False) -> None: ...

    def connection(self) -> AbstractAsyncContextManager[_Connection]: ...

    async def close(self) -> None: ...


PoolFactory = Callable[[], _Pool]


def _default_pool_factory(dsn: str) -> PoolFactory:
    def build() -> _Pool:
        return AsyncConnectionPool(
            conninfo=dsn,
            min_size=POOL_MIN_SIZE,
            max_size=POOL_MAX_SIZE,
            timeout=POOL_TIMEOUT_SECONDS,
            open=False,
            name="electrohub-ai-vector",
            kwargs={
                "options": _SESSION_OPTIONS,
                "application_name": APPLICATION_NAME,
                "connect_timeout": CONNECT_TIMEOUT_SECONDS,
                # Reads are read-only by session default. Autocommit lets the one-statement recommendation path use
                # one remote exchange; multi-statement readiness/search paths explicitly open repeatable-read blocks.
                "autocommit": True,
            },
        )

    return build


class PgVectorGateway:
    """Read-only search over the active embedding version. Pool and connections open lazily on first use."""

    def __init__(self, *, dsn: str, pool_factory: PoolFactory | None = None) -> None:
        self._pool_factory: PoolFactory = pool_factory or _default_pool_factory(dsn)
        self._pool: _Pool | None = None
        self._open_lock = asyncio.Lock()
        self._opened = False
        self._last_coverage: tuple[str, int, int] | None = None

    def __repr__(self) -> str:
        return "PgVectorGateway(<redacted>)"

    async def _ready_pool(self) -> _Pool:
        if self._opened and self._pool is not None:
            return self._pool
        async with self._open_lock:
            if self._pool is None:
                self._pool = self._pool_factory()
            if not self._opened:
                await self._pool.open(wait=False)
                self._opened = True
            return self._pool

    @asynccontextmanager
    async def _read_transaction(self) -> AsyncIterator[_Connection]:
        pool = await self._ready_pool()
        async with pool.connection() as conn, conn.transaction():
            await conn.execute(_REPEATABLE_READ_SQL)
            yield conn

    async def is_ready(self, descriptor: ModelDescriptor) -> bool:
        try:
            async with self._read_transaction() as conn:
                active = await _fetch_one(conn, _ACTIVE_SQL)
                if active is None or not _identity_matches(active, descriptor):
                    return False
                expected = active[7]
                if expected is None or int(expected) <= 0:
                    return False
                base_count = await _fetch_one(conn, _BASE_COUNT_SQL, (descriptor.embedding_version,))
                if base_count is None or int(base_count[0]) != int(expected):
                    return False
                # Coverage is intentionally separate from model readiness. Newly published images are excluded
                # until the overlay worker catches up; they must not make the whole search endpoint unavailable.
                coverage = await _fetch_one(
                    conn,
                    _COVERAGE_SQL,
                    (descriptor.embedding_version, descriptor.embedding_version),
                )
                if coverage is not None:
                    eligible, indexed = int(coverage[0]), int(coverage[1])
                    snapshot = (descriptor.embedding_version, eligible, indexed)
                    if snapshot != self._last_coverage:
                        log_event(
                            "ai.media_index_coverage",
                            level=logging.INFO if eligible == indexed else logging.WARNING,
                            activeVersion=descriptor.embedding_version,
                            eligibleCount=eligible,
                            indexedCount=indexed,
                            pendingCount=max(0, eligible - indexed),
                        )
                        self._last_coverage = snapshot
                return True
        except (psycopg.Error, TimeoutError) as exc:
            log_event("ai.index_unavailable", level=logging.WARNING, exception=type(exc).__name__)
            return False

    async def nearest(
        self,
        vector: Sequence[float],
        *,
        top_k: int,
        descriptor: ModelDescriptor,
    ) -> Sequence[RankedProduct]:
        if not 1 <= top_k <= HARD_MAX_TOP_K:
            raise ValidationFailedError("topK is out of range.")
        literal = _vector_literal(vector, descriptor)

        try:
            async with self._read_transaction() as conn:
                # Re-check inside the snapshot: a version switch between encode and search is an index miss, not a mix.
                active = await _fetch_one(conn, _ACTIVE_SQL)
                if active is None or not _identity_matches(active, descriptor):
                    raise IndexNotReadyError()
                cursor = await conn.execute(
                    _NEAREST_SQL,
                    (descriptor.embedding_version, descriptor.embedding_version, literal, top_k),
                )
                rows = await cursor.fetchall()
        except (psycopg.Error, TimeoutError) as exc:
            log_event("ai.index_query_failed", level=logging.ERROR, exception=type(exc).__name__)
            raise IndexNotReadyError() from exc

        ranked: list[RankedProduct] = []
        for position, row in enumerate(rows, start=1):
            distance = float(row[1])
            if not math.isfinite(distance):
                raise InferenceOutputError()
            score = max(-1.0, min(1.0, 1.0 - distance))
            ranked.append(RankedProduct(product_id=UUID(str(row[0])), score=score, rank=position))
        return ranked

    async def product_centroids(
        self,
        product_ids: Sequence[UUID],
        *,
        descriptor: ModelDescriptor,
    ) -> dict[UUID, ProductVector]:
        """Mean eligible vector per requested product (products without a current eligible vector are absent)."""
        if not product_ids:
            return {}
        if len(product_ids) > MAX_PRODUCT_LOOKUP:
            raise ValidationFailedError("Too many products requested.")
        ids = [str(value) for value in product_ids]
        rows = await self._read_active(
            descriptor,
            _CENTROIDS_SQL,
            (descriptor.embedding_version, descriptor.embedding_version, ids),
        )
        vectors: dict[UUID, ProductVector] = {}
        for row in rows:
            vector = _parse_vector(row[1], descriptor)
            vectors[UUID(str(row[0]))] = ProductVector(vector=vector, image_count=int(row[2]))
        return vectors

    async def nearest_products(
        self,
        vector: Sequence[float],
        *,
        top_k: int,
        descriptor: ModelDescriptor,
        exclude: Sequence[UUID] = (),
        restrict_to: Sequence[UUID] = (),
    ) -> list[ScoredProduct]:
        """Products ranked by cosine similarity of their eligible-image centroid to ``vector`` (ties by product id)."""
        if not 1 <= top_k <= MAX_PRODUCT_LOOKUP:
            raise ValidationFailedError("topK is out of range.")
        literal = _vector_literal(vector, descriptor)
        excluded = [str(value) for value in exclude]
        restricted = [str(value) for value in restrict_to]
        version = descriptor.embedding_version
        params = (version, version, literal, excluded, restricted, restricted, top_k)
        rows = await self._read_active(descriptor, _NEAREST_PRODUCTS_SQL, params)
        scored: list[ScoredProduct] = []
        for row in rows:
            distance = float(row[1])
            if not math.isfinite(distance):
                raise InferenceOutputError()
            scored.append(
                ScoredProduct(
                    product_id=UUID(str(row[0])),
                    score=max(-1.0, min(1.0, 1.0 - distance)),
                    vector=_parse_vector(row[2], descriptor),
                )
            )
        return scored

    async def recommendation_candidates(
        self,
        *,
        anchor_product_id: UUID | None,
        profile_signals: Sequence[tuple[UUID, float]],
        top_k: int,
        descriptor: ModelDescriptor,
        exclude: Sequence[UUID] = (),
        restrict_to: Sequence[UUID] = (),
    ) -> tuple[bool, list[ScoredProduct]]:
        """Build one product/profile query vector and retrieve its neighbours in one consistent DB statement.

        Returns ``(queryable, candidates)``. ``False`` means the anchor/profile has no current eligible D3 vector;
        an active descriptor mismatch or database failure fails closed as ``INDEX_NOT_READY``.
        """
        if not 1 <= top_k <= MAX_PRODUCT_LOOKUP:
            raise ValidationFailedError("topK is out of range.")
        if (anchor_product_id is None) == (len(profile_signals) == 0):
            raise ValidationFailedError("Exactly one anchor product or non-empty profile is required.")
        if len(profile_signals) > 50:
            raise ValidationFailedError("Too many profile signals.")
        if any(not math.isfinite(weight) or not 0.0 < weight <= 1.0 for _, weight in profile_signals):
            raise ValidationFailedError("Profile weights are out of range.")

        requested_ids = [anchor_product_id] if anchor_product_id is not None else [item[0] for item in profile_signals]
        request_id_strings = [str(value) for value in requested_ids]
        signal_ids = [str(product_id) for product_id, _ in profile_signals]
        signal_weights = [weight for _, weight in profile_signals]
        version = descriptor.embedding_version
        params = (
            version,
            version,
            request_id_strings,
            signal_ids,
            signal_weights,
            str(anchor_product_id) if anchor_product_id is not None else None,
            str(anchor_product_id) if anchor_product_id is not None else None,
            descriptor.embedding_dimension,
            str(anchor_product_id) if anchor_product_id is not None else None,
            version,
            descriptor.model_version,
            descriptor.preprocess_version,
            descriptor.embedding_dimension,
            descriptor.artifact_format,
            descriptor.artifact_sha256,
            [str(value) for value in exclude],
            [str(value) for value in restrict_to],
            [str(value) for value in restrict_to],
            top_k,
        )
        phase = "pool_initialization"
        started = time.perf_counter()
        acquired: float | None = None
        executed: float | None = None
        try:
            pool = await self._ready_pool()
            # The complete active-version check and retrieval are one SQL statement and therefore share a single
            # PostgreSQL statement snapshot. Avoid separate BEGIN/COMMIT exchanges on the remote DEV pooler.
            phase = "connection_acquisition"
            async with pool.connection() as conn:
                acquired = time.perf_counter()
                phase = "sql_execution"
                cursor = await conn.execute(_RECOMMENDATION_CANDIDATES_SQL, params)
                executed = time.perf_counter()
                phase = "result_fetch"
                rows = await cursor.fetchall()
                phase = "complete"
        except (psycopg.Error, TimeoutError) as exc:
            log_event("ai.index_query_failed", level=logging.ERROR, exception=type(exc).__name__)
            raise IndexNotReadyError() from exc
        finally:
            ended = time.perf_counter()
            log_event("ai.recommendation_db_timing", phase=phase,
                      totalMs=round((ended - started) * 1000, 2),
                      acquisitionMs=round(((acquired or ended) - started) * 1000, 2),
                      sqlMs=round(((executed or ended) - acquired) * 1000, 2) if acquired is not None else None,
                      fetchMs=round((ended - executed) * 1000, 2) if executed is not None else None)

        if not rows or not bool(rows[0][0]):
            raise IndexNotReadyError()
        queryable = bool(rows[0][1])
        candidates: list[ScoredProduct] = []
        for row in rows:
            if row[2] is None:
                continue
            distance = float(row[3])
            if not math.isfinite(distance):
                raise InferenceOutputError()
            candidates.append(
                ScoredProduct(
                    product_id=UUID(str(row[2])),
                    score=max(-1.0, min(1.0, 1.0 - distance)),
                    vector=_parse_compact_vector(row[4], descriptor),
                )
            )
        return queryable, candidates

    async def _read_active(self, descriptor: ModelDescriptor, query: str, params: Sequence[object]) -> list[Any]:
        try:
            async with self._read_transaction() as conn:
                # Same snapshot as the vectors: an activation between requests is an index miss, never a mixed space.
                active = await _fetch_one(conn, _ACTIVE_SQL)
                if active is None or not _identity_matches(active, descriptor):
                    raise IndexNotReadyError()
                cursor = await conn.execute(query, params)
                rows: list[Any] = await cursor.fetchall()
                return rows
        except (psycopg.Error, TimeoutError) as exc:
            log_event("ai.index_query_failed", level=logging.ERROR, exception=type(exc).__name__)
            raise IndexNotReadyError() from exc

    async def close(self) -> None:
        pool, self._pool = self._pool, None
        self._opened = False
        self._last_coverage = None
        if pool is not None:
            await pool.close()


async def _fetch_one(conn: _Connection, query: str, params: Sequence[object] | None = None) -> Sequence[Any] | None:
    cursor = await conn.execute(query, params)
    row: Sequence[Any] | None = await cursor.fetchone()
    return row


def _identity_matches(row: Sequence[Any], descriptor: ModelDescriptor) -> bool:
    """The active row must be ACTIVE and carry exactly the identity of the descriptor in use."""
    embedding_version, model_version, preprocess_version, dimension, artifact_format, sha256, status, _ = row
    return (
        status == "ACTIVE"
        and embedding_version == descriptor.embedding_version
        and model_version == descriptor.model_version
        and preprocess_version == descriptor.preprocess_version
        and int(dimension) == descriptor.embedding_dimension
        and artifact_format == descriptor.artifact_format
        and str(sha256).strip() == descriptor.artifact_sha256
    )


def _vector_literal(vector: Sequence[float], descriptor: ModelDescriptor) -> str:
    if len(vector) != descriptor.embedding_dimension or not all(math.isfinite(v) for v in vector):
        raise InferenceOutputError()
    return "[" + ",".join(repr(float(v)) for v in vector) + "]"


def _parse_vector(text: object, descriptor: ModelDescriptor) -> tuple[float, ...]:
    """pgvector text form ``[a,b,...]``; a wrong dimension or non-finite value means a corrupt row, not a result."""
    raw = str(text).strip()
    if not (raw.startswith("[") and raw.endswith("]")):
        raise InferenceOutputError()
    try:
        values = tuple(float(part) for part in raw[1:-1].split(","))
    except ValueError as exc:
        raise InferenceOutputError() from exc
    if len(values) != descriptor.embedding_dimension or not all(math.isfinite(v) for v in values):
        raise InferenceOutputError()
    return values


def _parse_compact_vector(encoded: object, descriptor: ModelDescriptor) -> tuple[float, ...]:
    """Decode pgvector's network-order float32 format without losing its original precision."""
    if not isinstance(encoded, str):
        raise InferenceOutputError()
    try:
        raw = base64.b64decode("".join(encoded.split()), validate=True)
        dimension = descriptor.embedding_dimension
        if len(raw) != 4 + 4 * dimension:
            raise InferenceOutputError()
        actual, reserved = struct.unpack_from("!HH", raw)
        if actual != dimension or reserved != 0:
            raise InferenceOutputError()
        values = struct.unpack_from(f"!{dimension}f", raw, 4)
    except (binascii.Error, ValueError, struct.error) as exc:
        raise InferenceOutputError() from exc
    if not all(math.isfinite(value) for value in values):
        raise InferenceOutputError()
    return values
