"""Offline byte-for-byte and path-bound verification of a local model candidate."""

from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

LOCAL_CANDIDATE_STATUS = "LOCAL_ARTIFACT_CANDIDATE_NOT_PRODUCTION_RELEASE"
PRODUCTION_RELEASE_STATUS = "APPROVED_PRODUCTION_RELEASE"
PRODUCTION_RELEASE_MANIFEST = "AI_PRODUCTION_RELEASE.json"
PRODUCTION_ARTIFACT_MANIFEST = "AI_MODEL_ARTIFACT_PRODUCTION.json"


def verify_directory(root: Path, files: list[dict[str, object]], expected_total: int) -> None:
    base = root.resolve(strict=True)
    total = 0
    for item in files:
        relative = item.get("path")
        size = item.get("sizeBytes")
        expected = item.get("sha256")
        if not isinstance(relative, str) or not isinstance(size, int) or not isinstance(expected, str):
            raise ValueError("manifest file entry has an invalid shape")
        file = (base / relative).resolve()
        if not file.is_relative_to(base):
            raise ValueError("manifest file escapes its artifact directory or is not a file")
        if not file.is_file():
            raise ValueError("manifest artifact is not a file")
        actual_size = file.stat().st_size
        digest = hashlib.sha256(file.read_bytes()).hexdigest()
        if actual_size != size or digest != expected:
            raise ValueError(f"artifact mismatch: {relative}")
        total += actual_size
    if total != expected_total:
        raise ValueError("artifact directory total size does not match the manifest")


def verify_manifest_directory(source_base: Path, expected_path_value: object, supplied_path: Path, label: str) -> None:
    if not isinstance(expected_path_value, str):
        raise ValueError(f"manifest is missing the {label} artifact directory")
    relative = Path(expected_path_value)
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError(f"manifest {label} artifact directory must be relative to the release checkout")
    expected = (source_base / relative).resolve(strict=True)
    supplied = supplied_path.resolve(strict=True)
    if not expected.is_relative_to(source_base) or not supplied.is_relative_to(source_base):
        raise ValueError(f"{label} artifact directory escapes the release checkout")
    if not expected.is_dir() or supplied != expected:
        raise ValueError(f"{label} artifact directory does not match the candidate manifest")


