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
    from app.media_sync import _CLAIM_EVENT_SQL, _CLAIM_SQL, _EXHAUSTED_LEASE_SQL, _PUBLISH_SQL

    assert "FOR UPDATE SKIP LOCKED" in _CLAIM_SQL
    assert "state IN ('READY', 'RETRY_WAIT', 'CLAIMED')" in _CLAIM_SQL
    assert "claimedUntil" in _CLAIM_SQL and "leaseToken" in _CLAIM_SQL
    assert "event.id = %s::uuid" in _CLAIM_EVENT_SQL
    assert "FOR UPDATE OF event SKIP LOCKED" in _CLAIM_EVENT_SQL
    assert 'attemptCount" >= %s' in _EXHAUSTED_LEASE_SQL
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
    worker._ready = True
    assert worker.claim() is None
    assert executed[0] == (_EXHAUSTED_LEASE_SQL, (MAX_ATTEMPTS,))
    assert executed[1][0] == _CLAIM_SQL


def test_exact_event_claim_is_scoped_to_the_requested_fixture_id() -> None:
    from app.media_sync import _CLAIM_EVENT_SQL, LEASE_SECONDS, MediaSyncWorker

    event_id = UUID("00000000-0000-0000-0000-000000000031")
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
    worker._ready = True

    assert worker.claim(event_id) is None
    assert len(executed) == 1
    assert executed[0][0] == _CLAIM_EVENT_SQL
    assert executed[0][1][0] == event_id
    assert executed[0][1][1] == LEASE_SECONDS


