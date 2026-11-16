"""Export the calibrated no-match gate used by image search (Task 04.2-Q).

Writes ``relevance.json`` and ``head.safetensors`` into the output directory. The head is torchvision's
EfficientNet-B0 IMAGENET1K_V1 classifier, which is valid on the approved encoder only because that encoder's backbone
is byte-identical to the same ImageNet weights (verified: max abs difference 0.0 over 358 tensors). Thresholds come
from the calibration split in docs/tasks/Phase-04/TASK_04.2_IMPLEMENTATION_EVIDENCE.md and must not be retuned on the
held-out test split.

    python training/export_relevance_head.py models/relevance-imagenet-v1
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import torch
from safetensors.torch import save_file
from torchvision.models import EfficientNet_B0_Weights, efficientnet_b0

RELEVANCE_VERSION = "imagenet-electronics-gate-v1"
BACKBONE_MODEL_VERSION = "effb0-commons-v2"
MIN_ELECTRONICS_MASS = 0.08
MAX_SCORE_GAP = 0.10
# ImageNet classes counted as "an electronic or electrical product". Deliberately broader than the catalog so that
# electronics the catalog does not sell still reach retrieval (and are then judged by similarity), while appliances
# such as washers and refrigerators, and non-electronics, are not listed.
ELECTRONICS_CLASSES = (
    "CD player",
    "Polaroid camera",
    "abacus",
    "analog clock",
    "barometer",
    "binoculars",
    "buckle",
    "car mirror",
    "carton",
    "cassette player",
    "cellular telephone",
    "chain",
    "computer keyboard",
    "crossword puzzle",
    "desktop computer",
    "dial telephone",
    "digital clock",
    "digital watch",
    "electric guitar",
    "envelope",
    "hand-held computer",
    "hard disc",
    "harmonica",
    "home theater",
    "iPod",
    "iron",
    "joystick",
    "laptop",
    "lens cap",
    "lighter",
    "loudspeaker",
    "magnetic compass",
    "maraca",
    "microphone",
    "modem",
    "monitor",
    "mouse",
    "notebook",
    "oscilloscope",
    "packet",
    "pay-phone",
    "pencil sharpener",
    "plate rack",
    "power drill",
    "printer",
    "projector",
    "punching bag",
    "radiator",
    "radio",
    "reflex camera",
    "remote control",
    "rule",
    "scale",
    "screen",
    "slide rule",
    "space bar",
    "stopwatch",
    "switch",
    "tape player",
    "television",
    "tripod",
    "typewriter keyboard",
    "web site",
)

# ImageNet classes with a clear ElectroHub catalog counterpart (real category slugs). Their summed probability is sent
# to Express as a category hint; categories without an ImageNet counterpart (CPUs, tablets, smart-home) get none.
CATEGORY_CLASSES = {
    "laptops": ("laptop", "notebook"),
    "smartphones": ("cellular telephone", "hand-held computer", "iPod"),
    "keyboards-mice": ("computer keyboard", "typewriter keyboard", "space bar", "mouse"),
    "monitors": ("monitor", "screen", "desktop computer", "television"),
    "cameras-photography": ("reflex camera", "Polaroid camera", "lens cap"),
    "speakers-audio": ("loudspeaker",),
    "printers-scanners": ("printer",),
    "networking-wifi": ("modem",),
    "gaming": ("joystick",),
    "smartwatches": ("digital watch",),
    "storage-ssds": ("hard disc",),
}


def main(out_dir: Path) -> None:
    weights = EfficientNet_B0_Weights.IMAGENET1K_V1
    names = list(weights.meta["categories"])
    missing = [
        n for n in (*ELECTRONICS_CLASSES, *(c for cs in CATEGORY_CLASSES.values() for c in cs)) if n not in names
    ]
    if missing:
        raise SystemExit(f"unknown ImageNet classes: {missing}")
    classifier = efficientnet_b0(weights=weights).classifier[1]
    out_dir.mkdir(parents=True, exist_ok=True)
    head = out_dir / "head.safetensors"
    save_file(
        {"weight": classifier.weight.detach().contiguous(), "bias": classifier.bias.detach().contiguous()}, str(head)
    )
    descriptor = {
        "relevanceVersion": RELEVANCE_VERSION,
        "backboneModelVersion": BACKBONE_MODEL_VERSION,
        "headSha256": hashlib.sha256(head.read_bytes()).hexdigest(),
        "numClasses": len(names),
        "electronicsClassIndices": sorted(names.index(n) for n in ELECTRONICS_CLASSES),
        "categoryClassIndices": {
            slug: sorted(names.index(n) for n in classes) for slug, classes in sorted(CATEGORY_CLASSES.items())
        },
        "minElectronicsMass": MIN_ELECTRONICS_MASS,
        "maxScoreGap": MAX_SCORE_GAP,
    }
    (out_dir / "relevance.json").write_text(json.dumps(descriptor, indent=2) + "\n", encoding="utf-8")
    print(descriptor["headSha256"], len(descriptor["electronicsClassIndices"]))


if __name__ == "__main__":
    torch.manual_seed(0)
    main(Path(sys.argv[1]))
