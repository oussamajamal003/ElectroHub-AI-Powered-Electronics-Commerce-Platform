"""Build candidate D (Task 04.2-Q reopen): pretrained SigLIP 2 B/16-224 vision tower + fixed 768->256 PCA projection
+ linear category/relevance head. Nothing in the vision tower is trained.

Inputs: the exported vision shards (Kaggle, fp16 safetensors), and SigLIP 2 embeddings of the dataset produced by the
reference implementation (encoder-compare kernel). Fitting uses ONLY split=train photos and catalog images; the
rerank weight, electronics-mass threshold and similarity floor are chosen on split=dev. The final benchmark is not read.

    python training/build_siglip_candidate.py <vision-dir> <embeddings.npz> models/siglip2-b16-p256-d1 \
        models/relevance-siglip2-d1 --model-version siglip2-b16-p256-d1
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path

import numpy as np
import torch
from safetensors.torch import save_file

DIM = 256
SCALE = 20.0
OTHER = "other"


def product_sims(e: np.ndarray, gallery: list[int], meta: list[dict[str, str]], rows: list[int]) -> tuple:
    products = sorted({meta[i]["product_id"] for i in gallery})
    index = {p: k for k, p in enumerate(products)}
    sims = e[rows] @ e[gallery].T
    best = np.full((len(rows), len(products)), -2.0)
    for j, g in enumerate(gallery):
        k = index[meta[g]["product_id"]]
        best[:, k] = np.maximum(best[:, k], sims[:, j])
    return products, best


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("vision", type=Path)
    parser.add_argument("embeddings", type=Path)
    parser.add_argument("model_out", type=Path)
    parser.add_argument("relevance_out", type=Path)
    parser.add_argument("--model-version", required=True)
    parser.add_argument("--unknown-cap", type=float, default=6 / 57, help="max dev unknown acceptance (C's dev rate)")
    parser.add_argument("--max-gap", type=float, default=0.15, help="score gap chosen on dev")
    parser.add_argument("--min-category-ratio", type=float, default=0.1, help="category filter chosen on dev")
    parser.add_argument("--fallback-confidence", type=float, default=0.9, help="category fallback chosen on dev")
    args = parser.parse_args()

    data = np.load(args.embeddings)
    meta = [json.loads(m) for m in data["meta"]]
    plain = [i for i, m in enumerate(meta) if not m["variant"] and m["split"] != "final"]
    gallery = [i for i in plain if meta[i]["domain"] == "catalog"]
    train = [i for i in plain if meta[i]["split"] == "train" and meta[i]["domain"] == "photo"]
    dev = [i for i in plain if meta[i]["split"] == "dev"]

    fit = data["emb"][train + gallery].astype(np.float64)
    mean = fit.mean(0)
    projection = np.linalg.svd(fit - mean, full_matrices=False)[2][:DIM]
    z = (data["emb"] - mean) @ projection.T
    z /= np.linalg.norm(z, axis=1, keepdims=True)

    classes = sorted({meta[i]["category"] for i in train + gallery})
    ci = {c: k for k, c in enumerate(classes)}
    torch.manual_seed(0)
    x = torch.tensor(z[train + gallery], dtype=torch.float32)
    y = torch.tensor([ci[meta[i]["category"]] for i in train + gallery])
    head = torch.nn.Linear(DIM, len(classes))
    opt = torch.optim.AdamW(head.parameters(), lr=1e-2, weight_decay=1e-3)
    counts = torch.bincount(y, minlength=len(classes)).float()
    weights = (counts.sum() / (counts + 1)) ** 0.5
    for _ in range(400):
        opt.zero_grad()
        torch.nn.functional.cross_entropy(head(x * SCALE), y, weight=weights).backward()
        opt.step()
    with torch.no_grad():
        prob = torch.softmax(head(torch.tensor(z[dev], dtype=torch.float32) * SCALE), 1).numpy()

    truth = [meta[i]["category"] for i in dev]
    known = [k for k, t in enumerate(truth) if t != OTHER]
    unknown = [k for k, t in enumerate(truth) if t == OTHER]
    mass = 1 - prob[:, ci[OTHER]]
    products, sims = product_sims(z, gallery, meta, dev)
    pcat = {meta[i]["product_id"]: meta[i]["category"] for i in gallery}
    cap = int(args.unknown_cap * len(unknown) + 1e-9)
    min_mass = next(float(t) for t in np.linspace(0, 1, 201) if sum(mass[k] >= t for k in unknown) <= cap)
    top = sims.max(1)
    floor = 0.0
    for f in np.linspace(0, 0.3, 61):  # highest floor that rejects no further known photo
        if sum(mass[k] >= min_mass and top[k] < f for k in known) == 0:
            floor = float(f)

    def top1(weight: float) -> int:
        hits = 0
        for k in known:
            score = sims[k] + weight * np.array([prob[k][ci[pcat[p]]] for p in products])
            hits += pcat[products[int(np.argmax(score))]] == truth[k]
        return hits

    weight = max((0.0, 0.1, 0.2, 0.3, 0.5, 1.0), key=lambda w: (top1(w), -w))
    accepted = [k for k in range(len(dev)) if mass[k] >= min_mass and top[k] >= floor]
    report = {
        "devKnown": len(known),
        "devUnknown": len(unknown),
        "minElectronicsMass": min_mass,
        "minTopSimilarity": floor,
        "categoryRerankWeight": weight,
        "devCategoryTop1": top1(weight),
        "devUnknownAccepted": sum(truth[k] == OTHER for k in accepted),
        "devKnownRejected": sum(truth[k] != OTHER and k not in accepted for k in range(len(dev))),
    }

    out = args.model_out
    (out / "vision").mkdir(parents=True, exist_ok=True)
    for f in sorted(args.vision.glob("model-*.safetensors")):
        shutil.copyfile(f, out / "vision" / f.name)
    save_file(
        {"mean": torch.tensor(mean, dtype=torch.float32), "matrix": torch.tensor(projection, dtype=torch.float32)},
        str(out / "projection.safetensors"),
    )
    files = sorted([*(out / "vision").glob("*.safetensors"), out / "projection.safetensors"])
    manifest = {p.relative_to(out).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
    (out / "weights.json").write_text(json.dumps(manifest, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    digest = hashlib.sha256((out / "weights.json").read_bytes()).hexdigest()
    descriptor = {
        "name": "electrohub-visual-search",
        "modelVersion": args.model_version,
        "embeddingVersion": f"{args.model_version}-{digest[:12]}",
        "preprocessVersion": "siglip2-rgb-r224-bilinear-norm05-v1",
        "embeddingDimension": DIM,
        "artifactFormat": "safetensors",
        "artifactSha256": digest,
    }
    (out / "descriptor.json").write_text(json.dumps(descriptor, indent=2) + "\n", encoding="utf-8")

    rel = args.relevance_out
    rel.mkdir(parents=True, exist_ok=True)
    save_file(
        {"weight": (head.weight.detach() * SCALE).contiguous(), "bias": head.bias.detach().contiguous()},
        str(rel / "head.safetensors"),
    )
    (rel / "relevance.json").write_text(
        json.dumps(
            {
                "relevanceVersion": f"{args.model_version}-category-head",
                "backboneModelVersion": args.model_version,
                "headSha256": hashlib.sha256((rel / "head.safetensors").read_bytes()).hexdigest(),
                "numClasses": len(classes),
                "electronicsClassIndices": [i for i, c in enumerate(classes) if c != OTHER],
                "categoryClassIndices": {c: [i] for i, c in enumerate(classes) if c != OTHER},
                "minElectronicsMass": round(min_mass, 4),
                "maxScoreGap": args.max_gap,
                "categoryRerankWeight": weight,
                "minTopSimilarity": round(floor, 4),
                "minCategoryRatio": args.min_category_ratio,
                "categoryFallbackConfidence": args.fallback_confidence,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"descriptor": descriptor, "devSelection": report}, indent=1))


if __name__ == "__main__":
    main()
