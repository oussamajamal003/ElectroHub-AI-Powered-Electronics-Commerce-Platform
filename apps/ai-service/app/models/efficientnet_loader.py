"""Loads the exported EfficientNet-B0 embedding network from a read-only artifact directory and encodes images.

The directory holds exactly two files: ``descriptor.json`` (camelCase identity, validated against the code's
preprocessing and dimension constants) and ``model.safetensors``. The weights are hashed in a streaming pass and
compared with the descriptor before anything is deserialised. Loading uses safetensors only: no pickle, no
``torch.load``, no downloads.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import math
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final

import torch
from PIL import Image
from safetensors.torch import load_file

from app.core.errors import InferenceOutputError
from app.models.descriptor import ModelDescriptor
from app.models.embedding_network import EMBEDDING_DIMENSION, PREPROCESS_VERSION, EmbeddingNetwork, preprocess_image
from app.processors.image import ValidatedImage

DESCRIPTOR_FILENAME: Final = "descriptor.json"
WEIGHTS_FILENAME: Final = "model.safetensors"
MAX_DESCRIPTOR_BYTES: Final = 16 * 1024
MAX_WEIGHTS_BYTES: Final = 256 * 1024 * 1024
_HASH_CHUNK_BYTES: Final = 1024 * 1024
_NORM_TOLERANCE: Final = 1e-3

_DESCRIPTOR_KEYS: Final = frozenset(
    {
        "name",
        "modelVersion",
        "embeddingVersion",
        "preprocessVersion",
        "embeddingDimension",
        "artifactFormat",
        "artifactSha256",
    }
)


class ArtifactRejectedError(RuntimeError):
    """The artifact is refused before it is used. Messages name the reason, never a value."""


def read_descriptor(path: Path) -> ModelDescriptor:
    """Parse and validate ``descriptor.json``: exact keys, the pinned preprocessing and the pinned dimension."""
    if not path.is_file() or path.stat().st_size > MAX_DESCRIPTOR_BYTES:
        raise ArtifactRejectedError("descriptor.json is missing or too large")
    try:
        raw: object = json.loads(path.read_bytes().decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ArtifactRejectedError("descriptor.json is not valid UTF-8 JSON") from exc
    if not isinstance(raw, dict) or set(raw) != _DESCRIPTOR_KEYS:
        raise ArtifactRejectedError("descriptor.json must contain exactly the documented keys")
    values: Mapping[str, Any] = raw

    if values["preprocessVersion"] != PREPROCESS_VERSION:
        raise ArtifactRejectedError("preprocessVersion does not match this service build")
    if values["embeddingDimension"] != EMBEDDING_DIMENSION:
        raise ArtifactRejectedError("embeddingDimension does not match this service build")
    if values["artifactFormat"] != "safetensors":
        raise ArtifactRejectedError("only safetensors artifacts are loaded")
    try:
        return ModelDescriptor(
            name=values["name"],
            model_version=values["modelVersion"],
            embedding_version=values["embeddingVersion"],
            preprocess_version=values["preprocessVersion"],
            embedding_dimension=values["embeddingDimension"],
            artifact_format=values["artifactFormat"],
            artifact_sha256=values["artifactSha256"],
        )
    except ValueError as exc:
        raise ArtifactRejectedError("descriptor.json has an invalid field") from exc


def verify_weights_digest(path: Path, expected_sha256: str) -> None:
    """Stream the weights through SHA-256 and refuse any mismatch before deserialisation."""
    if not path.is_file() or path.stat().st_size > MAX_WEIGHTS_BYTES:
        raise ArtifactRejectedError("model.safetensors is missing or too large")
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(_HASH_CHUNK_BYTES), b""):
            digest.update(chunk)
    if not hmac.compare_digest(digest.hexdigest(), expected_sha256):
        raise ArtifactRejectedError("model.safetensors does not match the descriptor digest")


def _preprocess(pixels: Image.Image) -> torch.Tensor:
    """The shared PREPROCESS_VERSION transform (identical to training evaluation), as a batch of one."""
    return preprocess_image(pixels).unsqueeze(0)


class EfficientNetEncoder:
    """An ``ImageEmbeddingEncoder`` backed by the verified EfficientNet-B0 projection network."""

    def __init__(self, descriptor: ModelDescriptor, network: EmbeddingNetwork) -> None:
        self._descriptor = descriptor
        self._network: EmbeddingNetwork | None = network

    @property
    def descriptor(self) -> ModelDescriptor:
        return self._descriptor

    def encode(self, image: ValidatedImage) -> list[float]:
        network = self._network
        if network is None:
            raise InferenceOutputError()
        batch = _preprocess(image.rgb)
        with torch.inference_mode():
            output = network(batch)
        vector = [float(value) for value in output[0].tolist()]
        norm = math.sqrt(sum(value * value for value in vector))
        if len(vector) != self._descriptor.embedding_dimension or not math.isfinite(norm):
            raise InferenceOutputError()
        if abs(norm - 1.0) > _NORM_TOLERANCE:
            raise InferenceOutputError()
        return vector

    def close(self) -> None:
        self._network = None


def load_efficientnet_encoder(artifact_dir: Path, *, torch_threads: int) -> EfficientNetEncoder:
    descriptor = read_descriptor(artifact_dir / DESCRIPTOR_FILENAME)
    weights = artifact_dir / WEIGHTS_FILENAME
    verify_weights_digest(weights, descriptor.artifact_sha256)  # before any deserialisation

    state = load_file(str(weights), device="cpu")
    network = EmbeddingNetwork(embedding_dimension=descriptor.embedding_dimension)
    network.load_state_dict(state, strict=True)
    network.eval()
    torch.set_num_threads(torch_threads)
    return EfficientNetEncoder(descriptor, network)


@dataclass(frozen=True, slots=True)
class EfficientNetArtifactLoader:
    """A ``ModelLoader``: a zero-argument callable run once at startup, off the event loop."""

    artifact_dir: Path
    torch_threads: int

    def __call__(self) -> EfficientNetEncoder:
        return load_efficientnet_encoder(self.artifact_dir, torch_threads=self.torch_threads)
