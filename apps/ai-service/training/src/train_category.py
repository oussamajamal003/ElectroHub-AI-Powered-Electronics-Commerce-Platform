"""Task 04.2-Q: category-aware metric learning on the expanded real-photo dataset.

One network, two outputs, trained jointly on real photographs and the catalog illustrations that form the gallery:
  * the serving EmbeddingNetwork (backbone -> projection -> L2), trained with a hierarchical supervised-contrastive
    loss: two images are positives when they share a product family, or when they share a visual class and at least
    one of them has no family label (class-level photos). Different classes are always negatives.
  * a category head Linear(1280, classes) on the pooled backbone features, trained with cross-entropy. Its classes are
    the catalog category slugs plus "other" (objects the catalog does not sell); it becomes the relevance gate.

Manifest: <data>/manifests/images.csv with image_id, path, category, family, product_id, domain (photo|catalog),
source_group, split (train|dev). The final benchmark is NOT in this dataset. Checkpoint selection uses dev only.

Outputs (<out>): environment.json, training_log.json, dev_best.json, export/ (model.safetensors + descriptor.json),
head/ (head.safetensors + classes.json).
"""

from __future__ import annotations

import argparse
import copy
import csv
import hashlib
import json
import platform
import random
import time
from collections import defaultdict
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import numpy as np
import torch
import torchvision
from data import eval_transform, load_rgb, train_transform
from embedding_network import BACKBONE_FEATURES, EmbeddingNetwork
from export import export_artifact
from safetensors.torch import save_file
from torch import nn
from torch.utils.data import DataLoader, Dataset, Sampler
from torchvision.models import EfficientNet_B0_Weights, efficientnet_b0

OTHER = "other"


def write(out: Path, name: str, payload: Any) -> None:
    (out / name).write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")


def seed_everything(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)


class Rows(Dataset[tuple[torch.Tensor, int, int]]):
    def __init__(self, rows: list[dict[str, str]], root: Path, classes: dict[str, int], families: dict[str, int], tf):  # type: ignore[no-untyped-def]
        self.rows, self.root, self.classes, self.families, self.tf = rows, root, classes, families, tf

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, index: int) -> tuple[torch.Tensor, int, int]:
        row = self.rows[index]
        family = self.families.get(row["family"], -1) if row["family"] else -1
        return self.tf(load_rgb(self.root / row["path"])), self.classes[row["category"]], family


class ClassBatchSampler(Sampler[list[int]]):
    """P classes x K images per batch, half of each class's K drawn from catalog images when it has any, so every
    batch contains photo-to-illustration positives (the deployment domain gap)."""

    def __init__(self, rows: list[dict[str, str]], p: int, k: int, batches: int, seed: int) -> None:
        self.photo: dict[str, list[int]] = defaultdict(list)
        self.catalog: dict[str, list[int]] = defaultdict(list)
        for index, row in enumerate(rows):
            (self.catalog if row["domain"] == "catalog" else self.photo)[row["category"]].append(index)
        self.classes = sorted(
            c for c in set(self.photo) | set(self.catalog) if len(self.photo[c]) + len(self.catalog[c]) >= 2
        )
        self.p, self.k, self.batches = min(p, len(self.classes)), k, batches
        self.rng = random.Random(seed)  # noqa: S311 - reproducible sampling, not security

    def __len__(self) -> int:
        return self.batches

    def _draw(self, pool: list[int], n: int) -> list[int]:
        return self.rng.sample(pool, n) if len(pool) >= n else self.rng.choices(pool, k=n)

    def __iter__(self) -> Iterator[list[int]]:
        for _ in range(self.batches):
            batch: list[int] = []
            for label in self.rng.sample(self.classes, self.p):
                photo, catalog = self.photo[label], self.catalog[label]
                n_catalog = self.k // 2 if catalog and photo else (self.k if catalog else 0)
                batch += self._draw(catalog, n_catalog) if n_catalog else []
                batch += self._draw(photo, self.k - n_catalog) if self.k - n_catalog else []
            yield batch


