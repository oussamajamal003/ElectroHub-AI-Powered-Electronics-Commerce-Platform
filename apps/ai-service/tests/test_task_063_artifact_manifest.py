from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
from typing import Any

import pytest

_spec = importlib.util.spec_from_file_location(
    "verify_model_artifact", Path(__file__).parents[1] / "verify-model-artifact.py"
)
assert _spec and _spec.loader
_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_module)
verify_directory = _module.verify_directory
verify = _module.verify


def test_artifact_verifier_checks_size_and_sha256(tmp_path: Path) -> None:
    artifact = tmp_path / "weights.safetensors"
    artifact.write_bytes(b"local fixture bytes")
    entry = {
        "path": artifact.name,
        "sizeBytes": artifact.stat().st_size,
        "sha256": hashlib.sha256(artifact.read_bytes()).hexdigest(),
    }

    verify_directory(tmp_path, [entry], artifact.stat().st_size)

    artifact.write_bytes(b"changed bytes")
    with pytest.raises(ValueError, match="artifact mismatch"):
        verify_directory(tmp_path, [entry], entry["sizeBytes"])


def test_artifact_verifier_rejects_path_escape(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="escapes"):
        verify_directory(tmp_path, [{"path": "../outside.safetensors", "sizeBytes": 0, "sha256": "0" * 64}], 0)


def test_manifest_verifier_binds_loader_source_artifact_directories_and_model_index_identity(tmp_path: Path) -> None:
    source_root = tmp_path / "source"
    loader_source = source_root / "apps/ai-service/app/models/siglip_loader.py"
    loader_source.parent.mkdir(parents=True)
    loader_source.write_bytes(b"loader bytes")
    manifest_path = tmp_path / "candidate.json"
    manifest: dict[str, Any] = {
        "status": "LOCAL_ARTIFACT_CANDIDATE_NOT_PRODUCTION_RELEASE",
        "loader": {
            "sourcePath": "apps/ai-service/app/models/siglip_loader.py",
            "sourceSha256": hashlib.sha256(loader_source.read_bytes()).hexdigest(),
        },
        "model": {
            "artifactDirectory": "apps/ai-service/models/model",
            "modelIndexCompatibilityIdentifier": "embed-v1",
            "embeddingVersion": "embed-v1",
            "artifactFiles": [],
            "totalBytes": 0,
            "relevanceArtifact": {
                "artifactDirectory": "apps/ai-service/models/relevance",
                "files": [],
                "totalBytes": 0,
            },
        },
        "vectorIndex": {"modelIndexCompatibilityIdentifier": "embed-v1"},
    }
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    model_dir = source_root / "apps/ai-service/models/model"
    relevance_dir = source_root / "apps/ai-service/models/relevance"
    model_dir.mkdir(parents=True)
    relevance_dir.mkdir(parents=True)
    verify(manifest_path, model_dir, relevance_dir, source_root)

    wrong_relevance_dir = source_root / "apps/ai-service/models/relevance-d1"
    wrong_relevance_dir.mkdir()
    with pytest.raises(ValueError, match="relevance artifact directory does not match"):
        verify(manifest_path, model_dir, wrong_relevance_dir, source_root)

    manifest["model"]["artifactDirectory"] = "../outside"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    with pytest.raises(ValueError, match="must be relative to the release checkout"):
        verify(manifest_path, model_dir, relevance_dir, source_root)

    manifest["model"]["artifactDirectory"] = "apps/ai-service/models/model"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    loader_source.write_bytes(b"different loader bytes")
    with pytest.raises(ValueError, match="loader source"):
        verify(manifest_path, model_dir, relevance_dir, source_root)
