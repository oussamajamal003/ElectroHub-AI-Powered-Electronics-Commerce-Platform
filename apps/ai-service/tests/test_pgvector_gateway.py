from __future__ import annotations

import asyncio
import math
import os
import uuid
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from typing import Any

import psycopg
import pytest
from pydantic import ValidationError

from app.core.config import ConfigurationError, check_vector_database_url, load_settings, settings_from_mapping
from app.core.errors import IndexNotReadyError, InferenceOutputError, ValidationFailedError
from app.integrations import pgvector_gateway
from app.integrations.pgvector_gateway import PgVectorGateway
from tests.conftest import TEST_KEY, make_settings
from tests.fakes import DESCRIPTOR

ACTIVE_ROW: tuple[Any, ...] = (
    DESCRIPTOR.embedding_version,
    DESCRIPTOR.model_version,
    DESCRIPTOR.preprocess_version,
    DESCRIPTOR.embedding_dimension,
    DESCRIPTOR.artifact_format,
    DESCRIPTOR.artifact_sha256,
    "ACTIVE",
    3,
)
VECTOR = (1.0, 0.0, 0.0, 0.0)
DSN = "postgresql://ai_vector_reader:s3cret-password@db.internal.example:5432/electrohub?sslmode=require"


class FakeCursor:
    def __init__(self, rows: Sequence[Any]) -> None:
        self._rows = list(rows)

    async def fetchone(self) -> Any:
        return self._rows[0] if self._rows else None

    async def fetchall(self) -> list[Any]:
        return list(self._rows)


class FakeDatabase:
    """Answers the gateway's three statement shapes and records every (sql, params) it was asked to run."""

    def __init__(self, *, active: tuple[Any, ...] | None = ACTIVE_ROW, indexed: int = 3, nearest: Sequence[Any] = ()):
        self.active = active
        self.indexed = indexed
        self.nearest_rows = list(nearest)
        self.executed: list[tuple[str, Sequence[object] | None]] = []
        self.opened = 0
        self.closed = 0
        self.fail_with: Exception | None = None
        self.active_changes_after_first_read: tuple[Any, ...] | None = None
        self._active_reads = 0

    async def execute(self, query: str, params: Sequence[object] | None = None) -> FakeCursor:
        if self.fail_with is not None:
            raise self.fail_with
        self.executed.append((query, params))
        if "FROM ai.active_index" in query:
            self._active_reads += 1
            if self._active_reads > 1 and self.active_changes_after_first_read is not None:
                return FakeCursor([self.active_changes_after_first_read])
            return FakeCursor([] if self.active is None else [self.active])
        if "count(*)" in query:
            return FakeCursor([(self.indexed,)])
        if "GROUP BY product_id" in query:
            return FakeCursor(self.nearest_rows)
        return FakeCursor([])


class FakeConnection:
    def __init__(self, db: FakeDatabase) -> None:
        self._db = db

    @asynccontextmanager
    async def transaction(self) -> AsyncIterator[None]:
        yield None

    async def execute(self, query: str, params: Sequence[object] | None = None) -> FakeCursor:
        return await self._db.execute(query, params)


class FakePool:
    def __init__(self, db: FakeDatabase) -> None:
        self._db = db

    async def open(self, wait: bool = False) -> None:
        self._db.opened += 1

    @asynccontextmanager
    async def connection(self) -> AsyncIterator[FakeConnection]:
        yield FakeConnection(self._db)

    async def close(self) -> None:
        self._db.closed += 1


def gateway_for(db: FakeDatabase) -> PgVectorGateway:
    return PgVectorGateway(dsn=DSN, pool_factory=lambda: FakePool(db))


def run(coro: Any) -> Any:
    return asyncio.run(coro)


def ranked_rows(*distances: float) -> list[tuple[uuid.UUID, float]]:
    return [(uuid.UUID(int=i + 1), d) for i, d in enumerate(distances)]


# --- readiness -----------------------------------------------------------------------------------------------------


def test_ready_only_when_active_identity_matches_and_every_expected_image_is_indexed() -> None:
    db = FakeDatabase(active=ACTIVE_ROW, indexed=3)
    assert run(gateway_for(db).is_ready(DESCRIPTOR)) is True


@pytest.mark.parametrize(
    "change",
    [
        {"status": "VERIFIED"},
        {"model_version": "other-model"},
        {"preprocess_version": "other-pre"},
        {"dimension": 8},
        {"artifact_format": "onnx"},
        {"sha256": "f" * 64},
        {"expected": None},
        {"expected": 0},
        {"embedding_version": "other-emb"},
        {"indexed": 2},
        {"active": None},
    ],
)
def test_any_identity_or_coverage_mismatch_is_not_ready(change: dict[str, Any]) -> None:
    fields = {
        "embedding_version": DESCRIPTOR.embedding_version,
        "model_version": DESCRIPTOR.model_version,
        "preprocess_version": DESCRIPTOR.preprocess_version,
        "dimension": DESCRIPTOR.embedding_dimension,
        "artifact_format": DESCRIPTOR.artifact_format,
        "sha256": DESCRIPTOR.artifact_sha256,
        "status": "ACTIVE",
        "expected": 3,
    }
    indexed = change.pop("indexed", 3)
    active_override = change.pop("active", "unset")
    fields.update(change)
    active: tuple[Any, ...] | None = (
        None
        if active_override is None
        else (
            fields["embedding_version"],
            fields["model_version"],
            fields["preprocess_version"],
            fields["dimension"],
            fields["artifact_format"],
            fields["sha256"],
            fields["status"],
            fields["expected"],
        )
    )
    db = FakeDatabase(active=active, indexed=indexed)
    assert run(gateway_for(db).is_ready(DESCRIPTOR)) is False


