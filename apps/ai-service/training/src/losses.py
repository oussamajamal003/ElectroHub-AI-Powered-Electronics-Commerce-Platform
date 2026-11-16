"""Supervised contrastive loss (Khosla et al. 2020) over appearance-family labels.

Positives are other images of the same appearance family; every other family in the batch is a negative. Colour and
storage variants share one family label, so visually indistinguishable SKUs are never pushed apart.
"""

from __future__ import annotations

import torch
from torch import nn


class SupConLoss(nn.Module):
    def __init__(self, temperature: float = 0.1) -> None:
        super().__init__()
        self.temperature = temperature

    def forward(self, embeddings: torch.Tensor, labels: torch.Tensor) -> torch.Tensor:
        if embeddings.shape[0] != labels.shape[0]:
            raise ValueError("embeddings and labels differ in batch size")
        logits = embeddings @ embeddings.T / self.temperature
        self_mask = torch.eye(labels.shape[0], dtype=torch.bool, device=labels.device)
        positive = (labels[:, None] == labels[None, :]) & ~self_mask
        anchors = positive.any(dim=1)
        if not anchors.any():
            raise ValueError("batch has no positive pairs; use the P x K sampler")
        logits = logits.masked_fill(self_mask, float("-inf"))
        log_prob = logits - torch.logsumexp(logits, dim=1, keepdim=True)
        positive_log_prob = log_prob.masked_fill(~positive, 0.0).sum(dim=1) / positive.sum(dim=1).clamp(min=1)
        return -positive_log_prob[anchors].mean()
