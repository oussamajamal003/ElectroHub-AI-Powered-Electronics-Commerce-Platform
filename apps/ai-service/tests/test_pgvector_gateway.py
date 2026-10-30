from __future__ import annotations

import asyncio
import base64
import math
import os
import struct
import uuid
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from typing import Any

import psycopg
import pytest
from psycopg_pool import AsyncConnectionPool
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

    def __init__(
        self,
        *,
        active: tuple[Any, ...] | None = ACTIVE_ROW,
        indexed: int = 3,
        base_indexed: int = 3,
        nearest: Sequence[Any] = (),
    ):
        self.active = active
        self.indexed = indexed
        self.base_indexed = base_indexed
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
        if "FROM ai.catalog_media_sources" in query:
            return FakeCursor([(3, self.indexed)])
        if "SELECT count(*) FROM ai.product_image_embeddings" in query:
            return FakeCursor([(self.base_indexed,)])
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
    # Psycopg's asyncio driver needs a selector loop on Windows; the Proactor loop can hang while
    # creating its self-pipe in restricted development environments.
    loop = asyncio.SelectorEventLoop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def ranked_rows(*distances: float) -> list[tuple[uuid.UUID, float]]:
    return [(uuid.UUID(int=i + 1), d) for i, d in enumerate(distances)]


# --- readiness -----------------------------------------------------------------------------------------------------


def test_ready_when_active_identity_is_compatible_even_if_media_overlay_is_pending() -> None:
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
        {"base_indexed": 2},
        {"active": None},
    ],
)
def test_any_active_identity_or_base_snapshot_mismatch_is_not_ready(change: dict[str, Any]) -> None:
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
    base_indexed = change.pop("base_indexed", 3)
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
    db = FakeDatabase(active=active, indexed=indexed, base_indexed=base_indexed)
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
    assert params == (DESCRIPTOR.embedding_version, DESCRIPTOR.embedding_version, "[0.5,0.5,0.5,0.5]", 7)
    assert "ORDER BY d ASC, product_id ASC" in query
    assert "source.source_revision IS NULL" in query
    assert "overlay.source_revision = source.source_revision" in query
    assert "overlay.source_sha256 = source.source_sha256" in query
    assert "source.eligible" in query


def test_readiness_keeps_search_available_while_revision_overlay_is_pending() -> None:
    db = FakeDatabase(active=ACTIVE_ROW, indexed=0)
    assert run(gateway_for(db).is_ready(DESCRIPTOR)) is True
    assert any("ai.catalog_media_sources" in query and "ai.media_image_embeddings" in query for query, _ in db.executed)


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


def test_default_pool_keeps_a_warm_connection_with_a_remote_pooler_connect_budget() -> None:
    # Regression: with min_size=0, a 5 s connect and a 3 s pool wait, every readiness check timed out against the remote
    # DEV pooler (5-9 s per TLS connect), so image search was permanently INDEX_NOT_READY.
    pool = pgvector_gateway._default_pool_factory("postgresql://reader@127.0.0.1:5432/postgres")()
    assert isinstance(pool, AsyncConnectionPool)
    assert pool.min_size == 1
    assert pool.timeout >= 10
    assert pool.kwargs["connect_timeout"] >= 15
    assert pool.kwargs["autocommit"] is True


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


# --- Task 04.4: centroid and nearest-product reads -----------------------------------------------------------------

PRODUCT_READ_SQL = (
    pgvector_gateway._CENTROIDS_SQL,
    pgvector_gateway._NEAREST_PRODUCTS_SQL,
    pgvector_gateway._RECOMMENDATION_CANDIDATES_SQL,
)


def _active_with(**changes: Any) -> tuple[Any, ...]:
    names = (
        "embedding_version",
        "model_version",
        "preprocess_version",
        "dimension",
        "artifact_format",
        "sha256",
        "status",
        "expected",
    )
    values = dict(zip(names, ACTIVE_ROW, strict=True))
    values.update(changes)
    return tuple(values[name] for name in names)


