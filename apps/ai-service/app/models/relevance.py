"""Calibrated no-match gate for image search (Task 04.2-Q).

The approved encoder's backbone is the unmodified torchvision EfficientNet-B0 ImageNet backbone, so the matching
ImageNet classifier head gives an independent signal of *what kind of object* a photo shows, at the cost of one
1280x1000 matrix product on features that are already computed. A query is answered with no products when the
softmax mass on electronics classes is below ``minElectronicsMass``; accepted queries keep only products whose
similarity is within ``maxScoreGap`` of the best one. The optional ``categoryRerankWeight`` (default 0.5, the value
chosen for the first gate) tells Express how strongly to reorder accepted products by the category hints; each gate
carries the weight selected for it on its own dev split. The optional ``minTopSimilarity`` (default 0, off) also
answers with no products when even the best catalog match is less similar than that. The optional
``minCategoryRatio`` (default 0, off) tells Express to drop accepted products whose category hint is below that
fraction of the strongest hint. The optional ``categoryFallbackConfidence`` (default 0, off): when the gate accepts the
photo and the strongest category hint reaches it, the service also returns the ``FALLBACK_DEPTH`` nearest products
without the gap cut, so Express can answer from the predicted category if the regular list ends up empty. All values
come from the calibration split recorded in TASK_04.2_IMPLEMENTATION_EVIDENCE.md; none is a probability of a correct
match.

The optional ``minFamilyEvidence`` with ``familyGateSha256`` (candidate D only) adds a supported-family check: a
logistic unit over the raw pooled image embedding, its text support for the supported-family prompts, the head's
largest catalog-class probability and the best catalog similarity (training/build_family_gate.py). Below the threshold
the query gets no products and no category fallback, so an unsupported kind of device is answered honestly instead of
with its nearest stocked category.

The artifact directory holds ``relevance.json`` and ``head.safetensors`` (verified by SHA-256 before loading).
"""

from __future__ import annotations

import hashlib
import hmac
import json
import math
import re
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Final

import torch
from safetensors.torch import load_file

from app.models.efficientnet_loader import ArtifactRejectedError
from app.schemas.common import RankedProduct

RELEVANCE_FILENAME: Final = "relevance.json"
HEAD_FILENAME: Final = "head.safetensors"
FAMILY_GATE_FILENAME: Final = "family_gate.safetensors"
FAMILY_INPUT_SCALE: Final = 10.0
FAMILY_TEXT_DIVISOR: Final = 5.0
MAX_CLASSES: Final = 1000
MAX_CATEGORY_HINTS: Final = 32
# Hints below this probability carry no ranking information worth sending.
MIN_HINT_PROBABILITY: Final = 0.01
DEFAULT_CATEGORY_WEIGHT: Final = 0.5
MAX_CATEGORY_WEIGHT: Final = 2.0
_CATEGORY_SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


@dataclass(frozen=True, slots=True)
class Assessment:
    """What the gate learned about one photo: electronics mass and per-category probabilities (descending)."""

    electronics_mass: float
    category_hints: tuple[tuple[str, float], ...]
    # Family-gate logit without its best-similarity term; None when no family gate is configured.
    family_logit: float | None = None


_KEYS: Final = frozenset(
    {
        "relevanceVersion",
        "backboneModelVersion",
        "headSha256",
        "numClasses",
        "electronicsClassIndices",
        "categoryClassIndices",
        "minElectronicsMass",
        "maxScoreGap",
    }
)
_OPTIONAL_KEYS: Final = frozenset(
    {
        "categoryRerankWeight",
        "minTopSimilarity",
        "minCategoryRatio",
        "categoryFallbackConfidence",
        "familyGateSha256",
        "minFamilyEvidence",
    }
)
FALLBACK_DEPTH: Final = 48


@dataclass(frozen=True, slots=True)
class FamilyGate:
    """Supported-family evidence (see module docstring); weights over [raw, text, confidence, similarity]."""

    supported_text: torch.Tensor
    weight: torch.Tensor
    bias: float
    text_scale: float
    text_bias: float
    threshold: float

    def base_logit(self, pooled: torch.Tensor, probabilities: torch.Tensor, electronics: torch.Tensor) -> float:
        raw_dim = self.supported_text.shape[1]
        support = float(torch.sigmoid(self.text_scale * (pooled[0] @ self.supported_text.T) + self.text_bias).max())
        confidence = float(probabilities[electronics].max())
        inputs = torch.cat([pooled[0], torch.tensor([math.log(support + 1e-6) / FAMILY_TEXT_DIVISOR, confidence])])
        value = float(FAMILY_INPUT_SCALE * (inputs @ self.weight[: raw_dim + 2])) + self.bias
        return value if math.isfinite(value) else -math.inf

    def accepts(self, base_logit: float, top_similarity: float) -> bool:
        logit = base_logit + FAMILY_INPUT_SCALE * float(self.weight[-1]) * top_similarity
        return math.isfinite(logit) and 1 / (1 + math.exp(-max(min(logit, 60.0), -60.0))) >= self.threshold