def verify_production_release_metadata(
    release_path: Path,
    artifact_manifest_path: Path,
    trusted_release_sha256: str,
) -> dict[str, object]:
    if not re.fullmatch(r"[a-f0-9]{64}", trusted_release_sha256 or ""):
        raise ValueError("trusted production AI release manifest SHA-256 pin is missing or invalid")
    release_bytes = release_path.read_bytes()
    if hashlib.sha256(release_bytes).hexdigest() != trusted_release_sha256:
        raise ValueError("production AI release manifest does not match the host-pinned approval identity")
    try:
        release = json.loads(release_bytes.decode("utf-8"))
        manifest_bytes = artifact_manifest_path.read_bytes()
        manifest = json.loads(manifest_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("production AI release metadata is malformed") from error

    if (
        not isinstance(release, dict)
        or release.get("schemaVersion") != 1
        or release.get("status") != PRODUCTION_RELEASE_STATUS
    ):
        raise ValueError("production AI release identity is missing or not explicitly approved")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{2,127}", str(release.get("releaseId", ""))):
        raise ValueError("production AI release identity has an invalid releaseId")
    artifact = release.get("artifactManifest")
    if not isinstance(artifact, dict) or artifact.get("file") != PRODUCTION_ARTIFACT_MANIFEST:
        raise ValueError("production AI release must reference the separate production artifact manifest")
    if artifact.get("sha256") != hashlib.sha256(manifest_bytes).hexdigest():
        raise ValueError("production AI artifact manifest does not match its approved release identity")
    if not isinstance(manifest, dict):
        raise ValueError("production AI artifact manifest is malformed")
    if manifest.get("status") == LOCAL_CANDIDATE_STATUS:
        raise ValueError("local-only AI artifact candidate cannot be used in production")
    if manifest.get("status") != PRODUCTION_RELEASE_STATUS:
        raise ValueError("production AI artifact manifest is missing its distinct approved release identity")

    approvals = release.get("approvalReferences")
    if not isinstance(approvals, dict):
        raise ValueError("production AI release is missing required owner approval references")
    reference_pattern = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:/#-]{3,199}")
    placeholder_reference = re.compile(
        r"(?:replace|placeholder|example|sample|todo|pending|unapproved|draft)", re.IGNORECASE
    )
    for approval in ("quality", "source", "rights"):
        reference = approvals.get(approval)
        if (
            not isinstance(reference, str)
            or not reference_pattern.fullmatch(reference)
            or placeholder_reference.search(reference)
        ):
            raise ValueError(f"production AI release is missing a valid {approval} approval reference")

    model = manifest.get("model")
    relevance = model.get("relevanceArtifact") if isinstance(model, dict) else None
    identity = release.get("modelIdentity")
    if not isinstance(model, dict) or not isinstance(relevance, dict) or not isinstance(identity, dict):
        raise ValueError("production AI release model/relevance identity is incomplete")
    expected_identity = {
        "modelVersion": model.get("modelVersion"),
        "embeddingVersion": model.get("embeddingVersion"),
        "preprocessVersion": model.get("preprocessVersion"),
        "embeddingDimension": model.get("embeddingDimension"),
        "relevanceVersion": relevance.get("relevanceVersion"),
        "compatibilityIdentifier": model.get("modelIndexCompatibilityIdentifier"),
    }
    if not all(value is not None for value in expected_identity.values()) or identity != expected_identity:
        raise ValueError("production AI release identity does not match the artifact manifest model/relevance versions")
    return manifest


def verify(
    manifest_path: Path,
    model_dir: Path,
    relevance_dir: Path,
    source_root: Path,
    *,
    expected_status: str = LOCAL_CANDIDATE_STATUS,
) -> None:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("status") != expected_status:
        if manifest.get("status") == LOCAL_CANDIDATE_STATUS:
            raise ValueError("local-only AI artifact candidate cannot be used in production")
        raise ValueError("AI artifact manifest release identity is not explicitly approved")
    loader = manifest.get("loader")
    if (
        not isinstance(loader, dict)
        or not isinstance(loader.get("sourcePath"), str)
        or not isinstance(loader.get("sourceSha256"), str)
    ):
        raise ValueError("manifest is missing the exact loader source identity")
    source_base = source_root.resolve(strict=True)
    model = manifest.get("model")
    if not isinstance(model, dict):
        raise ValueError("manifest is missing the model candidate")
    relevance = model.get("relevanceArtifact")
    if not isinstance(relevance, dict):
        raise ValueError("manifest is missing the relevance artifact candidate")
    verify_manifest_directory(source_base, model.get("artifactDirectory"), model_dir, "model")
    verify_manifest_directory(source_base, relevance.get("artifactDirectory"), relevance_dir, "relevance")
    loader_source = (source_base / loader["sourcePath"]).resolve()
    if not loader_source.is_relative_to(source_base) or not loader_source.is_file():
        raise ValueError("loader source escapes the release checkout or is missing")
    loader_digest = hashlib.sha256(loader_source.read_bytes()).hexdigest()
    if loader_digest != loader["sourceSha256"]:
        raise ValueError("AI model loader source does not match the candidate manifest")
    if model.get("modelIndexCompatibilityIdentifier") != model.get("embeddingVersion"):
        raise ValueError("model/index compatibility identifier must equal the checked embedding version")
    vector_index = manifest.get("vectorIndex")
    if not isinstance(vector_index, dict) or vector_index.get("modelIndexCompatibilityIdentifier") != model.get(
        "modelIndexCompatibilityIdentifier"
    ):
        raise ValueError("vector index compatibility identity does not match the model candidate")
    verify_directory(model_dir, model["artifactFiles"], model["totalBytes"])
    verify_directory(relevance_dir, relevance["files"], relevance["totalBytes"])


if __name__ == "__main__":
    production = len(sys.argv) == 8 and sys.argv[1] == "--production"
    if production:
        _, _, release_path, manifest_path, trusted_release_sha256, model_dir, relevance_dir, source_root = sys.argv
    elif len(sys.argv) == 5:
        _, manifest_path, model_dir, relevance_dir, source_root = sys.argv
    else:
        usage = (
            "Usage: verify-model-artifact.py <local-candidate-manifest.json> <model-directory> "
            "<relevance-directory> <release-source-root>\n"
            "   or: verify-model-artifact.py --production <AI_PRODUCTION_RELEASE.json> "
            "<AI_MODEL_ARTIFACT_PRODUCTION.json> <trusted-manifest-sha256> <model-directory> "
            "<relevance-directory> <release-source-root>"
        )
        print(usage, file=sys.stderr)
        raise SystemExit(64)
    try:
        if production:
            verify_production_release_metadata(Path(release_path), Path(manifest_path), trusted_release_sha256)
            verify(
                Path(manifest_path),
                Path(model_dir),
                Path(relevance_dir),
                Path(source_root),
                expected_status=PRODUCTION_RELEASE_STATUS,
            )
        else:
            verify(Path(manifest_path), Path(model_dir), Path(relevance_dir), Path(source_root))
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
        print(f"Model artifact verification failed: {error}", file=sys.stderr)
        raise SystemExit(1) from None
    message = (
        "Approved production model and relevance artifact bytes match the host-pinned release identity."
        if production
        else "Local model and relevance artifact bytes match the candidate manifest."
    )
    print(message)
