from __future__ import annotations

import hashlib
from pathlib import Path
from uuid import UUID

import pytest

from app.media_sync import (
    MediaSyncError,
    _canonical_object_url,
    _vector_literal,
    resolve_source,
)
from tests.fakes import DESCRIPTOR
from tests.imagefactory import png_bytes


def test_storage_url_is_derived_from_bucket_and_safe_object_key() -> None:
    product_id = "00000000-0000-0000-0000-000000000001"
    image_id = "00000000-0000-0000-0000-000000000002"
    revision = "00000000-0000-0000-0000-000000000003"
    object_path = f"products/{product_id}/{image_id}/{revision}/original.webp"
    url = _canonical_object_url(
        "https://project.example",
        "product-media",
        object_path,
        product_id=UUID(product_id),
        image_id=UUID(image_id),
        source_revision=UUID(revision),
    )
    assert url == (
        f"https://project.example/storage/v1/object/public/product-media/products/{product_id}/{image_id}/"
        f"{revision}/original.webp"
    )


def test_storage_url_rejects_a_key_owned_by_another_image_revision() -> None:
    with pytest.raises(MediaSyncError, match="SOURCE_NOT_TRUSTED"):
        _canonical_object_url(
            "https://project.example",
            "product-media",
            "products/00000000-0000-0000-0000-000000000001/"
            "00000000-0000-0000-0000-000000000099/00000000-0000-0000-0000-000000000003/original.webp",
            product_id=UUID("00000000-0000-0000-0000-000000000001"),
            image_id=UUID("00000000-0000-0000-0000-000000000002"),
            source_revision=UUID("00000000-0000-0000-0000-000000000003"),
        )


@pytest.mark.parametrize(
    ("bucket", "object_path"),
    [
        (
            "../other",
            "products/00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000002/"
            "00000000-0000-0000-0000-000000000003/original.webp",
        ),
        (
            "product-media",
            "products/../00000000-0000-0000-0000-000000000002/00000000-0000-0000-0000-000000000003/original.webp",
        ),
        ("product-media", "/absolute.webp"),
    ],
)
def test_storage_key_traversal_is_refused(bucket: str, object_path: str) -> None:
    with pytest.raises(MediaSyncError, match="SOURCE_NOT_TRUSTED"):
        _canonical_object_url(
            "https://project.example",
            bucket,
            object_path,
            product_id=UUID("00000000-0000-0000-0000-000000000001"),
            image_id=UUID("00000000-0000-0000-0000-000000000002"),
            source_revision=UUID("00000000-0000-0000-0000-000000000003"),
        )