@dataclass(frozen=True, slots=True)
class RelevanceGate:
    version: str
    backbone_model_version: str
    weight: torch.Tensor
    bias: torch.Tensor
    electronics: torch.Tensor
    categories: tuple[tuple[str, torch.Tensor], ...]
    min_electronics_mass: float
    max_score_gap: float
    category_weight: float = DEFAULT_CATEGORY_WEIGHT
    min_top_similarity: float = 0.0
    min_category_ratio: float = 0.0
    category_fallback_confidence: float = 0.0
    family_gate: FamilyGate | None = None

    def assess(self, features: torch.Tensor, pooled: torch.Tensor | None = None) -> Assessment:
        """Electronics mass and category hints for one (1, feature_dim) feature row.

        ``pooled`` is the raw normalised encoder embedding the family gate needs; without it there is no family logit.
        """
        probabilities = torch.softmax(features @ self.weight.T + self.bias, dim=1)[0]
        mass = float(probabilities[self.electronics].sum())
        hints = []
        for slug, indices in self.categories:
            value = float(probabilities[indices].sum())
            if math.isfinite(value) and value >= MIN_HINT_PROBABILITY:
                hints.append((slug, round(min(value, 1.0), 6)))
        hints.sort(key=lambda hint: (-hint[1], hint[0]))
        family = None
        if self.family_gate is not None and pooled is not None:
            family = self.family_gate.base_logit(pooled, probabilities, self.electronics)
        return Assessment(mass if math.isfinite(mass) else 0.0, tuple(hints[:MAX_CATEGORY_HINTS]), family)

    def family_supported(self, assessment: Assessment, top_similarity: float | None) -> bool:
        """False when a configured family gate finds no supported-family evidence (or could not be evaluated)."""
        if self.family_gate is None:
            return True
        if assessment.family_logit is None or top_similarity is None:
            return False
        return self.family_gate.accepts(assessment.family_logit, top_similarity)

    def electronics_mass(self, features: torch.Tensor) -> float:
        return self.assess(features).electronics_mass

    def select(self, matches: Sequence[RankedProduct], electronics_mass: float) -> list[RankedProduct]:
        """Drop everything for a non-electronics photo; otherwise keep the leading cluster of close scores."""
        if electronics_mass < self.min_electronics_mass or not matches or matches[0].score < self.min_top_similarity:
            return []
        floor = matches[0].score - self.max_score_gap
        return [match for match in matches if match.score >= floor]

    def fallback(self, assessment: Assessment) -> bool:
        """Whether to also return the ungapped candidates for a confident category (off when the setting is 0)."""
        return (
            self.category_fallback_confidence > 0
            and assessment.electronics_mass >= self.min_electronics_mass
            and bool(assessment.category_hints)
            and assessment.category_hints[0][1] >= self.category_fallback_confidence
        )