class ProductRowsDatabase(FakeDatabase):
    """Same active-row and readiness handling as FakeDatabase; answers the two Task 04.4 product statements with rows.

    FakeDatabase routes any statement that mentions ``ai.catalog_media_sources`` to the coverage branch, which the
    product statements also mention, so they are intercepted here first.
    """

    def __init__(self, *, rows: Sequence[Any] = (), **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self.product_rows = list(rows)

    async def execute(self, query: str, params: Sequence[object] | None = None) -> FakeCursor:
        if query in PRODUCT_READ_SQL:
            if self.fail_with is not None:
                raise self.fail_with
            self.executed.append((query, params))
            return FakeCursor(self.product_rows)
        return await super().execute(query, params)


def _product_params(query: str, db: FakeDatabase) -> Sequence[object] | None:
    return next(params for executed, params in db.executed if executed == query)


def test_parse_vector_accepts_pgvector_text_of_the_descriptor_dimension() -> None:
    assert pgvector_gateway._parse_vector("[0.5,0,-1,2]", DESCRIPTOR) == (0.5, 0.0, -1.0, 2.0)


def compact(*values: float) -> str:
    return base64.b64encode(struct.pack(f"!HH{len(values)}f", len(values), 0, *values)).decode()


def test_compact_vector_preserves_float32_and_rejects_corrupt_rows() -> None:
    assert pgvector_gateway._parse_compact_vector(compact(0.5, 0, -1, 2), DESCRIPTOR) == (0.5, 0, -1, 2)
    wrong_reserved = base64.b64encode(struct.pack("!HH4f", 4, 1, 1, 0, 0, 0)).decode()
    wrong_endian = base64.b64encode(struct.pack("<HH4f", 4, 0, 1, 0, 0, 0)).decode()
    truncated = base64.b64encode(struct.pack("!HH4f", 4, 0, 1, 0, 0, 0)[:-1]).decode()
    for value in (
        "not-base64",
        compact(1, 2, 3),
        compact(math.nan, 0, 0, 0),
        compact(math.inf, 0, 0, 0),
        wrong_reserved,
        wrong_endian,
        truncated,
        None,
    ):
        with pytest.raises(InferenceOutputError):
            pgvector_gateway._parse_compact_vector(value, DESCRIPTOR)


@pytest.mark.parametrize("text", ["[1,0,0]", "[1,0,0,0,0]", "[]", "[1,,0,0]"])
def test_parse_vector_rejects_the_wrong_dimension_or_empty_components(text: str) -> None:
    with pytest.raises(InferenceOutputError):
        pgvector_gateway._parse_vector(text, DESCRIPTOR)


@pytest.mark.parametrize("text", ["[nan,0,0,0]", "[inf,0,0,0]", "[-inf,0,0,0]"])
def test_parse_vector_rejects_non_finite_components(text: str) -> None:
    with pytest.raises(InferenceOutputError):
        pgvector_gateway._parse_vector(text, DESCRIPTOR)


@pytest.mark.parametrize("text", ["1,0,0,0", "(1,0,0,0)", "[1,0,x,0]", "[1;0;0;0]", ""])
def test_parse_vector_rejects_malformed_text(text: str) -> None:
    with pytest.raises(InferenceOutputError):
        pgvector_gateway._parse_vector(text, DESCRIPTOR)


def test_centroids_for_no_products_return_empty_without_touching_the_database() -> None:
    db = FakeDatabase()
    assert run(gateway_for(db).product_centroids([], descriptor=DESCRIPTOR)) == {}
    assert db.executed == [] and db.opened == 0


def test_centroid_lookup_is_bounded_to_the_documented_maximum() -> None:
    ids = [uuid.UUID(int=i) for i in range(1, 202)]
    db = FakeDatabase()
    with pytest.raises(ValidationFailedError):
        run(gateway_for(db).product_centroids(ids, descriptor=DESCRIPTOR))
    assert db.executed == []


def test_centroid_lookup_accepts_exactly_the_maximum() -> None:
    ids = [uuid.UUID(int=i) for i in range(1, 201)]
    db = ProductRowsDatabase()
    assert run(gateway_for(db).product_centroids(ids, descriptor=DESCRIPTOR)) == {}
    params = _product_params(pgvector_gateway._CENTROIDS_SQL, db)
    assert params is not None and len(params[2]) == 200  # type: ignore[arg-type]


def test_centroids_map_each_product_to_its_vector_and_image_count() -> None:
    db = ProductRowsDatabase(rows=[(uuid.UUID(int=1), "[1,0,0,0]", 3), (uuid.UUID(int=2), "[0,0.5,0,0]", 1)])
    result = run(gateway_for(db).product_centroids([uuid.UUID(int=1), uuid.UUID(int=2)], descriptor=DESCRIPTOR))
    assert result[uuid.UUID(int=1)] == pgvector_gateway.ProductVector(vector=(1.0, 0.0, 0.0, 0.0), image_count=3)
    assert result[uuid.UUID(int=2)] == pgvector_gateway.ProductVector(vector=(0.0, 0.5, 0.0, 0.0), image_count=1)
    params = _product_params(pgvector_gateway._CENTROIDS_SQL, db)
    expected_ids = [str(uuid.UUID(int=1)), str(uuid.UUID(int=2))]
    assert params == (DESCRIPTOR.embedding_version, DESCRIPTOR.embedding_version, expected_ids)


def test_a_corrupt_centroid_row_is_an_output_error_not_a_result() -> None:
    db = ProductRowsDatabase(rows=[(uuid.UUID(int=1), "[1,0,0]", 1)])
    with pytest.raises(InferenceOutputError):
        run(gateway_for(db).product_centroids([uuid.UUID(int=1)], descriptor=DESCRIPTOR))


def test_nearest_products_score_is_one_minus_distance_and_exclusions_are_passed_as_strings() -> None:
    db = ProductRowsDatabase(
        rows=[(uuid.UUID(int=1), 0.25, "[1,0,0,0]"), (uuid.UUID(int=2), 1.5, "[0,1,0,0]")],
    )
    excluded = [uuid.UUID(int=9)]
    restricted = [uuid.UUID(int=1), uuid.UUID(int=2)]

    results = run(
        gateway_for(db).nearest_products(
            VECTOR, top_k=5, descriptor=DESCRIPTOR, exclude=excluded, restrict_to=restricted
        )
    )

    assert [r.product_id for r in results] == [uuid.UUID(int=1), uuid.UUID(int=2)]
    assert [round(r.score, 6) for r in results] == [0.75, -0.5]
    assert results[0].vector == (1.0, 0.0, 0.0, 0.0)
    version = DESCRIPTOR.embedding_version
    assert _product_params(pgvector_gateway._NEAREST_PRODUCTS_SQL, db) == (
        version,
        version,
        "[1.0,0.0,0.0,0.0]",
        [str(uuid.UUID(int=9))],
        [str(uuid.UUID(int=1)), str(uuid.UUID(int=2))],
        [str(uuid.UUID(int=1)), str(uuid.UUID(int=2))],
        5,
    )


def test_nearest_products_without_restriction_passes_empty_lists() -> None:
    db = ProductRowsDatabase(rows=[(uuid.UUID(int=1), 0.1, "[1,0,0,0]")])
    run(gateway_for(db).nearest_products(VECTOR, top_k=1, descriptor=DESCRIPTOR))
    params = _product_params(pgvector_gateway._NEAREST_PRODUCTS_SQL, db)
    assert params is not None
    assert params[3] == [] and params[4] == [] and params[5] == []


def test_recommendation_candidates_build_anchor_and_neighbours_in_one_eligible_snapshot() -> None:
    db = ProductRowsDatabase(rows=[(True, True, uuid.UUID(int=1), 0.25, compact(1, 0, 0, 0))])
    excluded = [uuid.UUID(int=9)]
    restricted = [uuid.UUID(int=1), uuid.UUID(int=2)]
    indexed, results = run(
        gateway_for(db).recommendation_candidates(
            anchor_product_id=uuid.UUID(int=7),
            profile_signals=(),
            top_k=5,
            descriptor=DESCRIPTOR,
            exclude=excluded,
            restrict_to=restricted,
        )
    )

    assert indexed is True
    assert [(item.product_id, item.score, item.vector) for item in results] == [
        (uuid.UUID(int=1), 0.75, (1.0, 0.0, 0.0, 0.0))
    ]
    assert len(db.executed) == 1 and db.executed[0][0] == pgvector_gateway._RECOMMENDATION_CANDIDATES_SQL
    params = db.executed[0][1]
    assert params is not None
    assert params[0:9] == (
        DESCRIPTOR.embedding_version,
        DESCRIPTOR.embedding_version,
        [str(uuid.UUID(int=7))],
        [],
        [],
        str(uuid.UUID(int=7)),
        str(uuid.UUID(int=7)),
        DESCRIPTOR.embedding_dimension,
        str(uuid.UUID(int=7)),
    )
    assert params[9:15] == (
        DESCRIPTOR.embedding_version,
        DESCRIPTOR.model_version,
        DESCRIPTOR.preprocess_version,
        DESCRIPTOR.embedding_dimension,
        DESCRIPTOR.artifact_format,
        DESCRIPTOR.artifact_sha256,
    )
    assert params[15:] == (
        [str(uuid.UUID(int=9))],
        [str(uuid.UUID(int=1)), str(uuid.UUID(int=2))],
        [str(uuid.UUID(int=1)), str(uuid.UUID(int=2))],
        5,
    )
    query = db.executed[0][0]
    assert "extensions.l2_normalize" in query and "extensions.sum" in query
    assert "active_identity" in query and "active_match" in query
    assert "ORDER BY distance ASC, candidate.product_id ASC" in query
    assert all(
        predicate in query
        for predicate in (
            "source.eligible",
            "source.source_revision IS NULL",
            "overlay.source_revision = source.source_revision",
            "overlay.source_sha256 = source.source_sha256",
        )
    )
    assert DESCRIPTOR.embedding_version not in query and "43e75" not in query


def test_cancelled_recommendation_records_the_pending_database_phase(monkeypatch: pytest.MonkeyPatch) -> None:
    events: list[tuple[str, dict[str, object]]] = []
    monkeypatch.setattr(pgvector_gateway, "log_event", lambda name, **fields: events.append((name, fields)))

    class WaitingPool(FakePool):
        @asynccontextmanager
        async def connection(self) -> AsyncIterator[FakeConnection]:
            await asyncio.sleep(1)
            yield FakeConnection(self._db)

    db = FakeDatabase()
    gateway = PgVectorGateway(dsn=DSN, pool_factory=lambda: WaitingPool(db))
    with pytest.raises(TimeoutError):
        run(
            asyncio.wait_for(
                gateway.recommendation_candidates(
                    anchor_product_id=uuid.UUID(int=7), profile_signals=(), top_k=2, descriptor=DESCRIPTOR
                ),
                timeout=0.01,
            )
        )
    assert len(events) == 1
    assert events[0][0] == "ai.recommendation_db_timing"
    assert events[0][1]["phase"] == "connection_acquisition"
    assert events[0][1]["sqlMs"] is None


def test_recommendation_candidates_pass_profile_ids_and_weights_without_customer_identity() -> None:
    signals = [(uuid.UUID(int=1), 1.0), (uuid.UUID(int=2), 0.5)]
    db = ProductRowsDatabase(rows=[(True, True, uuid.UUID(int=3), 0.2, compact(0, 1, 0, 0))])
    indexed, results = run(
        gateway_for(db).recommendation_candidates(
            anchor_product_id=None,
            profile_signals=signals,
            top_k=3,
            descriptor=DESCRIPTOR,
            exclude=[uuid.UUID(int=1), uuid.UUID(int=2)],
        )
    )
    assert indexed is True and [item.product_id for item in results] == [uuid.UUID(int=3)]
    params = db.executed[0][1]
    assert params is not None
    assert params[2:9] == (
        [str(uuid.UUID(int=1)), str(uuid.UUID(int=2))],
        [str(uuid.UUID(int=1)), str(uuid.UUID(int=2))],
        [1.0, 0.5],
        None,
        None,
        DESCRIPTOR.embedding_dimension,
        None,
    )
    assert all("user" not in str(value).lower() for value in params)


def test_recommendation_candidates_report_unindexed_anchor_and_active_mismatch_fail_closed() -> None:
    unindexed = ProductRowsDatabase(rows=[(True, False, None, None, None)])
    indexed, results = run(
        gateway_for(unindexed).recommendation_candidates(
            anchor_product_id=uuid.UUID(int=7), profile_signals=(), top_k=2, descriptor=DESCRIPTOR
        )
    )
    assert indexed is False and results == []

    mismatch = ProductRowsDatabase(rows=[(False, True, None, None, None)])
    with pytest.raises(IndexNotReadyError):
        run(
            gateway_for(mismatch).recommendation_candidates(
                anchor_product_id=uuid.UUID(int=7), profile_signals=(), top_k=2, descriptor=DESCRIPTOR
            )
        )


@pytest.mark.parametrize(
    ("anchor", "signals", "top_k"),
    [
        (None, (), 1),
        (uuid.UUID(int=1), ((uuid.UUID(int=2), 1.0),), 1),
        (uuid.UUID(int=1), (), 0),
        (uuid.UUID(int=1), (), pgvector_gateway.MAX_PRODUCT_LOOKUP + 1),
        (None, ((uuid.UUID(int=1), 0.0),), 1),
        (None, ((uuid.UUID(int=1), math.nan),), 1),
    ],
)
def test_recommendation_candidates_validate_query_and_boundaries(
    anchor: uuid.UUID | None, signals: Any, top_k: int
) -> None:
    db = ProductRowsDatabase()
    with pytest.raises(ValidationFailedError):
        run(
            gateway_for(db).recommendation_candidates(
                anchor_product_id=anchor, profile_signals=signals, top_k=top_k, descriptor=DESCRIPTOR
            )
        )
    assert db.executed == []


@pytest.mark.parametrize("top_k", [0, 201])
def test_nearest_products_top_k_is_bounded(top_k: int) -> None:
    db = ProductRowsDatabase()
    with pytest.raises(ValidationFailedError):
        run(gateway_for(db).nearest_products(VECTOR, top_k=top_k, descriptor=DESCRIPTOR))
    assert db.executed == []


def test_a_non_finite_distance_is_an_output_error() -> None:
    db = ProductRowsDatabase(rows=[(uuid.UUID(int=1), math.nan, "[1,0,0,0]")])
    with pytest.raises(InferenceOutputError):
        run(gateway_for(db).nearest_products(VECTOR, top_k=1, descriptor=DESCRIPTOR))


@pytest.mark.parametrize(
    "active",
    [
        _active_with(status="RETIRED"),
        _active_with(embedding_version="other-emb"),
        _active_with(model_version="other-model"),
        _active_with(sha256="f" * 64),
        None,
    ],
)
def test_product_reads_fail_closed_when_the_active_identity_does_not_match(active: tuple[Any, ...] | None) -> None:
    db = ProductRowsDatabase(active=active, rows=[(uuid.UUID(int=1), 0.1, "[1,0,0,0]")])
    gateway = gateway_for(db)
    with pytest.raises(IndexNotReadyError):
        run(gateway.nearest_products(VECTOR, top_k=1, descriptor=DESCRIPTOR))
    with pytest.raises(IndexNotReadyError):
        run(gateway.product_centroids([uuid.UUID(int=1)], descriptor=DESCRIPTOR))
    assert not any(query in PRODUCT_READ_SQL for query, _ in db.executed)


def test_product_reads_apply_the_04_3_eligibility_predicates() -> None:
    predicates = (
        "source.eligible",
        "source.source_revision IS NULL",
        "overlay.source_revision = source.source_revision",
        "overlay.source_sha256 = source.source_sha256",
    )
    for query in PRODUCT_READ_SQL:
        for predicate in predicates:
            assert predicate in query

    db = ProductRowsDatabase(rows=[(uuid.UUID(int=1), "[1,0,0,0]", 1)])
    run(gateway_for(db).product_centroids([uuid.UUID(int=1)], descriptor=DESCRIPTOR))
    executed_centroids = next(query for query, _ in db.executed if query == pgvector_gateway._CENTROIDS_SQL)
    assert all(predicate in executed_centroids for predicate in predicates)
