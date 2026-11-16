"""Deterministic checks of the training pipeline pieces (synthetic tensors only; no photographs, no downloads)."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
import torch
from data import FamilyBatchSampler
from embedding_network import EMBEDDING_DIMENSION, EmbeddingNetwork
from export import export_artifact
from losses import SupConLoss
from metrics import RetrievalSet, evaluate


def unit(rows: list[list[float]]) -> np.ndarray:
    array = np.array(rows, dtype=np.float32)
    return array / np.linalg.norm(array, axis=1, keepdims=True)


def test_network_emits_normalised_256_d_embeddings() -> None:
    model = EmbeddingNetwork().eval()
    with torch.inference_mode():
        output = model(torch.randn(2, 3, 224, 224))
    assert output.shape == (2, EMBEDDING_DIMENSION)
    assert torch.allclose(output.norm(dim=1), torch.ones(2), atol=1e-5)
    assert torch.isfinite(output).all()


def test_supcon_loss_is_finite_lower_for_clustered_embeddings_and_needs_positives() -> None:
    loss = SupConLoss(0.1)
    labels = torch.tensor([0, 0, 1, 1])
    clustered = torch.nn.functional.normalize(torch.tensor([[1.0, 0.0], [0.99, 0.1], [0.0, 1.0], [0.1, 0.99]]), dim=1)
    mixed = torch.nn.functional.normalize(torch.tensor([[1.0, 0.0], [0.0, 1.0], [0.99, 0.1], [0.1, 0.99]]), dim=1)
    assert torch.isfinite(loss(clustered, labels))
    assert loss(clustered, labels) < loss(mixed, labels)
    with pytest.raises(ValueError):
        loss(clustered, torch.tensor([0, 1, 2, 3]))


def test_optimizer_steps_change_projection_and_unfrozen_backbone_weights() -> None:
    torch.manual_seed(0)
    model = EmbeddingNetwork()
    last_stage = list(model.backbone.children())[-1]
    for parameter in model.backbone.parameters():
        parameter.requires_grad = False
    for parameter in last_stage.parameters():
        parameter.requires_grad = True
    before_head = model.projection.weight.detach().clone()
    before_stage = [p.detach().clone() for p in last_stage.parameters()]
    frozen_first = next(iter(model.backbone.children()))[0].weight.detach().clone()
    optimizer = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=1e-2)
    images, labels = torch.randn(4, 3, 64, 64), torch.tensor([0, 0, 1, 1])
    for _ in range(2):
        optimizer.zero_grad()
        SupConLoss()(model(images), labels).backward()
        optimizer.step()
    assert not torch.equal(before_head, model.projection.weight)
    assert any(not torch.equal(a, b) for a, b in zip(before_stage, last_stage.parameters(), strict=True))
    assert torch.equal(frozen_first, next(iter(model.backbone.children()))[0].weight)


def test_sampler_builds_p_by_k_batches_with_positives() -> None:
    labels = [0, 0, 0, 1, 1, 2, 2, 2, 3]  # family 3 has one image and is not usable as an anchor family
    batches = list(FamilyBatchSampler(labels, families_per_batch=3, images_per_family=2, batches=5, seed=1))
    assert len(batches) == 5
    for batch in batches:
        assert len(batch) == 6
        families = [labels[i] for i in batch]
        assert 3 not in families
        assert all(families.count(family) == 2 for family in set(families))


def test_metrics_recall_map_and_family_grouping() -> None:
    gallery = RetrievalSet(
        unit([[1, 0, 0], [0.9, 0.1, 0], [0, 1, 0], [0, 0, 1]]),
        ["a", "a", "b", "c"],
        ["g1", "g2", "g3", "g4"],
        ["x", "x", "y", "z"],
    )
    queries = RetrievalSet(unit([[1, 0.05, 0], [0.1, 0.2, 1]]), ["a", "b"], ["q1", "q2"], ["x", "y"])
    result = evaluate(queries, gallery)
    assert result["recall@1"] == 0.5  # "a" correct; "b" ranks after "c"
    assert result["recall@5"] == 1.0
    assert result["evaluableQueries"] == 2
    assert result["failures"][0]["label"] == "b"
    assert 0 < result["mAP"] < 1


def test_metrics_refuse_capture_group_leakage() -> None:
    gallery = RetrievalSet(unit([[1, 0]]), ["a"], ["shared"], ["x"])
    queries = RetrievalSet(unit([[1, 0]]), ["a"], ["shared"], ["x"])
    with pytest.raises(ValueError, match="share capture groups"):
        evaluate(queries, gallery)


def test_export_writes_safetensors_descriptor_and_passes_parity(tmp_path: Path) -> None:
    descriptor = export_artifact(
        EmbeddingNetwork(), tmp_path, model_version="effb0-test-v1", dataset_digest="a" * 64, evaluation_digest="b" * 64
    )
    assert (tmp_path / "model.safetensors").read_bytes()[:8] != b"\x80\x02"  # not a pickle stream
    on_disk = json.loads((tmp_path / "descriptor.json").read_text(encoding="utf-8"))
    assert on_disk == descriptor
    # Exactly the identity keys the serving loader (app/models/efficientnet_loader.py) accepts.
    assert set(on_disk) == {
        "name",
        "modelVersion",
        "embeddingVersion",
        "preprocessVersion",
        "embeddingDimension",
        "artifactFormat",
        "artifactSha256",
    }
    assert on_disk["embeddingDimension"] == 256 and len(on_disk["artifactSha256"]) == 64
    assert json.loads((tmp_path / "model_card.json").read_text(encoding="utf-8"))["datasetDigest"] == "a" * 64
    assert json.loads((tmp_path / "parity.json").read_text(encoding="utf-8"))["maxAbsError"] <= 1e-5
