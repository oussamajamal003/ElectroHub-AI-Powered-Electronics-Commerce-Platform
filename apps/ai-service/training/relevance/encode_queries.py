"""Encode labelled query photos with the approved encoder (exact serving path) and keep backbone features for the
pretrained ImageNet head. Output: queries.npz (emb 256, feat 1280, labels)."""

import csv
import sys
from pathlib import Path

import numpy as np
import torch

from app.models.efficientnet_loader import _preprocess, load_efficientnet_encoder
from app.processors.image import decode_image

ROOT = Path("training/.data/kaggle-run2/dataset")
PROBE = Path(sys.argv[1])
OUT = sys.argv[2]
enc = load_efficientnet_encoder(Path("models/effb0-commons-v2"), torch_threads=4)
net = enc._network
cat = {
    r["appearance_family"]: r["category"]
    for r in csv.DictReader(open(ROOT / "manifests/catalog_products.csv", encoding="utf-8"))
}
rows = []
for split in ["validation", "test_queries", "unseen_sku_queries", "unseen_sku_gallery"]:
    for r in csv.DictReader(open(ROOT / f"manifests/{split}.csv", encoding="utf-8")):
        rows.append(
            dict(
                split=split,
                path=str(ROOT / "images" / r["path"]),
                label=r["sku_family"],
                family=r["family"],
                category=r["category"],
                group="in",
            )
        )
for r in csv.DictReader(open(PROBE / "probe.csv", encoding="utf-8")):
    rows.append(
        dict(
            split="probe",
            path=str(PROBE / r["file"]),
            label=r["label"],
            family="",
            category=r["category"],
            group=r["group"],
        )
    )
E, F, keep = [], [], []
for r in rows:
    try:
        img = decode_image(Path(r["path"]).read_bytes(), max_pixels=40_000_000)
    except Exception as e:
        print("skip", r["path"], type(e).__name__)
        continue
    with torch.inference_mode():
        x = _preprocess(img.rgb)
        f = net.backbone_features(x)
        e = torch.nn.functional.normalize(net.projection(f), dim=1)
    E.append(e[0].numpy())
    F.append(f[0].numpy())
    keep.append(r)
np.savez(OUT, emb=np.array(E), feat=np.array(F), meta=np.array([str(k) for k in keep]))
print(len(keep))
