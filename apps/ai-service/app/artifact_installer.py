"""Fail-closed installer for versioned, approved AI artifact archives."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import re
import shutil
import tarfile
import time
import types
import urllib.error
import urllib.request
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlsplit

from app.core.config import Settings

_RELEASE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{2,127}")
_MARKER = "electrohub-artifact-install.json"


class ArtifactInstallError(RuntimeError):
    pass


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _load_repository_verifier() -> types.ModuleType:
    verifier_path = Path(__file__).resolve().parents[1] / "verify-model-artifact.py"
    spec = importlib.util.spec_from_file_location("electrohub_verify_model_artifact", verifier_path)
    if spec is None or spec.loader is None:
        raise ArtifactInstallError("repository production artifact verifier is missing")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _verify_extracted(root: Path, *, release_sha256: str) -> tuple[Path, Path]:
    release_path = root / "AI_PRODUCTION_RELEASE.json"
    artifact_path = root / "AI_MODEL_ARTIFACT_PRODUCTION.json"

    # The loader source and metadata are authoritative; no downloaded code is executed here.
    release = json.loads(release_path.read_bytes().decode("utf-8"))
    manifest = json.loads(artifact_path.read_bytes().decode("utf-8"))
    if release.get("releaseId") != _expected_release_id:
        raise ArtifactInstallError("downloaded release identity does not match configuration")

    module = _load_repository_verifier()

    module.verify_production_release_metadata(release_path, artifact_path, release_sha256)
    module.verify(
        artifact_path,
        root / manifest["model"]["artifactDirectory"],
        root / manifest["model"]["relevanceArtifact"]["artifactDirectory"],
        root,
        expected_status="APPROVED_PRODUCTION_RELEASE",
    )
    model_dir = root / manifest["model"]["artifactDirectory"]
    relevance_dir = root / manifest["model"]["relevanceArtifact"]["artifactDirectory"]
    return model_dir.resolve(), relevance_dir.resolve()


_expected_release_id = ""


def _download(url: str, destination: Path, *, timeout: int, retries: int, max_bytes: int) -> None:
    last_error: Exception | None = None
    for attempt in range(retries + 1):
        destination.unlink(missing_ok=True)
        try:
            request = urllib.request.Request(url, method="GET")  # noqa: S310 - URL is validated in settings
            with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 - HTTPS-only allowlist
                status = getattr(response, "status", 200)
                if status < 200 or status >= 300:
                    raise ArtifactInstallError("artifact storage returned a non-success HTTP status")
                downloaded = 0
                with destination.open("xb") as output:
                    while True:
                        chunk = response.read(1024 * 1024)
                        if not chunk:
                            break
                        downloaded += len(chunk)
                        if downloaded > max_bytes:
                            raise ArtifactInstallError("downloaded archive exceeds the configured size limit")
                        output.write(chunk)
            return
        except (urllib.error.URLError, TimeoutError, OSError, ArtifactInstallError) as error:
            last_error = error
            destination.unlink(missing_ok=True)
            if attempt < retries:
                time.sleep(2**attempt)
    if isinstance(last_error, ArtifactInstallError):
        raise last_error
    raise ArtifactInstallError("artifact storage download failed after bounded retries")


def _safe_extract(archive: Path, destination: Path, *, max_bytes: int) -> None:
    destination.mkdir(parents=True)
    seen: set[str] = set()
    extracted = 0
    try:
        with tarfile.open(archive, "r:gz") as bundle:
            for member in bundle:
                relative = PurePosixPath(member.name)
                if member.name.startswith("/") or ".." in relative.parts:
                    raise ArtifactInstallError("archive contains a path traversal entry")
                name = relative.as_posix()
                if not name or name in seen:
                    raise ArtifactInstallError("archive contains an invalid or duplicate entry")
                seen.add(name)
                target = (destination / Path(*relative.parts)).resolve()
                if not target.is_relative_to(destination.resolve()):
                    raise ArtifactInstallError("archive entry escapes the extraction directory")
                if member.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                if not member.isfile():
                    raise ArtifactInstallError("archive contains an unsafe non-file entry")
                extracted += member.size
                if extracted > max_bytes:
                    raise ArtifactInstallError("extracted archive exceeds the configured size limit")
                target.parent.mkdir(parents=True, exist_ok=True)
                source = bundle.extractfile(member)
                if source is None:
                    raise ArtifactInstallError("archive file could not be opened")
                with source, target.open("xb") as output:
                    shutil.copyfileobj(source, output, length=1024 * 1024)
    except (tarfile.TarError, EOFError, OSError) as error:
        raise ArtifactInstallError("artifact archive could not be safely extracted") from error


def install_approved_artifacts(settings: Settings) -> tuple[Settings, Path, Path]:
    """Download, verify and atomically install the configured release; never publish or fall back."""
    global _expected_release_id

    if settings.AI_ARTIFACT_DOWNLOAD_URL is None:
        if settings.AI_MODEL_ARTIFACT_DIR is None or settings.AI_RELEVANCE_ARTIFACT_DIR is None:
            raise ArtifactInstallError("artifact distribution or mounted artifact directories are not configured")
        return settings, settings.AI_MODEL_ARTIFACT_DIR, settings.AI_RELEVANCE_ARTIFACT_DIR

    release_id = settings.AI_ARTIFACT_RELEASE_ID
    download_url = settings.AI_ARTIFACT_DOWNLOAD_URL.get_secret_value()
    release_sha = settings.AI_PRODUCTION_RELEASE_SHA256
    archive_sha = settings.AI_ARTIFACT_ARCHIVE_SHA256
    if not release_id or not _RELEASE_ID.fullmatch(release_id):
        raise ArtifactInstallError("AI_ARTIFACT_RELEASE_ID is missing or invalid")
    if not release_sha or not re.fullmatch(r"[a-f0-9]{64}", release_sha):
        raise ArtifactInstallError("AI_PRODUCTION_RELEASE_SHA256 is missing or invalid")
    if not archive_sha or not re.fullmatch(r"[a-f0-9]{64}", archive_sha):
        raise ArtifactInstallError("AI_ARTIFACT_ARCHIVE_SHA256 is missing or invalid")
    _expected_release_id = release_id
    download_path = unquote(urlsplit(download_url).path).strip("/")
    path_segments = download_path.split("/")
    if not any(segment == release_id or segment.startswith(release_id + ".") for segment in path_segments):
        raise ArtifactInstallError("download URL does not identify the configured release")

    cache_root = settings.AI_ARTIFACT_CACHE_DIR.resolve()
    cache_root.mkdir(parents=True, exist_ok=True)
    active = cache_root / release_id
    marker = active / _MARKER

    if active.is_dir() and marker.is_file():
        try:
            data = json.loads(marker.read_text(encoding="utf-8"))
            if data == {"releaseId": release_id, "releaseSha256": release_sha, "archiveSha256": archive_sha}:
                model_dir, relevance_dir = _verify_cached(active, release_sha)
                return (
                    settings.model_copy(
                        update={"AI_MODEL_ARTIFACT_DIR": model_dir, "AI_RELEVANCE_ARTIFACT_DIR": relevance_dir}
                    ),
                    model_dir,
                    relevance_dir,
                )
        except (ArtifactInstallError, json.JSONDecodeError, OSError, KeyError, TypeError, ValueError):
            shutil.rmtree(active, ignore_errors=True)

    temp_root = cache_root / f".download-{os.getpid()}"
    temp_root.mkdir(parents=True, exist_ok=True)
    archive = temp_root / "release.tar.gz"
    try:
        _download(
            download_url,
            archive,
            timeout=settings.AI_ARTIFACT_DOWNLOAD_TIMEOUT_SECONDS,
            retries=settings.AI_ARTIFACT_DOWNLOAD_RETRIES,
            max_bytes=settings.AI_ARTIFACT_MAX_DOWNLOAD_BYTES,
        )
        if _sha256(archive) != archive_sha:
            raise ArtifactInstallError("downloaded archive checksum mismatch")

        extracted = temp_root / "extracted"
        _safe_extract(archive, extracted, max_bytes=settings.AI_ARTIFACT_MAX_EXTRACTED_BYTES)
        model_dir, relevance_dir = _verify_extracted(extracted, release_sha256=release_sha)

        staged = cache_root / f".install-{release_id}-{os.getpid()}"
        shutil.rmtree(staged, ignore_errors=True)
        shutil.copytree(extracted, staged, symlinks=False)
        staged_marker = staged / _MARKER
        staged_marker.write_text(
            json.dumps(
                {"releaseId": release_id, "releaseSha256": release_sha, "archiveSha256": archive_sha}, sort_keys=True
            ),
            encoding="utf-8",
        )

        backup = cache_root / f".old-{release_id}-{os.getpid()}"
        shutil.rmtree(backup, ignore_errors=True)
        if active.exists():
            os.replace(active, backup)
        try:
            os.replace(staged, active)
        except Exception:
            if backup.exists():
                os.replace(backup, active)
            raise
        shutil.rmtree(backup, ignore_errors=True)

        model_dir = active / model_dir.relative_to(extracted)
        relevance_dir = active / relevance_dir.relative_to(extracted)
        _verify_cached(active, release_sha)
        return (
            settings.model_copy(
                update={"AI_MODEL_ARTIFACT_DIR": model_dir, "AI_RELEVANCE_ARTIFACT_DIR": relevance_dir}
            ),
            model_dir,
            relevance_dir,
        )
    except ArtifactInstallError:
        raise
    except (OSError, json.JSONDecodeError, KeyError, TypeError, ValueError) as error:
        raise ArtifactInstallError("artifact installation failed safely") from error
    finally:
        shutil.rmtree(temp_root, ignore_errors=True)


def _verify_cached(active: Path, release_sha: str) -> tuple[Path, Path]:
    release_path = active / "AI_PRODUCTION_RELEASE.json"
    artifact_path = active / "AI_MODEL_ARTIFACT_PRODUCTION.json"
    if not release_path.is_file() or not artifact_path.is_file():
        raise ArtifactInstallError("cached release metadata or verifier is missing")
    manifest = json.loads(artifact_path.read_bytes().decode("utf-8"))
    module = _load_repository_verifier()
    module.verify_production_release_metadata(release_path, artifact_path, release_sha)
    model_dir = active / manifest["model"]["artifactDirectory"]
    relevance_dir = active / manifest["model"]["relevanceArtifact"]["artifactDirectory"]
    module.verify(artifact_path, model_dir, relevance_dir, active, expected_status="APPROVED_PRODUCTION_RELEASE")
    return model_dir.resolve(), relevance_dir.resolve()