def test_exact_event_run_skips_global_reconciliation_and_claims_only_that_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    event_id = UUID("00000000-0000-0000-0000-000000000032")
    from app.media_sync import MediaSyncWorker

    worker = MediaSyncWorker(dsn="unused", encoder=object(), storage_base_url=None, catalog_root=Path("."))
    worker._ready = True
    claimed_ids: list[UUID] = []

    def fail_reconcile(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("exact event mode must skip global reconciliation")

    def claim(requested_event_id: UUID) -> None:
        claimed_ids.append(requested_event_id)
        return None

    monkeypatch.setattr(worker, "reconcile_if_due", fail_reconcile)
    monkeypatch.setattr(worker, "claim", claim)
    assert worker.run_once(event_id=event_id) is False
    assert claimed_ids == [event_id]


def test_event_id_cli_requires_valid_uuid_and_one_shot_mode() -> None:
    import argparse

    from app.media_sync import _parse_event_id, main

    with pytest.raises(argparse.ArgumentTypeError, match="event ID must be a UUID"):
        _parse_event_id("not-a-uuid")
    with pytest.raises(SystemExit):
        main(["--event-id", "00000000-0000-0000-0000-000000000033"])


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
    assert 'ON CONFLICT ("idempotencyKey") DO UPDATE' in migration
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


def test_worker_startup_persists_ready_only_after_role_model_and_storage_checks() -> None:
    from app.media_sync import (
        _ACTIVE_SQL,
        _HAS_HOSTED_MEDIA_SQL,
        _HEARTBEAT_UPSERT_SQL,
        _PURGE_OLD_HEARTBEATS_SQL,
        _READINESS_SQL,
        MediaSyncWorker,
    )

    executed: list[tuple[str, tuple[object, ...] | None]] = []

    class Cursor:
        def __init__(self, row: tuple[object, ...] | None = None) -> None:
            self.row = row

        def fetchone(self) -> tuple[object, ...] | None:
            return self.row

    class Connection:
        def __enter__(self) -> Connection:
            return self

        def __exit__(self, *_: object) -> None:
            return None

        def transaction(self) -> Connection:
            return self

        def execute(self, query: str, params: tuple[object, ...] | None = None) -> Cursor:
            executed.append((query, params))
            if query == _READINESS_SQL:
                return Cursor((True,) * 30)
            if query == _ACTIVE_SQL:
                return Cursor(
                    (
                        DESCRIPTOR.embedding_version,
                        DESCRIPTOR.model_version,
                        DESCRIPTOR.preprocess_version,
                        DESCRIPTOR.embedding_dimension,
                        DESCRIPTOR.artifact_format,
                        DESCRIPTOR.artifact_sha256,
                        "ACTIVE",
                    )
                )
            if query == _HAS_HOSTED_MEDIA_SQL:
                return Cursor((True,))
            return Cursor()

    worker = MediaSyncWorker(
        dsn="unused",
        encoder=type("Encoder", (), {"descriptor": DESCRIPTOR, "close": lambda _self: None})(),
        storage_base_url="https://pzxekjybdiulzmssalfo.supabase.co",
        catalog_root=Path("."),
        environment="development",
        heartbeat_interval_seconds=30,
        connect=lambda *_args, **_kwargs: Connection(),
    )
    worker.startup()
    assert worker._snapshot()[0] == "READY"
    assert worker._snapshot()[1] == DESCRIPTOR.embedding_version
    assert sum(query == _HEARTBEAT_UPSERT_SQL for query, _ in executed) >= 2
    assert (_READINESS_SQL, None) in executed
    assert (_PURGE_OLD_HEARTBEATS_SQL, (7,)) in executed
    worker.shutdown()
    assert worker._snapshot()[0] == "STOPPED"


def test_worker_startup_fails_closed_when_role_privileges_are_missing() -> None:
    from app.media_sync import _HEARTBEAT_UPSERT_SQL, _READINESS_SQL, MediaSyncWorker

    heartbeat_states: list[str] = []

    class Cursor:
        def __init__(self, row: tuple[object, ...] | None = None) -> None:
            self.row = row

        def fetchone(self) -> tuple[object, ...] | None:
            return self.row

    class Connection:
        def __enter__(self) -> Connection:
            return self

        def __exit__(self, *_: object) -> None:
            return None

        def transaction(self) -> Connection:
            return self

        def execute(self, query: str, params: tuple[object, ...] | None = None) -> Cursor:
            if query == _HEARTBEAT_UPSERT_SQL and params:
                heartbeat_states.append(str(params[2]))
            return Cursor((True,) + (False,) * 29 if query == _READINESS_SQL else None)

    worker = MediaSyncWorker(
        dsn="unused",
        encoder=type("Encoder", (), {"descriptor": DESCRIPTOR})(),
        storage_base_url=None,
        catalog_root=Path("."),
        connect=lambda *_args, **_kwargs: Connection(),
    )
    with pytest.raises(Exception, match="lacks required privileges"):
        worker.startup()
    assert worker._snapshot()[0] == "FAILED"
    assert heartbeat_states == ["STARTING", "FAILED"]
    with pytest.raises(Exception, match="not ready"):
        worker.claim()


def test_idle_and_processing_heartbeats_are_independent_of_event_claims() -> None:
    import threading

    from app.media_sync import _HEARTBEAT_UPSERT_SQL, MediaSyncWorker

    rows: list[tuple[object, ...]] = []
    enough_heartbeats = threading.Event()

    class Connection:
        def __enter__(self) -> Connection:
            return self

        def __exit__(self, *_: object) -> None:
            return None

        def transaction(self) -> Connection:
            return self

        def execute(self, query: str, params: tuple[object, ...]) -> None:
            if query == _HEARTBEAT_UPSERT_SQL:
                rows.append(params)
                if len(rows) >= 3:
                    enough_heartbeats.set()

    worker = MediaSyncWorker(
        dsn="unused",
        encoder=object(),
        storage_base_url=None,
        catalog_root=Path("."),
        heartbeat_interval_seconds=0.01,
        connect=lambda *_args, **_kwargs: Connection(),
    )
    worker._set_state("READY")
    heartbeat = threading.Thread(target=worker._heartbeat_loop)
    heartbeat.start()
    assert enough_heartbeats.wait(1)
    worker._heartbeat_stop.set()
    heartbeat.join(timeout=1)
    assert not heartbeat.is_alive()

    event_id = UUID("00000000-0000-0000-0000-000000000005")
    worker._set_state("PROCESSING", current_event_id=event_id)
    worker._write_heartbeat()
    assert rows[-1][2] == "PROCESSING"
    assert rows[-1][4] == event_id


@pytest.mark.parametrize("signum", [2, 15])
def test_sigint_and_sigterm_request_graceful_shutdown(signum: int) -> None:
    import threading
    from typing import cast

    from app.media_sync import MediaSyncWorker, _handle_worker_signal

    called: list[bool] = []

    class FakeWorker:
        def request_shutdown(self) -> None:
            called.append(True)

    stop_event = threading.Event()
    _handle_worker_signal(signum, stop_event, cast(MediaSyncWorker, FakeWorker()))
    assert stop_event.is_set()
    assert called == [True]


def test_signal_during_active_job_finishes_current_event_and_stops_next_claim(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.media_sync import MediaEvent, MediaSyncWorker

    worker = MediaSyncWorker(dsn="unused", encoder=object(), storage_base_url=None, catalog_root=Path("."))
    worker._ready = True
    event = MediaEvent(
        event_id=UUID("00000000-0000-0000-0000-000000000011"),
        product_id=UUID("00000000-0000-0000-0000-000000000012"),
        image_id=UUID("00000000-0000-0000-0000-000000000013"),
        operation="ADDED",
        source_revision=None,
        source_sha256=None,
        attempt_count=1,
        lease_token=UUID("00000000-0000-0000-0000-000000000014"),
    )
    claim_calls = 0

    def claim() -> MediaEvent:
        nonlocal claim_calls
        claim_calls += 1
        return event

    def process(_event: MediaEvent) -> bool:
        worker.request_shutdown()
        return True

    monkeypatch.setattr(worker, "reconcile_if_due", lambda: 0)
    monkeypatch.setattr(worker, "claim", claim)
    monkeypatch.setattr(worker, "process", process)
    monkeypatch.setattr(worker, "_write_heartbeat", lambda: None)
    assert worker.run_once()
    assert worker._snapshot()[0] == "STOPPING"
    assert worker._snapshot()[2] is None
    assert worker.run_once() is False
    assert claim_calls == 1


def test_signal_after_claim_releases_lease_before_processing(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.media_sync import _RELEASE_CLAIM_SQL, MediaEvent, MediaSyncWorker

    released: list[tuple[str, tuple[object, ...]]] = []

    class Connection:
        def __enter__(self) -> Connection:
            return self

        def __exit__(self, *_: object) -> None:
            return None

        def transaction(self) -> Connection:
            return self

        def execute(self, query: str, params: tuple[object, ...]) -> None:
            released.append((query, params))

    worker = MediaSyncWorker(
        dsn="unused",
        encoder=object(),
        storage_base_url=None,
        catalog_root=Path("."),
        connect=lambda *_args, **_kwargs: Connection(),
    )
    worker._ready = True
    event = MediaEvent(
        event_id=UUID("00000000-0000-0000-0000-000000000021"),
        product_id=UUID("00000000-0000-0000-0000-000000000022"),
        image_id=UUID("00000000-0000-0000-0000-000000000023"),
        operation="ADDED",
        source_revision=None,
        source_sha256=None,
        attempt_count=1,
        lease_token=UUID("00000000-0000-0000-0000-000000000024"),
    )
    processed: list[MediaEvent] = []

    def claim() -> MediaEvent:
        worker.request_shutdown()
        return event

    monkeypatch.setattr(worker, "reconcile_if_due", lambda: 0)
    monkeypatch.setattr(worker, "claim", claim)
    monkeypatch.setattr(worker, "process", lambda claimed: processed.append(claimed))
    monkeypatch.setattr(worker, "_write_heartbeat", lambda: None)

    assert worker.run_once() is False
    assert released == [(_RELEASE_CLAIM_SQL, (event.event_id, event.lease_token))]
    assert processed == []
    assert worker._snapshot()[0] == "STOPPING"


def test_worker_health_migration_is_private_and_retention_is_bounded() -> None:
    migration = (
        Path(__file__).resolve().parents[2]
        / "backend"
        / "prisma"
        / "migrations"
        / "20261028020000_product_media_worker_health"
        / "migration.sql"
    ).read_text(encoding="utf-8")
    from app.media_sync import _PURGE_OLD_HEARTBEATS_SQL, _RELEASE_CLAIM_SQL, HEARTBEAT_RETENTION_DAYS

    assert "CREATE TABLE ai.media_worker_heartbeats" in migration
    assert "ENABLE ROW LEVEL SECURITY" in migration
    assert "REVOKE ALL ON ai.media_worker_heartbeats FROM PUBLIC" in migration
    assert "TO ai_media_worker" in migration
    assert "heartbeat_at < clock_timestamp() - (%s * interval '1 day')" in _PURGE_OLD_HEARTBEATS_SQL
    assert HEARTBEAT_RETENTION_DAYS == 7
    assert "state = 'RETRY_WAIT'" in _RELEASE_CLAIM_SQL
    assert '"leaseToken" = NULL' in _RELEASE_CLAIM_SQL