def hierarchical_supcon(z: torch.Tensor, cls: torch.Tensor, fam: torch.Tensor, temperature: float) -> torch.Tensor:
    logits = z @ z.T / temperature
    eye = torch.eye(len(cls), dtype=torch.bool, device=z.device)
    same_class = cls[:, None] == cls[None, :]
    both_family = (fam[:, None] >= 0) & (fam[None, :] >= 0)
    positive = torch.where(both_family, fam[:, None] == fam[None, :], same_class) & ~eye
    # Same class but different known families: neither positive nor pushed apart as hard as other classes.
    ignore = same_class & both_family & ~positive & ~eye
    anchors = positive.any(dim=1)
    logits = logits.masked_fill(eye | ignore, float("-inf"))
    log_prob = logits - torch.logsumexp(logits, dim=1, keepdim=True)
    mean_pos = log_prob.masked_fill(~positive, 0.0).sum(1) / positive.sum(1).clamp(min=1)
    return -mean_pos[anchors].mean()


@torch.inference_mode()
def encode(model: EmbeddingNetwork, head: nn.Linear, rows, root: Path, device, workers: int):  # type: ignore[no-untyped-def]
    loader = DataLoader(Rows(rows, root, defaultdict(int), {}, eval_transform), batch_size=64, num_workers=workers)
    model.eval()
    z, p = [], []
    for images, _, _ in loader:
        f = model.backbone_features(images.to(device))
        z.append(nn.functional.normalize(model.projection(f), dim=1).float().cpu())
        p.append(torch.softmax(head(f).float(), dim=1).cpu())
    return torch.cat(z).numpy(), torch.cat(p).numpy()


