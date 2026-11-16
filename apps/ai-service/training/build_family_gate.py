"""Fit the supported-family evidence gate for candidate D and write a new versioned relevance artifact (Task 04.2-Q).

The gate is one logistic unit over the photo's L2-normalised 768-d SigLIP 2 pooled embedding plus three scalars:
log text support (the best sigmoid(scale * cos + bias) over the supported-family prompts of
training/taxonomy/device_families.json, divided by 5), the head's largest catalog-class probability and the best
catalog similarity. Inputs are multiplied by 10 before the unit, as during development. Positives are labelled training
photos of stocked products and stocked dev photos; negatives are training "other" photos and the dev unsupported
families and unrelated objects. Unsupported family names are never inputs. The threshold must come from the
family-disjoint development folds (TASK_04.2_IMPLEMENTATION_EVIDENCE.md), never from a final benchmark.

    python training/build_family_gate.py models/relevance-siglip2-d1 models/relevance-siglip2-d2 \
        --encodings <siglip2_b16.npz> --dev <dev4_raw768.npz> <dev5_raw768.npz> --text <text_v1.npz> \
        --projection models/siglip2-b16-p256-d1/projection.safetensors --threshold 0.3
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path

import numpy as np
import torch
from safetensors.numpy import load_file
from safetensors.torch import save_file

INPUT_SCALE = 10.0
TEXT_DIVISOR = 5.0


def norm(x: np.ndarray) -> np.ndarray:
    return x / np.linalg.norm(x, axis=1, keepdims=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path, help="existing relevance artifact (relevance.json + head.safetensors)")
    parser.add_argument("out", type=Path)
    parser.add_argument("--encodings", type=Path, required=True)
    parser.add_argument("--dev", type=Path, nargs="+", required=True)
    parser.add_argument("--text", type=Path, required=True)
    parser.add_argument("--projection", type=Path, required=True)
    parser.add_argument("--threshold", type=float, required=True)
    parser.add_argument("--version", default="siglip2-b16-p256-d1-family-gate-v1")
    args = parser.parse_args()

    rel = json.loads((args.source / "relevance.json").read_text(encoding="utf-8"))
    head = load_file(str(args.source / "head.safetensors"))
    proj = load_file(str(args.projection))
    text = np.load(args.text)
    supported = text["text"][text["kind"] == "supported"].astype(np.float64)
    scale, bias = float(text["scale"]), float(text["bias"])
    elec = rel["electronicsClassIndices"]

    enc = np.load(args.encodings)
    meta = [json.loads(m) for m in enc["meta"]]
    emb = norm(enc["emb"].astype(np.float64))
    gallery = emb[[i for i, m in enumerate(meta) if m["domain"] == "catalog" and not m["variant"]]]
    train = [i for i, m in enumerate(meta) if m["split"] == "train" and m["domain"] == "photo" and not m["variant"]]
    zg = norm((gallery - proj["mean"]) @ proj["matrix"].T)

    def features(raw: np.ndarray) -> np.ndarray:
        z = norm((raw - proj["mean"]) @ proj["matrix"].T)
        logits = z @ head["weight"].T + head["bias"]
        p = np.exp(logits - logits.max(1, keepdims=True))
        p /= p.sum(1, keepdims=True)
        support = (1 / (1 + np.exp(-(scale * (raw @ supported.T) + bias)))).max(1)
        return np.column_stack([raw, np.log(support + 1e-6) / TEXT_DIVISOR, p[:, elec].max(1), (z @ zg.T).max(1)])

    pos = [emb[[i for i in train if meta[i]["category"] != "other"]]]
    neg = [emb[[i for i in train if meta[i]["category"] == "other"]]]
    for path in args.dev:
        d = np.load(path)
        kinds = np.array([json.loads(m)["class"].split(".")[0] for m in d["meta"]])
        raw = norm(d["emb"].astype(np.float64))
        pos.append(raw[kinds == "stocked"])
        neg.append(raw[kinds != "stocked"])
    xp, xn = features(np.vstack(pos)), features(np.vstack(neg))

    torch.manual_seed(0)
    x = torch.tensor(np.vstack([xp, xn]), dtype=torch.float32)
    y = torch.tensor([1.0] * len(xp) + [0.0] * len(xn))
    w = torch.where(y > 0, 0.5 / len(xp), 0.5 / len(xn)) * len(y)
    unit = torch.nn.Linear(x.shape[1], 1)
    opt = torch.optim.AdamW(unit.parameters(), lr=1e-2, weight_decay=1e-3)
    for _ in range(600):
        opt.zero_grad()
        torch.nn.functional.binary_cross_entropy_with_logits(unit(x * INPUT_SCALE)[:, 0], y, weight=w).backward()
        opt.step()

    args.out.mkdir(parents=True, exist_ok=False)
    shutil.copyfile(args.source / "head.safetensors", args.out / "head.safetensors")
    gate_file = args.out / "family_gate.safetensors"
    save_file(
        {
            "supported_text": torch.tensor(supported, dtype=torch.float32).contiguous(),
            "weight": unit.weight.detach()[0].contiguous(),
            "bias": unit.bias.detach().contiguous(),
            "text_calibration": torch.tensor([scale, bias], dtype=torch.float32),
        },
        str(gate_file),
    )
    rel.update(
        relevanceVersion=args.version,
        familyGateSha256=hashlib.sha256(gate_file.read_bytes()).hexdigest(),
        minFamilyEvidence=args.threshold,
    )
    (args.out / "relevance.json").write_text(json.dumps(rel, indent=2) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {"positives": len(xp), "negatives": len(xn), "prompts": len(supported), "sha256": rel["familyGateSha256"]}
        )
    )


if __name__ == "__main__":
    main()
