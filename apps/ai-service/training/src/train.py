"""Baseline evaluation, EfficientNet-B0 metric-learning fine-tuning, held-out evaluation and safe export.

Order of operations (each step writes its own JSON so an interrupted Kaggle session leaves evidence):
  1. environment.json   - CUDA/GPU/library versions, seeds, dataset digests
  2. baseline.json      - frozen ImageNet EfficientNet-B0 (pooled 1280-d features) on validation, test and unseen sets
  3. training_log.json  - per-epoch loss, gradient norm, validation Recall@1, learning rates
  4. weight_delta.json  - L2 change of every parameter group between ImageNet init and the selected checkpoint
  5. finetuned.json     - the validation-selected checkpoint on the same frozen test / unseen sets
  6. export/            - model.safetensors + descriptor.json (+ sha256), produced by export.py

The test and unseen query sets are only read after training has finished; checkpoint selection uses validation only.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import platform
import random
import time
from pathlib import Path
from typing import Any

import numpy as np
import torch
import torchvision
from data import FamilyBatchSampler, ManifestDataset, eval_transform, read_manifest, train_transform
from embedding_network import EmbeddingNetwork
from export import export_artifact
from losses import SupConLoss
from metrics import RetrievalSet, evaluate
from torch.utils.data import DataLoader
from torchvision.models import EfficientNet_B0_Weights, efficientnet_b0


def write(out: Path, name: str, payload: Any) -> None:
    (out / name).write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")


def file_digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def seed_everything(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)


@torch.inference_mode()
def embed(
    model: EmbeddingNetwork,
    rows: list[dict[str, str]],
    root: Path,
    device: torch.device,
    *,
    baseline: bool,
    workers: int,
) -> RetrievalSet:
    loader = DataLoader(ManifestDataset(rows, root, {}, eval_transform), batch_size=64, num_workers=workers)
    model.eval()
    chunks = []
    for images, _ in loader:
        images = images.to(device, non_blocking=True)
        vectors = model.backbone_features(images) if baseline else model(images)
        chunks.append(torch.nn.functional.normalize(vectors.float(), dim=1).cpu())
    return RetrievalSet(
        torch.cat(chunks).numpy(),
        [row["family"] for row in rows],
        [row["capture_group_id"] for row in rows],
        [row["category"] for row in rows],
    )


def protocols(manifests: dict[str, list[dict[str, str]]]) -> dict[str, tuple[str, str]]:
    """name -> (query manifest, gallery manifest)."""
    plan = {"validation": ("validation", "train"), "known_sku_test": ("test_queries", "gallery")}
    if manifests.get("unseen_sku_queries"):
        plan["unseen_sku_test"] = ("unseen_sku_queries", "unseen_sku_gallery")
    return plan


def evaluate_all(
    model: EmbeddingNetwork,
    manifests: dict[str, list[dict[str, str]]],
    root: Path,
    device: torch.device,
    names: list[str],
    *,
    baseline: bool,
    workers: int,
) -> dict[str, Any]:
    cache: dict[str, RetrievalSet] = {}

    def get(name: str) -> RetrievalSet:
        if name not in cache:
            cache[name] = embed(model, manifests[name], root, device, baseline=baseline, workers=workers)
        return cache[name]

    plan = protocols(manifests)
    return {name: evaluate(get(plan[name][0]), get(plan[name][1])) for name in names}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, required=True, help="dataset root with manifests/ and images/")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--epochs", type=int, default=12)
    parser.add_argument("--warmup-epochs", type=int, default=2, help="projection-only epochs before unfreezing")
    parser.add_argument("--families-per-batch", type=int, default=16)
    parser.add_argument("--images-per-family", type=int, default=4)
    parser.add_argument("--batches-per-epoch", type=int, default=60)
    parser.add_argument("--unfreeze-stages", type=int, default=3, help="last N EfficientNet feature stages trained")
    parser.add_argument("--lr-head", type=float, default=1e-3)
    parser.add_argument("--lr-backbone", type=float, default=1e-4)
    parser.add_argument("--temperature", type=float, default=0.1)
    parser.add_argument("--patience", type=int, default=4)
    parser.add_argument("--seed", type=int, default=20261024)
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--model-version", default="effb0-commons-v1")
    parser.add_argument(
        "--train-batchnorm",
        action="store_true",
        help="update BatchNorm statistics in unfrozen stages (default: keep ImageNet statistics)",
    )
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    seed_everything(args.seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    manifest_dir = args.data / "manifests"
    names = ["train", "validation", "test_queries", "gallery", "unseen_sku_queries", "unseen_sku_gallery"]
    manifests = {
        name: read_manifest(manifest_dir / f"{name}.csv") if (manifest_dir / f"{name}.csv").exists() else []
        for name in names
    }
    digests = {
        name: file_digest(manifest_dir / f"{name}.csv") for name in names if (manifest_dir / f"{name}.csv").exists()
    }
    dataset_digest = hashlib.sha256(json.dumps(digests, sort_keys=True).encode()).hexdigest()
    write(
        args.out,
        "environment.json",
        {
            "python": platform.python_version(),
            "torch": torch.__version__,
            "torchvision": torchvision.__version__,
            "cuda": torch.cuda.is_available(),
            "cudaVersion": torch.version.cuda,
            "gpus": [torch.cuda.get_device_name(i) for i in range(torch.cuda.device_count())],
            "gpuMemoryGiB": [
                round(torch.cuda.get_device_properties(i).total_memory / 2**30, 1)
                for i in range(torch.cuda.device_count())
            ],
            "device": str(device),
            "seed": args.seed,
            "args": {k: str(v) for k, v in vars(args).items()},
            "manifestDigests": digests,
            "datasetDigest": dataset_digest,
            "counts": {name: len(rows) for name, rows in manifests.items()},
        },
    )

    model = EmbeddingNetwork()
    imagenet = efficientnet_b0(weights=EfficientNet_B0_Weights.IMAGENET1K_V1)
    model.backbone.load_state_dict(imagenet.features.state_dict())
    model.to(device)
    initial = {name: tensor.detach().cpu().clone() for name, tensor in model.state_dict().items()}
    eval_names = list(protocols(manifests))

    baseline = evaluate_all(
        model, manifests, args.data / "images", device, eval_names, baseline=True, workers=args.workers
    )
    write(args.out, "baseline.json", baseline)

    families = sorted({row["family"] for row in manifests["train"]})
    label_index = {family: index for index, family in enumerate(families)}
    train_set = ManifestDataset(manifests["train"], args.data / "images", label_index, train_transform)
    loss_fn = SupConLoss(args.temperature)
    stages = list(model.backbone.children())
    trainable_stages = stages[-args.unfreeze_stages :]
    scaler = torch.amp.GradScaler(enabled=device.type == "cuda")
    log: list[dict[str, Any]] = []
    best_score, best_state, best_epoch, stale = -1.0, copy.deepcopy(model.state_dict()), 0, 0
    total_steps = 0
    started = time.time()

    for epoch in range(1, args.epochs + 1):
        unfrozen = epoch > args.warmup_epochs
        for parameter in model.backbone.parameters():
            parameter.requires_grad = False
        if unfrozen:
            for stage in trainable_stages:
                for parameter in stage.parameters():
                    parameter.requires_grad = True
        if epoch == 1 or epoch == args.warmup_epochs + 1:
            groups = [{"params": model.projection.parameters(), "lr": args.lr_head}]
            if unfrozen:
                groups.append({"params": [p for s in trainable_stages for p in s.parameters()], "lr": args.lr_backbone})
            optimizer = torch.optim.AdamW(groups, weight_decay=1e-4)
            remaining = (args.epochs - epoch + 1) * args.batches_per_epoch
            scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=remaining)
        sampler = FamilyBatchSampler(
            [label_index[row["family"]] for row in manifests["train"]],
            args.families_per_batch,
            args.images_per_family,
            args.batches_per_epoch,
            args.seed + epoch,
        )
        loader = DataLoader(
            train_set, batch_sampler=sampler, num_workers=args.workers, pin_memory=device.type == "cuda"
        )
        model.train()
        # Frozen stages always keep ImageNet BatchNorm statistics; unfrozen stages do too unless
        # --train-batchnorm, because
        # ~130 training photos give noisy batch statistics (run 1 showed validation falling once they were updated).
        for stage in stages:
            if stage not in trainable_stages or not unfrozen or not args.train_batchnorm:
                for module in stage.modules():
                    if isinstance(module, torch.nn.BatchNorm2d):
                        module.eval()
        losses, grad_norms = [], []
        for images, labels in loader:
            images, labels = images.to(device, non_blocking=True), labels.to(device, non_blocking=True)
            with torch.autocast(device.type, enabled=device.type == "cuda"):
                embeddings = model(images)
            loss = loss_fn(embeddings.float(), labels)
            optimizer.zero_grad(set_to_none=True)
            scaler.scale(loss).backward()
            scaler.unscale_(optimizer)
            grad_norms.append(
                float(torch.nn.utils.clip_grad_norm_([p for p in model.parameters() if p.requires_grad], 1.0))
            )
            scaler.step(optimizer)
            scaler.update()
            scheduler.step()
            losses.append(float(loss))
            total_steps += 1
        if not np.isfinite(losses).all():
            raise RuntimeError(f"non-finite loss in epoch {epoch}")
        validation = evaluate_all(
            model, manifests, args.data / "images", device, ["validation"], baseline=False, workers=args.workers
        )["validation"]
        score = validation["recall@1"] + 0.001 * validation["mAP"]
        log.append(
            {
                "epoch": epoch,
                "unfrozen": unfrozen,
                "loss": float(np.mean(losses)),
                "gradNorm": float(np.mean(grad_norms)),
                "validationRecall@1": validation["recall@1"],
                "validationMAP": validation["mAP"],
                "lr": [group["lr"] for group in optimizer.param_groups],
                "steps": total_steps,
                "elapsedSeconds": round(time.time() - started, 1),
            }
        )
        write(args.out, "training_log.json", log)
        print(json.dumps(log[-1]), flush=True)
        if epoch == args.warmup_epochs + 1:
            stale = 0  # patience measures the fine-tuning phase, not the projection warm-up
        if score > best_score:
            best_score, best_state, best_epoch, stale = score, copy.deepcopy(model.state_dict()), epoch, 0
            torch.save({"state": best_state, "epoch": epoch}, args.out / "checkpoint_best.pt")  # offline resume only
        else:
            stale += 1
            if stale >= args.patience and unfrozen:
                break

    model.load_state_dict(best_state)
    delta = {}
    for name, tensor in model.state_dict().items():
        if tensor.dtype.is_floating_point:
            change = float((tensor.detach().cpu() - initial[name]).norm())
            delta[name] = {"l2Change": change, "relative": change / (float(initial[name].norm()) or 1.0)}
    changed = [name for name, value in delta.items() if value["l2Change"] > 0]
    write(
        args.out,
        "weight_delta.json",
        {
            "selectedEpoch": best_epoch,
            "optimizerSteps": total_steps,
            "changedTensors": len(changed),
            "totalTensors": len(delta),
            "tensors": delta,
        },
    )
    finetuned = evaluate_all(
        model, manifests, args.data / "images", device, eval_names, baseline=False, workers=args.workers
    )
    write(args.out, "finetuned.json", {"selectedEpoch": best_epoch, **finetuned})
    evaluation_digest = hashlib.sha256((args.out / "finetuned.json").read_bytes()).hexdigest()
    export_artifact(
        model.cpu(),
        args.out / "export",
        model_version=args.model_version,
        dataset_digest=dataset_digest,
        evaluation_digest=evaluation_digest,
    )


if __name__ == "__main__":
    main()
