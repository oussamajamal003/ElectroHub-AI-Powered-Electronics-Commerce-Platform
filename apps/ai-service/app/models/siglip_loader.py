"""Loads candidate D: the pretrained SigLIP 2 vision tower plus a fixed 768 -> 256 projection (Task 04.2-Q).

Artifact directory: ``descriptor.json``, ``weights.json`` (relative path -> SHA-256 of every weight file),
``vision/model-*.safetensors`` and ``projection.safetensors`` (``mean`` 768, ``matrix`` 256 x 768). The descriptor's
``artifactSha256`` is the SHA-256 of ``weights.json``; every listed file is hashed before anything is deserialised,
and unlisted weight files are refused. Safetensors only: no pickle, no downloads, no remote code.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import math
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING, Final

import torch
from safetensors.torch import load_file

from app.core.errors import InferenceOutputError
from app.models.descriptor import ModelDescriptor
from app.models.efficientnet_loader import DESCRIPTOR_FILENAME, ArtifactRejectedError, read_descriptor
from app.models.siglip_network import HIDDEN, IMAGE_SIZE, PREPROCESS_VERSION, SiglipVision, preprocess
from app.processors.image import ValidatedImage

if TYPE_CHECKING:
    from app.models.efficientnet_loader import EfficientNetEncoder
    from app.models.relevance import Assessment, RelevanceGate

MANIFEST_FILENAME: Final = "weights.json"
PROJECTION_FILENAME: Final = "projection.safetensors"
EMBEDDING_DIMENSION: Final = 256
MAX_MANIFEST_BYTES: Final = 16 * 1024
MAX_TOTAL_WEIGHT_BYTES: Final = 512 * 1024 * 1024
_NORM_TOLERANCE: Final = 1e-3


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verified_weight_files(artifact_dir: Path, expected_sha256: str) -> dict[str, Path]:
    """Check ``weights.json`` against the descriptor, then every listed file against ``weights.json``."""
    manifest_path = artifact_dir / MANIFEST_FILENAME
    if not manifest_path.is_file() or manifest_path.stat().st_size > MAX_MANIFEST_BYTES:
        raise ArtifactRejectedError("weights.json is missing or too large")
    if not hmac.compare_digest(_sha256(manifest_path), expected_sha256):
        raise ArtifactRejectedError("weights.json does not match the descriptor digest")
    try:
        manifest: object = json.loads(manifest_path.read_bytes().decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ArtifactRejectedError("weights.json is not valid UTF-8 JSON") from exc
    if not isinstance(manifest, dict) or PROJECTION_FILENAME not in manifest:
        raise ArtifactRejectedError("weights.json must list the projection and the vision shards")
    files: dict[str, Path] = {}
    total = 0
    root = artifact_dir.resolve()
    for name, digest in manifest.items():
        relative = PurePosixPath(str(name))
        if relative.is_absolute() or ".." in relative.parts or relative.suffix != ".safetensors":
            raise ArtifactRejectedError("weights.json lists an invalid path")
        path = (artifact_dir / Path(*relative.parts)).resolve()
        if not path.is_relative_to(root) or not path.is_file():
            raise ArtifactRejectedError("a listed weight file is missing")
        total += path.stat().st_size
        if total > MAX_TOTAL_WEIGHT_BYTES:
            raise ArtifactRejectedError("weight files are too large")
        if not isinstance(digest, str) or not hmac.compare_digest(_sha256(path), digest):
            raise ArtifactRejectedError("a weight file does not match weights.json")
        files[relative.as_posix()] = path
    listed = {p.resolve() for p in files.values()}
    if any(p.resolve() not in listed for p in (artifact_dir / "vision").glob("*.safetensors")):
        raise ArtifactRejectedError("unlisted weight files are present")
    return files


class SiglipEncoder:
    """An ``ImageEmbeddingEncoder``: SigLIP 2 image embedding, projected to 256 dimensions and L2-normalised."""

    def __init__(
        self,
        descriptor: ModelDescriptor,
        network: SiglipVision,
        mean: torch.Tensor,
        matrix: torch.Tensor,
        relevance: RelevanceGate | None = None,
    ) -> None:
        self._descriptor = descriptor
        self._network: SiglipVision | None = network
        self._mean = mean
        self._matrix = matrix
        self._relevance = relevance

    @property
    def descriptor(self) -> ModelDescriptor:
        return self._descriptor

    @property
    def relevance(self) -> RelevanceGate | None:
        return self._relevance

    def encode(self, image: ValidatedImage) -> list[float]:
        return self.encode_assessed(image)[0]

    def encode_assessed(self, image: ValidatedImage) -> tuple[list[float], Assessment | None]:
        network = self._network
        if network is None:
            raise InferenceOutputError()
        with torch.inference_mode():
            pooled = torch.nn.functional.normalize(network(preprocess(image.rgb)), dim=1)
            features = torch.nn.functional.normalize((pooled - self._mean) @ self._matrix.T, dim=1)
            assessment = self._relevance.assess(features, pooled) if self._relevance is not None else None
        vector = [float(value) for value in features[0].tolist()]
        norm = math.sqrt(sum(value * value for value in vector))
        if len(vector) != self._descriptor.embedding_dimension or not math.isfinite(norm):
            raise InferenceOutputError()
        if abs(norm - 1.0) > _NORM_TOLERANCE:
            raise InferenceOutputError()
        return vector, assessment

    def close(self) -> None:
        self._network = None


def load_siglip_encoder(artifact_dir: Path, *, torch_threads: int, relevance_dir: Path | None = None) -> SiglipEncoder:
    descriptor = read_descriptor(
        artifact_dir / DESCRIPTOR_FILENAME,
        preprocess_version=PREPROCESS_VERSION,
        embedding_dimension=EMBEDDING_DIMENSION,
    )
    files = verified_weight_files(artifact_dir, descriptor.artifact_sha256)  # before any deserialisation
    state: dict[str, torch.Tensor] = {}
    for name, path in files.items():
        if name != PROJECTION_FILENAME:
            state.update(load_file(str(path), device="cpu"))
    network = SiglipVision()
    network.load_state_dict({key: value.float() for key, value in state.items()}, strict=True)
    network.eval()
    torch.set_num_threads(torch_threads)
    with torch.inference_mode():
        # One forward pass before readiness: the first call pays one-off kernel/thread-pool setup (Task 04.2-Q).
        network(torch.zeros(1, 3, IMAGE_SIZE, IMAGE_SIZE))
    projection = load_file(str(files[PROJECTION_FILENAME]), device="cpu")
    mean, matrix = projection.get("mean"), projection.get("matrix")
    if mean is None or matrix is None:
        raise ArtifactRejectedError("projection.safetensors has unexpected tensors")
    if tuple(mean.shape) != (HIDDEN,) or tuple(matrix.shape) != (EMBEDDING_DIMENSION, HIDDEN):
        raise ArtifactRejectedError("projection.safetensors has unexpected tensors")
    relevance = None
    if relevance_dir is not None:
        from app.models.relevance import load_relevance_gate

        relevance = load_relevance_gate(
            relevance_dir, model_version=descriptor.model_version, feature_dim=EMBEDDING_DIMENSION
        )
    return SiglipEncoder(descriptor, network, mean.float(), matrix.float(), relevance)


def is_siglip_artifact(artifact_dir: Path) -> bool:
    """True when the descriptor names this module's preprocessing (used to pick the loader)."""
    try:
        raw = json.loads((artifact_dir / DESCRIPTOR_FILENAME).read_bytes().decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return False
    return isinstance(raw, dict) and raw.get("preprocessVersion") == PREPROCESS_VERSION


@dataclass(frozen=True, slots=True)
class ArtifactLoader:
    """A ``ModelLoader`` that loads whichever supported encoder the artifact describes."""

    artifact_dir: Path
    torch_threads: int
    relevance_dir: Path | None = None

    def __call__(self) -> EfficientNetEncoder | SiglipEncoder:
        return load_encoder(self.artifact_dir, torch_threads=self.torch_threads, relevance_dir=self.relevance_dir)


def load_encoder(
    artifact_dir: Path, *, torch_threads: int, relevance_dir: Path | None = None
) -> EfficientNetEncoder | SiglipEncoder:
    if is_siglip_artifact(artifact_dir):
        return load_siglip_encoder(artifact_dir, torch_threads=torch_threads, relevance_dir=relevance_dir)
    from app.models.efficientnet_loader import load_efficientnet_encoder

    return load_efficientnet_encoder(artifact_dir, torch_threads=torch_threads, relevance_dir=relevance_dir)
