"""pgvector-backed ``EmbeddingSearchGateway`` over the ``ai`` schema (Task 04.2).

Every connection is read-only (``default_transaction_read_only=on``), resolves only ``ai`` and ``extensions``, and is
bounded by a statement timeout. Readiness and search each run in one REPEATABLE READ transaction, so the active
version checked before a search is the version its vectors come from. Nothing here writes, and no URL, credential,
vector or product list is logged.
"""

from __future__ import annotations

import asyncio
import logging
import math
from collections.abc import AsyncIterator, Callable, Sequence
from contextlib import AbstractAsyncContextManager, asynccontextmanager
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
CONNECT_TIMEOUT_SECONDS: Final = 5
POOL_TIMEOUT_SECONDS: Final = 3.0
_SESSION_OPTIONS: Final = (
    f"-c search_path=ai,extensions -c statement_timeout={STATEMENT_TIMEOUT_MS} "
    "-c default_transaction_read_only=on"
)

_ACTIVE_SQL: Final = """
SELECT a.embedding_version, m.model_version, m.preprocess_version, m.embedding_dimension,
       m.artifact_format, m.artifact_sha256, m.status, m.expected_images
FROM ai.active_index AS a
JOIN ai.model_versions AS m ON m.embedding_version = a.embedding_version
WHERE a.singleton
"""

_INDEXED_COUNT_SQL: Final = """
SELECT count(*) FROM ai.product_image_embeddings WHERE embedding_version = %s
"""

_NEAREST_SQL: Final = """
SELECT product_id, MIN(embedding <=> %s::vector) AS d
FROM ai.product_image_embeddings
WHERE embedding_version = %s
GROUP BY product_id
ORDER BY d ASC, product_id ASC
LIMIT %s
"""

_REPEATABLE_READ_SQL: Final = "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"


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
            min_size=0,
            max_size=POOL_MAX_SIZE,
            timeout=POOL_TIMEOUT_SECONDS,
            open=False,
            name="electrohub-ai-vector",
            kwargs={
                "options": _SESSION_OPTIONS,
                "application_name": APPLICATION_NAME,
                "connect_timeout": CONNECT_TIMEOUT_SECONDS,
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
                count_row = await _fetch_one(conn, _INDEXED_COUNT_SQL, (descriptor.embedding_version,))
                return count_row is not None and int(count_row[0]) == int(expected)
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
        if len(vector) != descriptor.embedding_dimension or not all(math.isfinite(v) for v in vector):
            raise InferenceOutputError()
        literal = "[" + ",".join(repr(float(v)) for v in vector) + "]"

        try:
            async with self._read_transaction() as conn:
                # Re-check inside the snapshot: a version switch between encode and search is an index miss, not a mix.
                active = await _fetch_one(conn, _ACTIVE_SQL)
                if active is None or not _identity_matches(active, descriptor):
                    raise IndexNotReadyError()
                cursor = await conn.execute(_NEAREST_SQL, (literal, descriptor.embedding_version, top_k))
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

    async def close(self) -> None:
        pool, self._pool = self._pool, None
        self._opened = False
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