def load_relevance_gate(directory: Path, *, model_version: str, feature_dim: int = 1280) -> RelevanceGate:
    path = directory / RELEVANCE_FILENAME
    if not path.is_file() or path.stat().st_size > 64 * 1024:
        raise ArtifactRejectedError("relevance.json is missing or too large")
    try:
        raw: object = json.loads(path.read_bytes().decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ArtifactRejectedError("relevance.json is not valid UTF-8 JSON") from exc
    if not isinstance(raw, dict) or not _KEYS <= set(raw) <= _KEYS | _OPTIONAL_KEYS:
        raise ArtifactRejectedError("relevance.json must contain exactly the documented keys")
    if raw["backboneModelVersion"] != model_version:
        raise ArtifactRejectedError("relevance gate was calibrated for a different model version")
    classes = raw["numClasses"]
    if not isinstance(classes, int) or not 2 <= classes <= MAX_CLASSES:
        raise ArtifactRejectedError("numClasses is invalid")
    indices = raw["electronicsClassIndices"]
    if (
        not isinstance(indices, list)
        or not indices
        or not all(isinstance(i, int) and 0 <= i < classes for i in indices)
    ):
        raise ArtifactRejectedError("electronicsClassIndices is invalid")
    category_map = raw["categoryClassIndices"]
    if (
        not isinstance(category_map, dict)
        or len(category_map) > MAX_CATEGORY_HINTS
        or not all(
            isinstance(slug, str)
            and _CATEGORY_SLUG.fullmatch(slug)
            and isinstance(members, list)
            and members
            and all(isinstance(i, int) and 0 <= i < classes for i in members)
            for slug, members in category_map.items()
        )
    ):
        raise ArtifactRejectedError("categoryClassIndices is invalid")
    min_mass, max_gap = raw["minElectronicsMass"], raw["maxScoreGap"]
    if not all(isinstance(v, (int, float)) and 0.0 <= v <= 1.0 for v in (min_mass, max_gap)):
        raise ArtifactRejectedError("relevance thresholds must be within [0, 1]")

    weight = raw.get("categoryRerankWeight", DEFAULT_CATEGORY_WEIGHT)
    if isinstance(weight, bool) or not isinstance(weight, (int, float)) or not 0.0 <= weight <= MAX_CATEGORY_WEIGHT:
        raise ArtifactRejectedError("categoryRerankWeight must be within [0, 2]")

    floor = raw.get("minTopSimilarity", 0.0)
    if isinstance(floor, bool) or not isinstance(floor, (int, float)) or not 0.0 <= floor <= 1.0:
        raise ArtifactRejectedError("minTopSimilarity must be within [0, 1]")

    ratio = raw.get("minCategoryRatio", 0.0)
    if isinstance(ratio, bool) or not isinstance(ratio, (int, float)) or not 0.0 <= ratio <= 1.0:
        raise ArtifactRejectedError("minCategoryRatio must be within [0, 1]")

    confidence = raw.get("categoryFallbackConfidence", 0.0)
    if isinstance(confidence, bool) or not isinstance(confidence, (int, float)) or not 0.0 <= confidence <= 1.0:
        raise ArtifactRejectedError("categoryFallbackConfidence must be within [0, 1]")

    head = directory / HEAD_FILENAME
    if not head.is_file() or head.stat().st_size > 16 * 1024 * 1024:
        raise ArtifactRejectedError("head.safetensors is missing or too large")
    if not hmac.compare_digest(hashlib.sha256(head.read_bytes()).hexdigest(), str(raw["headSha256"])):
        raise ArtifactRejectedError("head.safetensors does not match relevance.json")
    state = load_file(str(head), device="cpu")
    matrix, bias = state.get("weight"), state.get("bias")
    if matrix is None or bias is None:
        raise ArtifactRejectedError("head.safetensors has unexpected tensors")
    if tuple(matrix.shape) != (classes, feature_dim) or tuple(bias.shape) != (classes,):
        raise ArtifactRejectedError("head.safetensors has unexpected tensors")
    return RelevanceGate(
        version=str(raw["relevanceVersion"]),
        backbone_model_version=model_version,
        weight=matrix.float().clone(),
        bias=bias.float().clone(),
        electronics=torch.tensor(sorted(set(indices)), dtype=torch.long),
        categories=tuple(
            (slug, torch.tensor(sorted(set(members)), dtype=torch.long))
            for slug, members in sorted(category_map.items())
        ),
        min_electronics_mass=float(min_mass),
        max_score_gap=float(max_gap),
        category_weight=float(weight),
        min_top_similarity=float(floor),
        min_category_ratio=float(ratio),
        category_fallback_confidence=float(confidence),
        family_gate=_load_family_gate(directory, raw),
    )


def _load_family_gate(directory: Path, raw: dict[str, object]) -> FamilyGate | None:
    if "familyGateSha256" not in raw and "minFamilyEvidence" not in raw:
        return None
    threshold = raw.get("minFamilyEvidence")
    if isinstance(threshold, bool) or not isinstance(threshold, (int, float)) or not 0.0 < threshold < 1.0:
        raise ArtifactRejectedError("minFamilyEvidence must be within (0, 1)")
    path = directory / FAMILY_GATE_FILENAME
    if not path.is_file() or path.stat().st_size > 4 * 1024 * 1024:
        raise ArtifactRejectedError("family_gate.safetensors is missing or too large")
    if not hmac.compare_digest(hashlib.sha256(path.read_bytes()).hexdigest(), str(raw.get("familyGateSha256"))):
        raise ArtifactRejectedError("family_gate.safetensors does not match relevance.json")
    state = load_file(str(path), device="cpu")
    text, weight, bias, calibration = (state.get(k) for k in ("supported_text", "weight", "bias", "text_calibration"))
    if text is None or weight is None or bias is None or calibration is None:
        raise ArtifactRejectedError("family_gate.safetensors has unexpected tensors")
    if (
        text.dim() != 2
        or not 1 <= text.shape[0] <= 256
        or tuple(weight.shape) != (text.shape[1] + 3,)
        or tuple(bias.shape) != (1,)
        or tuple(calibration.shape) != (2,)
        or not all(bool(torch.isfinite(t).all()) for t in (text, weight, bias, calibration))
    ):
        raise ArtifactRejectedError("family_gate.safetensors has unexpected tensors")
    return FamilyGate(
        supported_text=text.float().clone(),
        weight=weight.float().clone(),
        bias=float(bias[0]),
        text_scale=float(calibration[0]),
        text_bias=float(calibration[1]),
        threshold=float(threshold),
    )