def test_storage_source_url_uses_database_owned_key_not_database_url(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    expected = png_bytes(64, 48)
    seen: list[str] = []
    product_id = UUID("00000000-0000-0000-0000-000000000001")
    image_id = UUID("00000000-0000-0000-0000-000000000002")
    revision = UUID("00000000-0000-0000-0000-000000000003")

    def fetch(url: str) -> bytes:
        seen.append(url)
        return expected

    monkeypatch.setattr("app.media_sync._fetch_public_source", fetch)
    result = resolve_source(
        provider="SUPABASE_STORAGE",
        bucket="product-media",
        object_path=f"products/{product_id}/{image_id}/{revision}/original.webp",
        url="https://attacker.invalid/secret.png",
        storage_base_url="https://project.example",
        catalog_root=tmp_path,
        product_id=product_id,
        image_id=image_id,
        source_revision=revision,
    )
    assert result == expected
    assert seen == [
        f"https://project.example/storage/v1/object/public/product-media/products/{product_id}/{image_id}/"
        f"{revision}/original.webp"
    ]


def test_unknown_provider_and_arbitrary_external_legacy_url_are_refused(tmp_path: Path) -> None:
    with pytest.raises(MediaSyncError, match="SOURCE_NOT_TRUSTED"):
        resolve_source(
            provider="EXTERNAL",
            bucket=None,
            object_path=None,
            url="https://attacker.invalid/a.png",
            storage_base_url="https://project.example",
            catalog_root=tmp_path,
        )


def test_legacy_local_source_is_confined_to_catalog_root(tmp_path: Path) -> None:
    (tmp_path / "images").mkdir()
    expected = png_bytes(64, 48)
    (tmp_path / "images" / "camera.png").write_bytes(expected)
    result = resolve_source(
        provider="LEGACY_LOCAL",
        bucket=None,
        object_path=None,
        url="/images/camera.png",
        storage_base_url=None,
        catalog_root=tmp_path,
    )
    assert hashlib.sha256(result).hexdigest()
    with pytest.raises(MediaSyncError, match="SOURCE_NOT_TRUSTED"):
        resolve_source(
            provider="LEGACY_LOCAL",
            bucket=None,
            object_path=None,
            url="/images/../../outside.png",
            storage_base_url=None,
            catalog_root=tmp_path,
        )


@pytest.mark.parametrize("vector", [[0.0, 0.0, 0.0, 0.0], [1.0, float("nan"), 0.0, 0.0], [2.0, 0.0, 0.0, 0.0]])
def test_worker_refuses_wrong_or_unnormalized_vectors(vector: list[float]) -> None:
    with pytest.raises(MediaSyncError, match="ENCODER_OUTPUT_INVALID"):
        _vector_literal(vector, DESCRIPTOR)


def test_worker_serializes_valid_normalized_vector() -> None:
    assert _vector_literal([1.0, 0.0, 0.0, 0.0], DESCRIPTOR) == "[1.00000000,0.00000000,0.00000000,0.00000000]"


def test_worker_claim_and_publish_sql_are_leased_and_source_guarded() -> None:
    from app.media_sync import _CLAIM_SQL, _EXHAUSTED_LEASE_SQL, _PUBLISH_SQL

    assert "FOR UPDATE SKIP LOCKED" in _CLAIM_SQL
    assert "state IN ('READY', 'RETRY_WAIT', 'CLAIMED')" in _CLAIM_SQL
    assert "claimedUntil" in _CLAIM_SQL and "leaseToken" in _CLAIM_SQL
    assert "attemptCount\" >= %s" in _EXHAUSTED_LEASE_SQL
    assert "LIMIT 100" in _EXHAUSTED_LEASE_SQL
    assert "FOR UPDATE SKIP LOCKED" in _EXHAUSTED_LEASE_SQL
    assert "'LEASE_EXHAUSTED'" in _EXHAUSTED_LEASE_SQL
    assert "ai.publish_media_embedding" in _PUBLISH_SQL
    assert _PUBLISH_SQL.count("%s") == 11


def test_claim_dead_letters_exhausted_expired_leases_before_claiming() -> None:
    from app.media_sync import _CLAIM_SQL, _EXHAUSTED_LEASE_SQL, MAX_ATTEMPTS, MediaSyncWorker

    executed: list[tuple[str, tuple[object, ...]]] = []

    class Cursor:
        def fetchone(self) -> None:
            return None

    class Connection:
        def __enter__(self) -> Connection:
            return self

        def __exit__(self, *_: object) -> None:
            return None

        def transaction(self) -> Connection:
            return self

        def execute(self, query: str, params: tuple[object, ...]) -> Cursor:
            executed.append((query, params))
            return Cursor()

    worker = MediaSyncWorker(
        dsn="unused",
        encoder=object(),
        storage_base_url=None,
        catalog_root=Path("."),
        connect=lambda *_args, **_kwargs: Connection(),
    )
    assert worker.claim() is None
    assert executed[0] == (_EXHAUSTED_LEASE_SQL, (MAX_ATTEMPTS,))
    assert executed[1][0] == _CLAIM_SQL


def test_reconciliation_runs_at_bounded_periodic_interval() -> None:
    from app.media_sync import _RECONCILE_SQL, RECONCILE_BATCH_SIZE, RECONCILE_INTERVAL_SECONDS, MediaSyncWorker

    executed: list[tuple[str, tuple[object, ...]]] = []

    class Cursor:
        def fetchone(self) -> tuple[int]:
            return (4,)

    class Connection:
        def __enter__(self) -> Connection:
            return self

        def __exit__(self, *_: object) -> None:
            return None

        def transaction(self) -> Connection:
            return self

        def execute(self, query: str, params: tuple[object, ...]) -> Cursor:
            executed.append((query, params))
            return Cursor()

    worker = MediaSyncWorker(
        dsn="unused",
        encoder=object(),
        storage_base_url=None,
        catalog_root=Path("."),
        connect=lambda *_args, **_kwargs: Connection(),
    )
    assert worker.reconcile_if_due(now=100) == 4
    assert worker.reconcile_if_due(now=100 + RECONCILE_INTERVAL_SECONDS - 1) == 0
    assert worker.reconcile_if_due(now=100 + RECONCILE_INTERVAL_SECONDS) == 4
    assert executed == [(_RECONCILE_SQL, (RECONCILE_BATCH_SIZE,))] * 2
    assert RECONCILE_BATCH_SIZE == 100


def test_reconciliation_sql_is_idempotent_and_requeues_only_recoverable_terminal_events() -> None:
    from pathlib import Path

    migration = (
        Path(__file__).resolve().parents[2]
        / "backend"
        / "prisma"
        / "migrations"
        / "20261028010000_catalog_media_overlay"
        / "migration.sql"
    ).read_text(encoding="utf-8")
    assert "ai.enqueue_missing_media_events(p_limit INTEGER DEFAULT 100)" in migration
    assert "p_limit > 100" in migration
    assert "'reconcile:' || candidate.embedding_version" in migration
    assert "ON CONFLICT (\"idempotencyKey\") DO UPDATE" in migration
    assert "state IN ('SUPERSEDED', 'COMPLETED')" in migration
    assert "state IN ('READY', 'CLAIMED', 'RETRY_WAIT', 'PERMANENT_FAILURE')" in migration
    assert "operation" in migration and "'RECONCILE'" in migration


def test_published_overlay_rolls_back_if_lease_acknowledgment_loses_race() -> None:
    from contextlib import contextmanager
    from uuid import uuid4

    from app.media_sync import _COMPLETE_SQL, MediaEvent, MediaSyncWorker

    statements: list[str] = []
    transaction_failed = False

    class Cursor:
        def __init__(self, *, rowcount: int = 1, value: bool = True) -> None:
            self.rowcount = rowcount
            self.value = value

        def fetchone(self) -> tuple[bool]:
            return (self.value,)

    class Connection:
        def __enter__(self) -> Connection:
            return self

        def __exit__(self, *_: object) -> None:
            return None

        @contextmanager
        def transaction(self):
            nonlocal transaction_failed
            try:
                yield
            except RuntimeError:
                transaction_failed = True
                raise

        def execute(self, query: str, _params: tuple[object, ...]) -> Cursor:
            statements.append(query)
            return Cursor(rowcount=0) if query == _COMPLETE_SQL else Cursor()

    event = MediaEvent(
        event_id=uuid4(),
        product_id=uuid4(),
        image_id=uuid4(),
        operation="ADDED",
        source_revision=uuid4(),
        source_sha256="a" * 64,
        attempt_count=1,
        lease_token=uuid4(),
    )
    worker = MediaSyncWorker(
        dsn="unused",
        encoder=type("Encoder", (), {"descriptor": DESCRIPTOR})(),
        storage_base_url=None,
        catalog_root=Path("."),
        connect=lambda *_args, **_kwargs: Connection(),
    )
    with pytest.raises(RuntimeError, match="lost before acknowledgment"):
        worker._mark_complete(event, vector="[1,0,0,0]")
    assert transaction_failed
    assert statements[-1] == _COMPLETE_SQL
