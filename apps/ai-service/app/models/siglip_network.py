"""SigLIP 2 B/16-224 vision tower in plain PyTorch (Task 04.2-Q candidate D).

Mirrors the published ``SiglipVisionModel`` layout (12 pre-norm transformer layers, GELU-tanh MLP, LayerNorm eps 1e-6,
attention-pooling head), so its weights load with ``load_state_dict(strict=True)`` from safetensors and no
``transformers`` dependency or remote code is needed. Parity with the reference implementation is checked against
embeddings produced by ``transformers`` for the same images (TASK_04.2_IMPLEMENTATION_EVIDENCE.md).

Preprocessing (``PREPROCESS_VERSION``): RGB, bilinear resize to 224 x 224 (no crop), scale to [0, 1], normalise with
mean = std = 0.5.
"""

from __future__ import annotations

from typing import Final

import torch
from PIL import Image
from torch import nn

PREPROCESS_VERSION: Final = "siglip2-rgb-r224-bilinear-norm05-v1"
IMAGE_SIZE: Final = 224
PATCH: Final = 16
HIDDEN: Final = 768
HEADS: Final = 12
LAYERS: Final = 12
MLP: Final = 3072
EPS: Final = 1e-6


class _Mlp(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.fc1 = nn.Linear(HIDDEN, MLP)
        self.fc2 = nn.Linear(MLP, HIDDEN)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        out: torch.Tensor = self.fc2(nn.functional.gelu(self.fc1(x), approximate="tanh"))
        return out


class _Attention(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.q_proj = nn.Linear(HIDDEN, HIDDEN)
        self.k_proj = nn.Linear(HIDDEN, HIDDEN)
        self.v_proj = nn.Linear(HIDDEN, HIDDEN)
        self.out_proj = nn.Linear(HIDDEN, HIDDEN)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        batch, tokens, _ = x.shape

        def heads(t: torch.Tensor) -> torch.Tensor:
            return t.view(batch, tokens, HEADS, HIDDEN // HEADS).transpose(1, 2)

        q, k, v = heads(self.q_proj(x)), heads(self.k_proj(x)), heads(self.v_proj(x))
        out = nn.functional.scaled_dot_product_attention(q, k, v)
        projected: torch.Tensor = self.out_proj(out.transpose(1, 2).reshape(batch, tokens, HIDDEN))
        return projected


class _Layer(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.layer_norm1 = nn.LayerNorm(HIDDEN, eps=EPS)
        self.self_attn = _Attention()
        self.layer_norm2 = nn.LayerNorm(HIDDEN, eps=EPS)
        self.mlp = _Mlp()

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = x + self.self_attn(self.layer_norm1(x))
        out: torch.Tensor = x + self.mlp(self.layer_norm2(x))
        return out


class _Embeddings(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.patch_embedding = nn.Conv2d(3, HIDDEN, kernel_size=PATCH, stride=PATCH)
        self.position_embedding = nn.Embedding((IMAGE_SIZE // PATCH) ** 2, HIDDEN)

    def forward(self, pixels: torch.Tensor) -> torch.Tensor:
        patches = self.patch_embedding(pixels).flatten(2).transpose(1, 2)
        out: torch.Tensor = patches + self.position_embedding.weight.unsqueeze(0)
        return out


class _Encoder(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.layers = nn.ModuleList(_Layer() for _ in range(LAYERS))


class _PoolingHead(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.probe = nn.Parameter(torch.zeros(1, 1, HIDDEN))
        self.attention = nn.MultiheadAttention(HIDDEN, HEADS, batch_first=True)
        self.layernorm = nn.LayerNorm(HIDDEN, eps=EPS)
        self.mlp = _Mlp()

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        pooled = self.attention(self.probe.expand(x.shape[0], -1, -1), x, x, need_weights=False)[0]
        out: torch.Tensor = (pooled + self.mlp(self.layernorm(pooled)))[:, 0]
        return out


class SiglipVision(nn.Module):
    """Image -> 768-d pooled embedding (the ``image_embeds`` of SigLIP before normalisation)."""

    def __init__(self) -> None:
        super().__init__()
        self.embeddings = _Embeddings()
        self.encoder = _Encoder()
        self.post_layernorm = nn.LayerNorm(HIDDEN, eps=EPS)
        self.head = _PoolingHead()

    def forward(self, pixels: torch.Tensor) -> torch.Tensor:
        x = self.embeddings(pixels)
        for layer in self.encoder.layers:
            x = layer(x)
        out: torch.Tensor = self.head(self.post_layernorm(x))
        return out


def preprocess(image: Image.Image) -> torch.Tensor:
    """PREPROCESS_VERSION transform as a batch of one."""
    resized = image.convert("RGB").resize((IMAGE_SIZE, IMAGE_SIZE), Image.Resampling.BILINEAR)
    pixels = torch.frombuffer(bytearray(resized.tobytes()), dtype=torch.uint8).view(IMAGE_SIZE, IMAGE_SIZE, 3)
    return ((pixels.permute(2, 0, 1).float() / 255.0 - 0.5) / 0.5).unsqueeze(0)