def evaluate(model, head, gallery, queries, root, device, workers, classes):  # type: ignore[no-untyped-def]
    gz, _ = encode(model, head, gallery, root, device, workers)
    qz, qp = encode(model, head, queries, root, device, workers)
    products = sorted({r["product_id"] for r in gallery})
    pindex = {pid: i for i, pid in enumerate(products)}
    pcat = {r["product_id"]: r["category"] for r in gallery}
    pfam = {r["product_id"]: r["family"] for r in gallery}
    sim = qz @ gz.T
    product_sim = np.full((len(queries), len(products)), -2.0, dtype=np.float32)
    for j, r in enumerate(gallery):
        col = pindex[r["product_id"]]
        product_sim[:, col] = np.maximum(product_sim[:, col], sim[:, j])
    names = sorted(classes, key=classes.get)
    stats = {"cat1": 0, "cat5": 0, "n_in": 0, "fam1": 0, "fam5": 0, "n_fam": 0, "head_ok": 0, "n": len(queries)}
    other_scores, other_labels = [], []
    for i, q in enumerate(queries):
        stats["head_ok"] += names[int(qp[i].argmax())] == q["category"]
        other_scores.append(float(qp[i][classes[OTHER]]) if OTHER in classes else 0.0)
        other_labels.append(q["category"] == OTHER)
        if q["category"] == OTHER:
            continue
        order = [products[j] for j in np.argsort(-product_sim[i])[:5]]
        stats["n_in"] += 1
        stats["cat1"] += pcat[order[0]] == q["category"]
        stats["cat5"] += any(pcat[o] == q["category"] for o in order)
        if q["family"] and q["family"] in pfam.values():
            stats["n_fam"] += 1
            stats["fam1"] += pfam[order[0]] == q["family"]
            stats["fam5"] += any(pfam[o] == q["family"] for o in order)
    pos = [s for s, lab in zip(other_scores, other_labels, strict=True) if lab]
    neg = [s for s, lab in zip(other_scores, other_labels, strict=True) if not lab]
    auroc = float(np.mean([[p > n for n in neg] for p in pos])) if pos and neg else float("nan")
    result = {
        "categoryRecall@1": stats["cat1"] / max(stats["n_in"], 1),
        "categoryRecall@5": stats["cat5"] / max(stats["n_in"], 1),
        "familyRecall@1": stats["fam1"] / max(stats["n_fam"], 1),
        "familyRecall@5": stats["fam5"] / max(stats["n_fam"], 1),
        "headAccuracy": stats["head_ok"] / max(stats["n"], 1),
        "otherAUROC": auroc,
        "counts": {k: stats[k] for k in ("n", "n_in", "n_fam")},
    }
    # Dev-only model selection: category retrieval, product-family retrieval, head accuracy and how well P(other)
    # separates out-of-catalog photos (the no-match gate) count equally.
    parts = [result["categoryRecall@1"], result["familyRecall@1"], result["headAccuracy"]]
    result["selection"] = float(np.mean([*parts, 0.0 if np.isnan(auroc) else auroc]))
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--warmup-epochs", type=int, default=3)
    parser.add_argument("--unfreeze-stages", type=int, default=3, help="0 = frozen backbone (candidate B)")
    parser.add_argument("--classes-per-batch", type=int, default=16)
    parser.add_argument("--images-per-class", type=int, default=6)
    parser.add_argument("--batches-per-epoch", type=int, default=80)
    parser.add_argument("--lr-head", type=float, default=5e-4)
    parser.add_argument("--lr-backbone", type=float, default=5e-5)
    parser.add_argument("--temperature", type=float, default=0.1)
    parser.add_argument("--ce-weight", type=float, default=0.5)
    parser.add_argument("--patience", type=int, default=8)
    parser.add_argument("--seed", type=int, default=20261026)
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--model-version", required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    seed_everything(args.seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    manifest = args.data / "manifests" / "images.csv"
    rows = list(csv.DictReader(manifest.open(encoding="utf-8")))
    train = [r for r in rows if r["split"] == "train"]
    dev = [r for r in rows if r["split"] == "dev"]
    gallery = [r for r in rows if r["domain"] == "catalog"]
    classes = {name: i for i, name in enumerate(sorted({r["category"] for r in train}))}
    families = {name: i for i, name in enumerate(sorted({r["family"] for r in train if r["family"]}))}
    if any(r["domain"] != "photo" for r in dev) or {r["source_group"] for r in dev} & {
        r["source_group"] for r in train if r["domain"] == "photo"
    }:
        raise SystemExit("dev must be photos from source groups absent from training")
    write(
        args.out,
        "environment.json",
        {
            "python": platform.python_version(),
            "torch": torch.__version__,
            "torchvision": torchvision.__version__,
            "cuda": torch.version.cuda,
            "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
            "seed": args.seed,
            "args": {k: str(v) for k, v in vars(args).items()},
            "manifestSha256": hashlib.sha256(manifest.read_bytes()).hexdigest(),
            "counts": {"train": len(train), "dev": len(dev), "gallery": len(gallery), "classes": len(classes)},
            "trainPerClass": {c: sum(r["category"] == c for r in train) for c in classes},
        },
    )

    model = EmbeddingNetwork().to(device)
    imagenet = efficientnet_b0(weights=EfficientNet_B0_Weights.IMAGENET1K_V1)
    model.backbone.load_state_dict(imagenet.features.state_dict())
    head = nn.Linear(BACKBONE_FEATURES, len(classes)).to(device)
    stages = list(model.backbone.children())
    trainable = stages[-args.unfreeze_stages :] if args.unfreeze_stages else []
    train_set = Rows(train, args.data / "images", classes, families, train_transform)
    ce = nn.CrossEntropyLoss(label_smoothing=0.1)
    scaler = torch.amp.GradScaler(enabled=device.type == "cuda")
    log: list[dict[str, Any]] = []
    best, best_state, best_epoch, stale = -1.0, None, 0, 0
    started = time.time()

    for epoch in range(1, args.epochs + 1):
        unfrozen = bool(trainable) and epoch > args.warmup_epochs
        for parameter in model.backbone.parameters():
            parameter.requires_grad = False
        for stage in trainable if unfrozen else []:
            for parameter in stage.parameters():
                parameter.requires_grad = True
        if epoch == 1 or (trainable and epoch == args.warmup_epochs + 1):
            groups = [{"params": [*model.projection.parameters(), *head.parameters()], "lr": args.lr_head}]
            if unfrozen:
                groups.append({"params": [p for s in trainable for p in s.parameters()], "lr": args.lr_backbone})
            optimizer = torch.optim.AdamW(groups, weight_decay=1e-4)
            scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
                optimizer, T_max=(args.epochs - epoch + 1) * args.batches_per_epoch
            )
        sampler = ClassBatchSampler(
            train, args.classes_per_batch, args.images_per_class, args.batches_per_epoch, args.seed + epoch
        )
        loader = DataLoader(
            train_set, batch_sampler=sampler, num_workers=args.workers, pin_memory=device.type == "cuda"
        )
        model.train()
        model.backbone.eval()  # frozen stages keep ImageNet BN statistics
        for stage in trainable if unfrozen else []:
            stage.train()
        totals = {"supcon": 0.0, "ce": 0.0, "steps": 0}
        for images, cls, fam in loader:
            images, cls, fam = images.to(device), cls.to(device), fam.to(device)
            with torch.autocast(device.type, enabled=device.type == "cuda"):
                features = model.backbone_features(images)
                z = nn.functional.normalize(model.projection(features).float(), dim=1)
                logits = head(features).float()
            loss_sc = hierarchical_supcon(z, cls, fam, args.temperature)
            loss_ce = ce(logits, cls)
            loss = loss_sc + args.ce_weight * loss_ce
            optimizer.zero_grad(set_to_none=True)
            scaler.scale(loss).backward()
            scaler.unscale_(optimizer)
            torch.nn.utils.clip_grad_norm_([p for g in optimizer.param_groups for p in g["params"]], 5.0)
            scaler.step(optimizer)
            scaler.update()
            scheduler.step()
            totals["supcon"] += loss_sc.item()
            totals["ce"] += loss_ce.item()
            totals["steps"] += 1
        dev_metrics = evaluate(model, head, gallery, dev, args.data / "images", device, args.workers, classes)
        entry = {
            "epoch": epoch,
            "unfrozen": unfrozen,
            "supcon": totals["supcon"] / max(totals["steps"], 1),
            "ce": totals["ce"] / max(totals["steps"], 1),
            "dev": dev_metrics,
            "lr": [g["lr"] for g in optimizer.param_groups],
            "elapsedSeconds": round(time.time() - started, 1),
        }
        log.append(entry)
        print(json.dumps(entry), flush=True)
        write(args.out, "training_log.json", log)
        if dev_metrics["selection"] > best:
            best, best_epoch, stale = dev_metrics["selection"], epoch, 0
            best_state = (copy.deepcopy(model.state_dict()), copy.deepcopy(head.state_dict()))
            write(args.out, "dev_best.json", {"epoch": epoch, **dev_metrics})
        else:
            stale += 1
            if stale >= args.patience:
                break

    assert best_state is not None
    model.load_state_dict(best_state[0])
    head.load_state_dict(best_state[1])
    model.cpu()
    head.cpu()
    descriptor = export_artifact(
        model,
        args.out / "export",
        model_version=args.model_version,
        dataset_digest=hashlib.sha256(manifest.read_bytes()).hexdigest(),
        evaluation_digest=hashlib.sha256(json.dumps(log[best_epoch - 1], sort_keys=True).encode()).hexdigest(),
    )
    (args.out / "head").mkdir(exist_ok=True)
    save_file(
        {"weight": head.weight.detach().contiguous().float(), "bias": head.bias.detach().contiguous().float()},
        str(args.out / "head" / "head.safetensors"),
    )
    write(args.out / "head", "classes.json", {"classes": sorted(classes, key=classes.get), "bestEpoch": best_epoch})
    print(json.dumps({"bestEpoch": best_epoch, "selection": best, "descriptor": descriptor}), flush=True)


if __name__ == "__main__":
    main()