def test_database_failure_during_readiness_is_not_ready_not_an_exception() -> None:
    db = FakeDatabase()
    db.fail_with = psycopg.OperationalError("connection refused")
    assert run(gateway_for(db).is_ready(DESCRIPTOR)) is False


def test_readiness_and_search_run_inside_a_repeatable_read_transaction() -> None:
    db = FakeDatabase()
    run(gateway_for(db).is_ready(DESCRIPTOR))
    assert db.executed[0][0] == pgvector_gateway._REPEATABLE_READ_SQL


# --- nearest ------------------------------------------------------------------------------------------------------


def test_nearest_scores_are_one_minus_cosine_distance_with_contiguous_ranks() -> None:
    db = FakeDatabase(nearest=ranked_rows(0.1, 0.5, 1.2))
    matches = run(gateway_for(db).nearest(VECTOR, top_k=3, descriptor=DESCRIPTOR))
    assert [m.rank for m in matches] == [1, 2, 3]
    assert [round(m.score, 6) for m in matches] == [0.9, 0.5, -0.2]
    assert [m.product_id for m in matches] == [uuid.UUID(int=1), uuid.UUID(int=2), uuid.UUID(int=3)]


def test_scores_are_clamped_to_the_contract_range() -> None:
    db = FakeDatabase(nearest=ranked_rows(-0.5, 2.5))
    matches = run(gateway_for(db).nearest(VECTOR, top_k=2, descriptor=DESCRIPTOR))
    assert [m.score for m in matches] == [1.0, -1.0]


def test_nearest_query_is_parameterised_and_never_interpolates_values() -> None:
    db = FakeDatabase(nearest=ranked_rows(0.2))
    run(gateway_for(db).nearest((0.5, 0.5, 0.5, 0.5), top_k=7, descriptor=DESCRIPTOR))
    query, params = next((q, p) for q, p in db.executed if "GROUP BY product_id" in q)
    assert "%s::vector" in query and "embedding_version = %s" in query and "LIMIT %s" in query
    assert DESCRIPTOR.embedding_version not in query and "0.5" not in query
    assert params == ("[0.5,0.5,0.5,0.5]", DESCRIPTOR.embedding_version, 7)
    assert "ORDER BY d ASC, product_id ASC" in query


def test_active_version_change_inside_the_transaction_is_an_index_miss() -> None:
    db = FakeDatabase(nearest=ranked_rows(0.2))
    db.active_changes_after_first_read = ("other-emb", "m", "p", 4, "safetensors", "a" * 64, "ACTIVE", 3)
    gateway = gateway_for(db)
    # Readiness saw the matching version; it switches before the search runs, so the search must not mix spaces.
    assert run(gateway.is_ready(DESCRIPTOR)) is True
    with pytest.raises(IndexNotReadyError):
        run(gateway.nearest(VECTOR, top_k=1, descriptor=DESCRIPTOR))
    assert not any("GROUP BY product_id" in q for q, _ in db.executed)


def test_inactive_or_missing_index_refuses_the_search() -> None:
    db = FakeDatabase(active=None, nearest=ranked_rows(0.2))
    with pytest.raises(IndexNotReadyError):
        run(gateway_for(db).nearest(VECTOR, top_k=1, descriptor=DESCRIPTOR))


def test_query_failure_surfaces_as_index_not_ready() -> None:
    db = FakeDatabase()
    db.fail_with = psycopg.errors.QueryCanceled("statement timeout")
    with pytest.raises(IndexNotReadyError):
        run(gateway_for(db).nearest(VECTOR, top_k=1, descriptor=DESCRIPTOR))


@pytest.mark.parametrize(
    "vector",
    [(1.0, 0.0, 0.0), (math.nan, 0.0, 0.0, 0.0), (math.inf, 0.0, 0.0, 0.0), (1.0, 0.0, 0.0, 0.0, 0.0)],
)
def test_invalid_query_vectors_never_reach_the_database(vector: tuple[float, ...]) -> None:
    db = FakeDatabase(nearest=ranked_rows(0.2))
    with pytest.raises(InferenceOutputError):
        run(gateway_for(db).nearest(vector, top_k=1, descriptor=DESCRIPTOR))
    assert db.executed == []


