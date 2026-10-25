"""EfficientNet-B0 visual-embedding network shared by offline training and online serving.

The exact same module definition is used to fine-tune on Kaggle and to rebuild the network from exported safetensors
on the CPU service, so parameter names and shapes cannot drift between the two. Preprocessing is versioned here too:
any change to these constants requires a new ``PREPROCESS_VERSION`` (and therefore a new embedding version).
"""

from __future__ import annotations

import numpy as np
import torch
from PIL import Image
from torch import nn
from torchvision.models import efficientnet_b0

EMBEDDING_DIMENSION = 256
BACKBONE_FEATURES = 1280
PREPROCESS_VERSION = "effb0-rgb-r256-c224-imagenet-v1"
RESIZE_SHORTER = 256
CROP_SIZE = 224
IMAGENET_MEAN = (0.485, 0.456, 0.406)
IMAGENET_STD = (0.229, 0.224, 0.225)


def preprocess_image(pixels: Image.Image) -> torch.Tensor:
    """The single deterministic inference transform (PREPROCESS_VERSION) for an RGB image -> (3, 224, 224) tensor.

    Shorter side to RESIZE_SHORTER with Pillow bilinear resampling, integer centre crop, ImageNet normalisation. Used by
    training evaluation, catalog ingestion and online serving alike.
    """
    width, height = pixels.size
    if width <= height:
        size = (RESIZE_SHORTER, max(CROP_SIZE, int(RESIZE_SHORTER * height / width)))
    else:
        size = (max(CROP_SIZE, int(RESIZE_SHORTER * width / height)), RESIZE_SHORTER)
    resized = pixels.resize(size, Image.Resampling.BILINEAR)
    left, top = (size[0] - CROP_SIZE) // 2, (size[1] - CROP_SIZE) // 2
    cropped = resized.crop((left, top, left + CROP_SIZE, top + CROP_SIZE))
    tensor = torch.from_numpy(np.asarray(cropped, dtype=np.float32) / 255.0).permute(2, 0, 1).contiguous()
    mean = torch.tensor(IMAGENET_MEAN, dtype=torch.float32).view(3, 1, 1)
    std = torch.tensor(IMAGENET_STD, dtype=torch.float32).view(3, 1, 1)
    return (tensor - mean) / std


class EmbeddingNetwork(nn.Module):
    """EfficientNet-B0 features -> global average pool -> linear projection -> L2-normalised embedding."""

    def __init__(self, embedding_dimension: int = EMBEDDING_DIMENSION) -> None:
        super().__init__()
        # Weights are always supplied explicitly (ImageNet weights in training, exported safetensors in serving), so
        # constructing the module never downloads anything.
        self.backbone = efficientnet_b0(weights=None).features
        self.pool = nn.AdaptiveAvgPool2d(1)
        self.projection = nn.Linear(BACKBONE_FEATURES, embedding_dimension)

    def backbone_features(self, images: torch.Tensor) -> torch.Tensor:
        return torch.flatten(self.pool(self.backbone(images)), 1)

    def forward(self, images: torch.Tensor) -> torch.Tensor:
        return nn.functional.normalize(self.projection(self.backbone_features(images)), dim=1)
