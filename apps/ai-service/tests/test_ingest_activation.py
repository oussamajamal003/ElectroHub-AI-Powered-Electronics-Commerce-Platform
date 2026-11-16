from __future__ import annotations

from typing import Any

import pytest

from app.ingest import __main__ as ingest


class FakeCursor:
    def __init__(self, row: tuple[Any, ...]) -> None:
        self.row = row

    def fetchone(self) -> tuple[Any, ...]:
        return self.row


class FakeConnection:
    def __init__(self, *, coverage: tuple[int, int, int], stored: int, stale: int) -> None:
        self.coverage = coverage
        self.stored = stored
        self.stale = stale
        self.executed: list[tuple[str, tuple[Any, ...] | None]] = []

    def execute(self, query: str, params: tuple[Any, ...] | None = None) -> FakeCursor:
        self.executed.append((query, params))
        if query == ingest._SNAPSHOT_COUNTS_SQL:
            return FakeCursor(self.coverage)
        if query == ingest._SNAPSHOT_STORED_SQL:
            return FakeCursor((self.stored,))
        if query == ingest._SNAPSHOT_STALE_SQL:
            return FakeCursor((self.stale,))
        raise AssertionError("unexpected activation guard query")


def test_activation_allows_complete_current_legacy_and_revisioned_snapshot() -> None:
    connection = FakeConnection(coverage=(3, 3, 0), stored=3, stale=0)
    assert ingest.verify_current_snapshot(connection, "candidate", 3) == (3, 3)
    assert [params for _, params in connection.executed] == [
        ("candidate",),
        ("candidate",),
        ("candidate",),
    ]


def test_activation_rejects_same_count_when_revisioned_source_digest_is_stale() -> None:
    connection = FakeConnection(coverage=(3, 3, 1), stored=3, stale=0)
    with pytest.raises(SystemExit, match="digest_mismatch=1"):
        ingest.verify_current_snapshot(connection, "candidate", 3)


@pytest.mark.parametrize(
    ("coverage", "stored", "stale", "expected"),
    [
        ((3, 2, 0), 3, 0, 3),  # missing current image, even when total vectors equal the expected count
        ((3, 3, 0), 3, 1, 3),  # hidden/retired or replaced image vector remains in the staged snapshot
        ((3, 3, 0), 4, 0, 3),  # duplicate extra vector
        ((3, 3, 0), 3, 0, None),  # no frozen plan count
    ],
)
def test_activation_refuses_incomplete_or_stale_source_sets(
    coverage: tuple[int, int, int], stored: int, stale: int, expected: int | None
) -> None:
    with pytest.raises(SystemExit, match="refusing to activate"):
        ingest.verify_current_snapshot(
            FakeConnection(coverage=coverage, stored=stored, stale=stale), "candidate", expected
        )


def test_activation_freshness_sql_uses_exact_image_product_and_digest_identity() -> None:
    assert "ai.catalog_media_sources" in ingest._SNAPSHOT_COUNTS_SQL
    assert "e.product_image_id = source.product_image_id" in ingest._SNAPSHOT_COUNTS_SQL
    assert "e.product_id = source.product_id" in ingest._SNAPSHOT_COUNTS_SQL
    assert "e.image_sha256 IS DISTINCT FROM source.source_sha256" in ingest._SNAPSHOT_COUNTS_SQL
    assert "source.eligible" in ingest._SNAPSHOT_STALE_SQL


def test_activation_locks_catalog_eligibility_until_pointer_commit() -> None:
    assert ingest._LOCK_CATALOG_SNAPSHOT_SQL == (
        "LOCK TABLE public.products, public.categories, public.product_images IN SHARE MODE"
    )
