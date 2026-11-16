"""Manifest-driven image datasets, deterministic transforms and the P x K family sampler."""

from __future__ import annotations

import csv
import random
from collections import defaultdict
from collections.abc import Callable, Iterator
from pathlib import Path

import torch
from embedding_network import CROP_SIZE, IMAGENET_MEAN, IMAGENET_STD, preprocess_image
from PIL import Image, ImageOps
from torch.utils.data import Dataset, Sampler
from torchvision import transforms

MANIFEST_FIELDS = ("image_id", "path", "family", "category", "capture_group_id", "source_family_id")

# The serving transform itself (PREPROCESS_VERSION), shared with app/models/efficientnet_loader.py and ingestion.
eval_transform = preprocess_image

# Training-only augmentation: framing, lighting and mild perspective changes a phone photo of a product would show.
train_transform = transforms.Compose(
    [
        transforms.RandomResizedCrop(CROP_SIZE, scale=(0.55, 1.0), ratio=(0.75, 1.33), antialias=True),
        transforms.RandomHorizontalFlip(),
        transforms.RandomApply([transforms.ColorJitter(0.3, 0.3, 0.2, 0.03)], p=0.8),
        transforms.RandomPerspective(distortion_scale=0.15, p=0.3),
        transforms.ToTensor(),
        transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD),
    ]
)


def read_manifest(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    missing = [field for field in MANIFEST_FIELDS if rows and field not in rows[0]]
    if missing:
        raise ValueError(f"{path.name} lacks columns {missing}")
    return rows


def load_rgb(path: Path) -> Image.Image:
    with Image.open(path) as image:
        image = ImageOps.exif_transpose(image)
        if image.mode in ("RGBA", "LA", "P"):
            image = image.convert("RGBA")
            canvas = Image.new("RGB", image.size, (255, 255, 255))
            canvas.paste(image, mask=image.getchannel("A"))
            return canvas
        return image.convert("RGB")


class ManifestDataset(Dataset[tuple[torch.Tensor, int]]):
    def __init__(
        self,
        rows: list[dict[str, str]],
        image_root: Path,
        label_index: dict[str, int],
        transform: Callable[[Image.Image], torch.Tensor],
    ) -> None:
        self.rows = rows
        self.root = image_root
        self.label_index = label_index
        self.transform = transform

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, index: int) -> tuple[torch.Tensor, int]:
        row = self.rows[index]
        return self.transform(load_rgb(self.root / row["path"])), self.label_index.get(row["family"], -1)


class FamilyBatchSampler(Sampler[list[int]]):
    """Yields batches of P families x K images so every anchor has in-batch positives (sampling with replacement
    inside a family when it has fewer than K images)."""

    def __init__(
        self, labels: list[int], families_per_batch: int, images_per_family: int, batches: int, seed: int
    ) -> None:
        self.by_label: dict[int, list[int]] = defaultdict(list)
        for index, label in enumerate(labels):
            self.by_label[label].append(index)
        self.usable = sorted(label for label, items in self.by_label.items() if len(items) >= 2)
        if len(self.usable) < 2:
            raise ValueError("need at least two families with two or more training images")
        self.p = min(families_per_batch, len(self.usable))
        self.k = images_per_family
        self.batches = batches
        self.rng = random.Random(seed)  # noqa: S311 - reproducible batch sampling, not security

    def __len__(self) -> int:
        return self.batches

    def __iter__(self) -> Iterator[list[int]]:
        for _ in range(self.batches):
            batch: list[int] = []
            for label in self.rng.sample(self.usable, self.p):
                items = self.by_label[label]
                batch.extend(
                    self.rng.sample(items, self.k) if len(items) >= self.k else self.rng.choices(items, k=self.k)
                )
            yield batch