@pytest.mark.parametrize("top_k", [0, 101])
def test_top_k_is_bounded_by_the_contract(top_k: int) -> None:
    with pytest.raises(ValidationFailedError):
        run(gateway_for(FakeDatabase()).nearest(VECTOR, top_k=top_k, descriptor=DESCRIPTOR))


def test_pool_is_opened_once_and_closed_with_the_gateway() -> None:
    db = FakeDatabase(nearest=ranked_rows(0.2))

    async def main() -> None:
        gateway = gateway_for(db)
        await gateway.is_ready(DESCRIPTOR)
        await gateway.nearest(VECTOR, top_k=1, descriptor=DESCRIPTOR)
        await gateway.close()

    run(main())
    assert db.opened == 1 and db.closed == 1


def test_gateway_repr_never_shows_the_dsn() -> None:
    rendered = repr(gateway_for(FakeDatabase()))
    assert "s3cret-password" not in rendered and "db.internal" not in rendered


def test_session_options_pin_schema_timeout_and_read_only_mode() -> None:
    options = pgvector_gateway._SESSION_OPTIONS
    assert "search_path=ai,extensions" in options
    assert "statement_timeout=2000" in options
    assert "default_transaction_read_only=on" in options


# --- DSN and settings validation ------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "url",
    [
        "postgresql://u:p@db.example.com:5432/app?sslmode=require",
        "postgresql://u:p@db.example.com/app?sslmode=verify-full",
        "postgres://u:p@db.example.com/app?sslmode=verify-ca",
        "postgresql://u:p@localhost/app",
        "postgresql://u:p@127.0.0.1:5432/app?sslmode=disable",
        "postgresql://u:p@[::1]/app",
    ],
)
def test_accepted_vector_urls(url: str) -> None:
    check_vector_database_url(url)


@pytest.mark.parametrize(
    "url",
    [
        "postgresql://u:p@db.example.com/app",
        "postgresql://u:p@db.example.com/app?sslmode=disable",
        "postgresql://u:p@db.example.com/app?sslmode=prefer",
        "mysql://u:p@localhost/app",
        "postgresql://u:p@/app",
        "postgresql://u:p@localhost:99999/app",
        "postgresql://u:p@localhost",
    ],
)
def test_rejected_vector_urls_never_echo_the_secret(url: str) -> None:
    with pytest.raises(ValueError) as exc:
        check_vector_database_url(url)
    assert "s3cret" not in str(exc.value) and "u:p" not in str(exc.value)


def test_vector_url_is_a_secret_and_blank_means_absent() -> None:
    settings = make_settings(AI_VECTOR_DATABASE_URL=DSN)
    assert "s3cret-password" not in repr(settings) and "s3cret-password" not in str(settings.model_dump())
    assert settings.AI_VECTOR_DATABASE_URL is not None
    assert make_settings(AI_VECTOR_DATABASE_URL="").AI_VECTOR_DATABASE_URL is None


def test_invalid_vector_url_fails_settings_validation_without_the_secret() -> None:
    with pytest.raises(ValidationError) as exc:
        make_settings(AI_VECTOR_DATABASE_URL="postgresql://u:s3cret-password@db.example.com/app")
    assert "s3cret-password" not in str(exc.value)


def test_database_url_remains_a_forbidden_commerce_secret() -> None:
    with pytest.raises(ConfigurationError, match="DATABASE_URL"):
        load_settings(
            {"AI_ENVIRONMENT": "development", "AI_SERVICE_API_KEY": TEST_KEY, "DATABASE_URL": DSN},
            env_file=None,
        )


def test_settings_defaults_for_the_image_path() -> None:
    settings = settings_from_mapping({"AI_ENVIRONMENT": "test", "AI_SERVICE_API_KEY": TEST_KEY})
    assert settings.AI_MAX_IMAGE_BYTES == 8_388_608
    assert settings.AI_MAX_IMAGE_PIXELS == 40_000_000
    assert settings.AI_TORCH_THREADS == 2
    assert settings.AI_MODEL_ARTIFACT_DIR is None and settings.AI_VECTOR_DATABASE_URL is None


# --- opt-in integration ---------------------------------------------------------------------------------------------

INTEGRATION_URL = os.environ.get("AI_TEST_VECTOR_DATABASE_URL", "")


@pytest.mark.skipif(not INTEGRATION_URL, reason="AI_TEST_VECTOR_DATABASE_URL is not set")
def test_integration_readiness_and_search_run_read_only_against_the_real_schema() -> None:
    """Read-only smoke against a migrated database. A fresh index has no version matching the fake descriptor, so
    readiness is False and search refuses; the test writes nothing."""

    async def main() -> None:
        gateway = PgVectorGateway(dsn=INTEGRATION_URL)
        try:
            assert await gateway.is_ready(DESCRIPTOR) is False
            with pytest.raises(IndexNotReadyError):
                await gateway.nearest(VECTOR, top_k=1, descriptor=DESCRIPTOR)
        finally:
            await gateway.close()

    # Psycopg's async driver needs a selector loop; the default Windows loop is the proactor.
    loop = asyncio.SelectorEventLoop()
    try:
        loop.run_until_complete(main())
    finally:
        loop.close()
