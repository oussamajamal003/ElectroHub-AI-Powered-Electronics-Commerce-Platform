"""Local contract tests for the production AI release trust gate; uses temporary metadata only."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).parents[2]
SPEC = importlib.util.spec_from_file_location(
    "verify_model_artifact", ROOT / "apps/ai-service/verify-model-artifact.py"
)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
verify_production_release_metadata = MODULE.verify_production_release_metadata
RELEASE_BUNDLE_SPEC = importlib.util.spec_from_file_location(
    "verify_release_bundle", Path(__file__).with_name("verify-release-bundle.py")
)
assert RELEASE_BUNDLE_SPEC and RELEASE_BUNDLE_SPEC.loader
RELEASE_BUNDLE_MODULE = importlib.util.module_from_spec(RELEASE_BUNDLE_SPEC)
RELEASE_BUNDLE_SPEC.loader.exec_module(RELEASE_BUNDLE_MODULE)


def write_metadata(root: Path, artifact_status: str = "APPROVED_PRODUCTION_RELEASE") -> tuple[Path, Path, str]:
    artifact_manifest = {
        "status": artifact_status,
        "model": {
            "modelVersion": "model-v1",
            "embeddingVersion": "embedding-v1",
            "preprocessVersion": "preprocess-v1",
            "embeddingDimension": 256,
            "modelIndexCompatibilityIdentifier": "embedding-v1",
            "relevanceArtifact": {"relevanceVersion": "relevance-v1"},
        },
    }
    artifact_path = root / "AI_MODEL_ARTIFACT_PRODUCTION.json"
    artifact_bytes = json.dumps(artifact_manifest, separators=(",", ":")).encode()
    artifact_path.write_bytes(artifact_bytes)
    release = {
        "schemaVersion": 1,
        "status": "APPROVED_PRODUCTION_RELEASE",
        "releaseId": "siglip2-production-r1",
        "artifactManifest": {
            "file": "AI_MODEL_ARTIFACT_PRODUCTION.json",
            "sha256": hashlib.sha256(artifact_bytes).hexdigest(),
        },
        "modelIdentity": {
            "modelVersion": "model-v1",
            "embeddingVersion": "embedding-v1",
            "preprocessVersion": "preprocess-v1",
            "embeddingDimension": 256,
            "relevanceVersion": "relevance-v1",
            "compatibilityIdentifier": "embedding-v1",
        },
        "approvalReferences": {
            "quality": "model-review-2026-11-19",
            "source": "artifact-source-2026-11-19",
            "rights": "rights-review-2026-11-19",
        },
    }
    release_path = root / "AI_PRODUCTION_RELEASE.json"
    release_bytes = json.dumps(release, separators=(",", ":")).encode()
    release_path.write_bytes(release_bytes)
    return release_path, artifact_path, hashlib.sha256(release_bytes).hexdigest()


class ProductionAIReleaseTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_accepts_only_exact_host_pinned_production_release_identity(self) -> None:
        release, artifact, digest = write_metadata(self.root)
        checked = verify_production_release_metadata(release, artifact, digest)
        self.assertEqual(checked["status"], "APPROVED_PRODUCTION_RELEASE")
        for pin in ("", "REPLACE_WITH_APPROVED_RELEASE_SHA256"):
            with self.subTest(pin="[redacted]"), self.assertRaisesRegex(ValueError, "pin is missing or invalid"):
                verify_production_release_metadata(release, artifact, pin)
        with self.assertRaisesRegex(ValueError, "host-pinned approval identity"):
            verify_production_release_metadata(release, artifact, "0" * 64)

    def test_local_candidate_is_rejected_and_pointer_marker_remains_unchanged(self) -> None:
        release, artifact, digest = write_metadata(self.root, "LOCAL_ARTIFACT_CANDIDATE_NOT_PRODUCTION_RELEASE")
        pointer = self.root / "current-pointer.txt"
        pointer.write_text("previous-approved-release\n", encoding="utf-8")
        before = pointer.read_bytes()

        with self.assertRaisesRegex(ValueError, "local-only AI artifact candidate"):
            verify_production_release_metadata(release, artifact, digest)
        self.assertEqual(pointer.read_bytes(), before)

    def test_missing_release_metadata_fails_closed(self) -> None:
        _, artifact, _ = write_metadata(self.root)
        with self.assertRaises(FileNotFoundError):
            verify_production_release_metadata(self.root / "missing-release.json", artifact, "a" * 64)

    def test_invalid_release_identity_manifest_digest_and_approval_fail_closed(self) -> None:
        release, artifact, digest = write_metadata(self.root)
        manifest_bytes = artifact.read_bytes() + b" "
        artifact.write_bytes(manifest_bytes)
        with self.assertRaisesRegex(ValueError, "artifact manifest does not match"):
            verify_production_release_metadata(release, artifact, digest)

        release, artifact, _ = write_metadata(self.root)
        metadata = json.loads(release.read_text(encoding="utf-8"))
        metadata["modelIdentity"]["embeddingVersion"] = "mismatched-version"
        release.write_text(json.dumps(metadata, separators=(",", ":")), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "does not match the artifact manifest"):
            verify_production_release_metadata(release, artifact, hashlib.sha256(release.read_bytes()).hexdigest())

        release, artifact, _ = write_metadata(self.root)
        metadata = json.loads(release.read_text(encoding="utf-8"))
        metadata["approvalReferences"]["rights"] = "REPLACE_WITH_APPROVAL"
        release.write_text(json.dumps(metadata, separators=(",", ":")), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "rights approval"):
            verify_production_release_metadata(release, artifact, hashlib.sha256(release.read_bytes()).hexdigest())

    def test_malformed_or_tampered_release_metadata_is_rejected(self) -> None:
        release, artifact, _ = write_metadata(self.root)
        release.write_text("{malformed", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "malformed"):
            verify_production_release_metadata(release, artifact, hashlib.sha256(release.read_bytes()).hexdigest())

    def test_bundle_file_gate_can_run_before_docker_images_are_loaded(self) -> None:
        files = {
            "source.tar.gz": b"source archive fixture",
            "images.tar": b"image archive fixture",
            "AI_PRODUCTION_RELEASE.json": b"production release metadata fixture",
            "AI_MODEL_ARTIFACT_PRODUCTION.json": b"production artifact manifest fixture",
        }
        for name, contents in files.items():
            (self.root / name).write_bytes(contents)
        sha = "0123456789abcdef0123456789abcdef01234567"
        records = {
            "sourceArchive": "source.tar.gz",
            "imageArchive": "images.tar",
            "aiProductionRelease": "AI_PRODUCTION_RELEASE.json",
            "aiModelManifest": "AI_MODEL_ARTIFACT_PRODUCTION.json",
        }
        manifest = {
            "schemaVersion": 1,
            "releaseSha": sha,
            "images": [
                {"name": name, "reference": f"electrohub/{name}:{sha}", "configDigest": f"sha256:{'a' * 64}"}
                for name in ("backend", "ai-service", "edge")
            ],
        }
        for field, filename in records.items():
            manifest[field] = {
                "file": filename,
                "sha256": hashlib.sha256(files[filename]).hexdigest(),
            }
        manifest_path = self.root / "release-manifest.json"
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

        RELEASE_BUNDLE_MODULE.verify(manifest_path, sha, self.root, verify_loaded_images=False)


if __name__ == "__main__":
    unittest.main()
