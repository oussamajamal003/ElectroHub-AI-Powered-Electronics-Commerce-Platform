"""Integrity checks for the SigLIP artifact loader (Task 04.2-Q candidate D); synthetic files, no real weights."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest
import torch

from app.models.efficientnet_loader import ArtifactRejectedError
from app.models.siglip_loader import is_siglip_artifact, verified_weight_files
from app.models.siglip_network import PREPROCESS_VERSION, SiglipVision, preprocess


def _artifact(tmp_path: Path, files: dict[str, bytes] | None = None, manifest: dict[str, str] | None = None) -> str:
    files = files if files is not None else {"vision/model-00.safetensors": b"a", "projection.safetensors": b"b"}
    for name, data in files.items():
        (tmp_path / name).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / name).write_bytes(data)
    if manifest is None:
        manifest = {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}
    (tmp_path / "weights.json").write_text(json.dumps(manifest), encoding="utf-8")
    return hashlib.sha256((tmp_path / "weights.json").read_bytes()).hexdigest()


def test_listed_files_with_matching_digests_are_accepted(tmp_path: Path) -> None:
    digest = _artifact(tmp_path)
    assert set(verified_weight_files(tmp_path, digest)) == {"vision/model-00.safetensors", "projection.safetensors"}


def test_manifest_must_match_descriptor_digest(tmp_path: Path) -> None:
    _artifact(tmp_path)
    with pytest.raises(ArtifactRejectedError):
        verified_weight_files(tmp_path, "0" * 64)


def test_tampered_weight_file_is_refused(tmp_path: Path) -> None:
    digest = _artifact(tmp_path)
    (tmp_path / "vision/model-00.safetensors").write_bytes(b"tampered")
    with pytest.raises(ArtifactRejectedError):
        verified_weight_files(tmp_path, digest)


def test_unlisted_vision_shard_is_refused(tmp_path: Path) -> None:
    digest = _artifact(tmp_path)
    (tmp_path / "vision/model-01.safetensors").write_bytes(b"extra")
    with pytest.raises(ArtifactRejectedError):
        verified_weight_files(tmp_path, digest)


@pytest.mark.parametrize("name", ["../outside.safetensors", "vision/model.bin"])
def test_paths_outside_the_artifact_or_non_safetensors_are_refused(tmp_path: Path, name: str) -> None:
    digest = _artifact(tmp_path, manifest={name: "0" * 64, "projection.safetensors": "0" * 64})
    with pytest.raises(ArtifactRejectedError):
        verified_weight_files(tmp_path, digest)


def test_loader_is_chosen_by_preprocess_version(tmp_path: Path) -> None:
    (tmp_path / "descriptor.json").write_text(json.dumps({"preprocessVersion": PREPROCESS_VERSION}), encoding="utf-8")
    assert is_siglip_artifact(tmp_path)
    (tmp_path / "descriptor.json").write_text(json.dumps({"preprocessVersion": "effb0-x"}), encoding="utf-8")
    assert not is_siglip_artifact(tmp_path)
    assert not is_siglip_artifact(tmp_path / "missing")


def test_network_and_preprocess_shapes() -> None:
    from PIL import Image

    pixels = preprocess(Image.new("RGB", (640, 480), (255, 0, 0)))
    assert pixels.shape == (1, 3, 224, 224)
    assert torch.allclose(pixels[0, 0], torch.ones(224, 224)) and torch.allclose(pixels[0, 1], -torch.ones(224, 224))
    with torch.inference_mode():
        assert SiglipVision().eval()(pixels).shape == (1, 768)
