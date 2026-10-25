"""Writes the serving artifact: model.safetensors (no pickle) + descriptor.json, then proves load parity."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import torch
from embedding_network import (
    CROP_SIZE,
    EMBEDDING_DIMENSION,
    IMAGENET_MEAN,
    IMAGENET_STD,
    PREPROCESS_VERSION,
    RESIZE_SHORTER,
    EmbeddingNetwork,
)
from safetensors.torch import load_file, save_file


def export_artifact(
    model: EmbeddingNetwork, out: Path, *, model_version: str, dataset_digest: str, evaluation_digest: str
) -> dict[str, object]:
    out.mkdir(parents=True, exist_ok=True)
    model.eval()
    state = {name: tensor.detach().contiguous().float() for name, tensor in model.state_dict().items()}
    weights = out / "model.safetensors"
    save_file(state, str(weights))
    sha256 = hashlib.sha256(weights.read_bytes()).hexdigest()
    descriptor: dict[str, object] = {
        "name": "electrohub-visual-search",
        "modelVersion": model_version,
        "embeddingVersion": f"{model_version}-{sha256[:12]}",
        "preprocessVersion": PREPROCESS_VERSION,
        "embeddingDimension": EMBEDDING_DIMENSION,
        "artifactFormat": "safetensors",
        "artifactSha256": sha256,
    }
    # descriptor.json holds exactly the identity the serving loader accepts; everything else goes in model_card.json.
    (out / "descriptor.json").write_text(json.dumps(descriptor, indent=2), encoding="utf-8")
    card = {
        "embeddingVersion": descriptor["embeddingVersion"],
        "architecture": "torchvision efficientnet_b0 features + GAP + Linear(1280, 256) + L2 normalise",
        "preprocess": {
            "resizeShorter": RESIZE_SHORTER,
            "centerCrop": CROP_SIZE,
            "mean": IMAGENET_MEAN,
            "std": IMAGENET_STD,
            "colour": "RGB, alpha composited on white, EXIF transposed",
        },
        "datasetDigest": dataset_digest,
        "evaluationDigest": evaluation_digest,
        "similarity": "cosine; score = 1 - cosine distance (not a probability)",
    }
    (out / "model_card.json").write_text(json.dumps(card, indent=2), encoding="utf-8")

    # Parity: a fresh network rebuilt from the exported tensors must reproduce the trained model's embeddings.
    reloaded = EmbeddingNetwork()
    reloaded.load_state_dict(load_file(str(weights)), strict=True)
    reloaded.eval()
    probe = torch.Generator().manual_seed(0)
    images = torch.randn(4, 3, CROP_SIZE, CROP_SIZE, generator=probe)
    with torch.inference_mode():
        expected, actual = model.cpu()(images), reloaded(images)
    max_error = float((expected - actual).abs().max())
    norms = actual.norm(dim=1)
    if max_error > 1e-5 or not torch.allclose(norms, torch.ones_like(norms), atol=1e-4):
        raise RuntimeError(f"export parity failed (max error {max_error})")
    (out / "parity.json").write_text(json.dumps({"maxAbsError": max_error, "probeImages": 4}), encoding="utf-8")
    return descriptor
