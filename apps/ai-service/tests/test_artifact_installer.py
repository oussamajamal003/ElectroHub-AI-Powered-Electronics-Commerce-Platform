from __future__ import annotations

import hashlib
import io
import tarfile
import urllib.error
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.artifact_installer import ArtifactInstallError, _download, _safe_extract, install_approved_artifacts
from app.main import create_app
from tests.conftest import make_settings


def _pin(data: bytes = b"fixture") -> str:
    return hashlib.sha256(data).hexdigest()


def _download_settings(tmp_path: Path, url: str | None = None) -> object:
    archive = b"fixture archive"
    return make_settings(
        AI_ARTIFACT_DOWNLOAD_URL=url
        or "https://yepfgjehdstlxbpespun.supabase.co/storage/v1/object/sign/ai-artifacts/releases/siglip2-b16-p256-d1-b3900dd9fad5.tar.gz?token=signed-fixture",
        AI_ARTIFACT_RELEASE_ID="siglip2-b16-p256-d1-b3900dd9fad5",
        AI_PRODUCTION_RELEASE_SHA256="a" * 64,
        AI_ARTIFACT_ARCHIVE_SHA256=_pin(archive),
        AI_ARTIFACT_CACHE_DIR=tmp_path / "cache",
    )


def test_valid_download_installs_atomically(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    archive = tmp_path / "source.tar.gz"
    archive.write_bytes(b"fixture archive")
    settings = _download_settings(tmp_path)

    monkeypatch.setattr(
        "app.artifact_installer._download", lambda url, dest, **kwargs: dest.write_bytes(archive.read_bytes())
    )

    def extract(_archive: Path, destination: Path, *, max_bytes: int) -> None:
        destination.mkdir()
        (destination / "apps/ai-service/models/model").mkdir(parents=True)
        (destination / "apps/ai-service/models/relevance").mkdir(parents=True)

    monkeypatch.setattr("app.artifact_installer._safe_extract", extract)
    monkeypatch.setattr(
        "app.artifact_installer._verify_extracted",
        lambda root, release_sha256: (root / "apps/ai-service/models/model", root / "apps/ai-service/models/relevance"),
    )
    monkeypatch.setattr(
        "app.artifact_installer._verify_cached",
        lambda active, release_sha: (
            active / "apps/ai-service/models/model",
            active / "apps/ai-service/models/relevance",
        ),
    )

    updated, model_dir, relevance_dir = install_approved_artifacts(settings)
    assert model_dir.is_dir()
    assert relevance_dir.is_dir()
    assert updated.AI_MODEL_ARTIFACT_DIR == model_dir
    assert updated.AI_RELEVANCE_ARTIFACT_DIR == relevance_dir


def test_checksum_mismatch_rejects_download(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    settings = _download_settings(tmp_path)
    monkeypatch.setattr("app.artifact_installer._download", lambda url, dest, **kwargs: dest.write_bytes(b"tampered"))

    with pytest.raises(ArtifactInstallError, match="checksum mismatch"):
        install_approved_artifacts(settings)


def test_download_url_must_identify_configured_release(tmp_path: Path) -> None:
    settings = _download_settings(
        tmp_path,
        "https://yepfgjehdstlxbpespun.supabase.co/storage/v1/object/sign/ai-artifacts/releases/other-release.tar.gz?token=signed-fixture",
    )
    with pytest.raises(ArtifactInstallError, match="does not identify"):
        install_approved_artifacts(settings)


def test_safe_extraction_rejects_path_traversal(tmp_path: Path) -> None:
    archive = tmp_path / "unsafe.tar.gz"
    with tarfile.open(archive, "w:gz") as bundle:
        data = b"evil"
        member = tarfile.TarInfo("../outside.txt")
        member.size = len(data)
        bundle.addfile(member, io.BytesIO(data))

    with pytest.raises(ArtifactInstallError, match="path traversal"):
        _safe_extract(archive, tmp_path / "extracted", max_bytes=1024 * 1024)


def test_installer_failure_keeps_liveness_but_not_readiness(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    settings = _download_settings(tmp_path)

    def unavailable(*args: object, **kwargs: object) -> tuple[object, Path, Path]:
        raise ArtifactInstallError("storage unavailable")

    monkeypatch.setattr("app.artifact_installer.install_approved_artifacts", unavailable)
    with TestClient(create_app(settings)) as client:
        assert client.get("/health").status_code == 200
        assert (
            client.get(
                "/internal/v1/ready",
                headers={
                    "X-ElectroHub-AI-Key": "t3st-AI-k3y_0123456789abcdefghijKLMNOP",
                    "X-ElectroHub-AI-Environment": "test",
                },
            ).status_code
            == 503
        )


def test_retry_exhaustion_is_bounded(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    def unavailable(*args: object, **kwargs: object) -> object:
        raise urllib.error.URLError("storage unavailable")

    monkeypatch.setattr("urllib.request.urlopen", unavailable)
    monkeypatch.setattr("app.artifact_installer.time.sleep", lambda _: None)

    with pytest.raises(ArtifactInstallError, match="bounded retries"):
        _download(
            "https://yepfgjehdstlxbpespun.supabase.co/storage/v1/object/sign/a/b?token=x",
            tmp_path / "archive",
            timeout=5,
            retries=2,
            max_bytes=1024,
        )
