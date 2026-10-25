"""Artifact loading contract for the EfficientNet encoder. Artifacts are built in tmp_path from a randomly initialised
network: random weights are acceptable in tests and never reach production code."""

from __future__ import annotations

import hashlib
import json
import math
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
import torch
from safetensors.torch import save_file

import app.models.efficientnet_loader as loader_module
from app.models.efficientnet_loader import (
    ArtifactRejectedError,
    EfficientNetArtifactLoader,
    load_efficientnet_encoder,
)
from app.models.embedding_network import PREPROCESS_VERSION, EmbeddingNetwork
from app.processors.image import decode_image
from tests.imagefactory import png_bytes

StateMutator = Callable[[dict[str, torch.Tensor]], dict[str, torch.Tensor]]


def _descriptor(sha256: str, **overrides: Any) -> dict[str, Any]:
    values: dict[str, Any] = {
        "name": "effb0-test",
        "modelVersion": "effb0-test-1",
        "embeddingVersion": "emb-test-1",
        "preprocessVersion": PREPROCESS_VERSION,
        "embeddingDimension": 256,
        "artifactFormat": "safetensors",
        "artifactSha256": sha256,
    }
    values.update(overrides)
    return values


def build_artifact(
    directory: Path,
    *,
    mutate_state: StateMutator | None = None,
    descriptor_overrides: dict[str, Any] | None = None,
) -> Path:
    torch.manual_seed(7)
    state = {key: value.contiguous() for key, value in EmbeddingNetwork().state_dict().items()}
    if mutate_state is not None:
        state = mutate_state(state)
    weights = directory / "model.safetensors"
    save_file(state, str(weights))
    digest = hashlib.sha256(weights.read_bytes()).hexdigest()
    descriptor = _descriptor(digest, **(descriptor_overrides or {}))
    (directory / "descriptor.json").write_text(json.dumps(descriptor), encoding="utf-8")
    return directory


@pytest.fixture(scope="module")
def artifact_dir(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return build_artifact(tmp_path_factory.mktemp("effb0"))


def _vector_norm(vector: list[float]) -> float:
    return math.sqrt(sum(value * value for value in vector))


def test_loads_strictly_and_encodes_a_unit_vector_of_the_declared_dimension(artifact_dir: Path) -> None:
    encoder = load_efficientnet_encoder(artifact_dir, torch_threads=1)
    assert encoder.descriptor.embedding_version == "emb-test-1"
    image = decode_image(png_bytes(300, 200))
    vector = encoder.encode(image)
    assert len(vector) == 256
    assert all(math.isfinite(value) for value in vector)
    assert abs(_vector_norm(vector) - 1.0) < 1e-3
    encoder.close()


def test_encoding_is_deterministic_in_eval_mode(artifact_dir: Path) -> None:
    encoder = load_efficientnet_encoder(artifact_dir, torch_threads=1)
    image = decode_image(png_bytes(256, 256))
    assert encoder.encode(image) == encoder.encode(image)
    encoder.close()


def test_loader_is_a_zero_argument_callable_for_the_registry(artifact_dir: Path) -> None:
    encoder = EfficientNetArtifactLoader(artifact_dir=artifact_dir, torch_threads=1)()
    assert encoder.descriptor.model_version == "effb0-test-1"
    encoder.close()


def test_digest_mismatch_is_refused_before_any_deserialisation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    directory = build_artifact(tmp_path)
    (directory / "descriptor.json").write_text(json.dumps(_descriptor("0" * 64)), encoding="utf-8")

    def must_not_load(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("weights were deserialised before the digest check")

    monkeypatch.setattr(loader_module, "load_file", must_not_load)
    with pytest.raises(ArtifactRejectedError, match="does not match"):
        load_efficientnet_encoder(directory, torch_threads=1)


def test_tampered_weights_are_refused(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    directory = build_artifact(tmp_path)
    weights = directory / "model.safetensors"
    tampered = bytearray(weights.read_bytes())
    tampered[-1] ^= 0x01
    weights.write_bytes(bytes(tampered))
    monkeypatch.setattr(loader_module, "load_file", lambda *a, **k: pytest.fail("loaded tampered weights"))
    with pytest.raises(ArtifactRejectedError):
        load_efficientnet_encoder(directory, torch_threads=1)


def test_missing_projection_tensor_fails_the_strict_load(tmp_path: Path) -> None:
    def drop_bias(state: dict[str, torch.Tensor]) -> dict[str, torch.Tensor]:
        state.pop("projection.bias")
        return state

    directory = build_artifact(tmp_path, mutate_state=drop_bias)
    with pytest.raises(RuntimeError, match=r"projection.bias"):
        load_efficientnet_encoder(directory, torch_threads=1)


def test_unexpected_extra_tensor_fails_the_strict_load(tmp_path: Path) -> None:
    def add_extra(state: dict[str, torch.Tensor]) -> dict[str, torch.Tensor]:
        state["head.extra"] = torch.zeros(1)
        return state

    directory = build_artifact(tmp_path, mutate_state=add_extra)
    with pytest.raises(RuntimeError):
        load_efficientnet_encoder(directory, torch_threads=1)


@pytest.mark.parametrize(
    "overrides",
    [
        {"preprocessVersion": "effb0-rgb-r256-c224-imagenet-v0"},
        {"embeddingDimension": 128},
        {"artifactFormat": "onnx"},
        {"artifactFormat": "pickle"},
        {"modelVersion": "../../etc"},
    ],
)
def test_descriptor_mismatches_are_refused(tmp_path: Path, overrides: dict[str, Any]) -> None:
    directory = build_artifact(tmp_path, descriptor_overrides=overrides)
    with pytest.raises(ArtifactRejectedError):
        load_efficientnet_encoder(directory, torch_threads=1)


def test_descriptor_with_unknown_keys_is_refused(tmp_path: Path) -> None:
    directory = build_artifact(tmp_path)
    payload = json.loads((directory / "descriptor.json").read_text(encoding="utf-8"))
    payload["checkpointPath"] = "elsewhere.pt"
    (directory / "descriptor.json").write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(ArtifactRejectedError, match="exactly the documented keys"):
        load_efficientnet_encoder(directory, torch_threads=1)


def test_missing_artifact_files_are_refused(tmp_path: Path) -> None:
    with pytest.raises(ArtifactRejectedError):
        load_efficientnet_encoder(tmp_path, torch_threads=1)
