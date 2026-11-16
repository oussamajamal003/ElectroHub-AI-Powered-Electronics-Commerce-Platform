import hashlib
import json
from pathlib import Path
from uuid import uuid4

import pytest
import torch
from safetensors.torch import save_file

from app.models.efficientnet_loader import ArtifactRejectedError
from app.models.relevance import Assessment, RelevanceGate, load_relevance_gate
from app.schemas.common import RankedProduct
from app.schemas.image_search import CategoryHint, ImageSearchResult


def _ranked(*scores: float) -> list[RankedProduct]:
    return [RankedProduct(product_id=uuid4(), score=s, rank=i) for i, s in enumerate(scores, start=1)]


def _write(directory: Path, **overrides: object) -> Path:
    weight = torch.zeros(1000, 1280)
    bias = torch.zeros(1000)
    bias[5] = 20.0  # every photo is "class 5"
    save_file({"weight": weight, "bias": bias}, str(directory / "head.safetensors"))
    descriptor = {
        "relevanceVersion": "test-gate-v1",
        "backboneModelVersion": "effb0-test",
        "headSha256": hashlib.sha256((directory / "head.safetensors").read_bytes()).hexdigest(),
        "numClasses": 1000,
        "electronicsClassIndices": [5],
        "categoryClassIndices": {"keyboards-mice": [5], "laptops": [6]},
        "minElectronicsMass": 0.08,
        "maxScoreGap": 0.1,
    } | overrides
    (directory / "relevance.json").write_text(json.dumps(descriptor), encoding="utf-8")
    return directory


def test_gate_measures_electronics_mass_from_backbone_features(tmp_path: Path) -> None:
    gate = load_relevance_gate(_write(tmp_path), model_version="effb0-test")
    assert gate.electronics_mass(torch.zeros(1, 1280)) > 0.99
    (tmp_path / "other").mkdir()
    other = load_relevance_gate(_write(tmp_path / "other", electronicsClassIndices=[6]), model_version="effb0-test")
    assert other.electronics_mass(torch.zeros(1, 1280)) < 0.01


def test_non_electronics_photo_returns_no_products(tmp_path: Path) -> None:
    gate = load_relevance_gate(_write(tmp_path), model_version="effb0-test")
    assert gate.select(_ranked(0.9, 0.8), electronics_mass=0.05) == []


def test_accepted_photo_keeps_only_the_leading_cluster_with_contiguous_ranks(tmp_path: Path) -> None:
    gate = load_relevance_gate(_write(tmp_path), model_version="effb0-test")
    matches = _ranked(0.72, 0.68, 0.62, 0.61, 0.40)
    kept = gate.select(matches, electronics_mass=0.5)
    assert kept == matches[:3]
    assert [m.rank for m in kept] == [1, 2, 3]
    assert gate.select([], electronics_mass=0.9) == []


@pytest.mark.parametrize(
    ("overrides", "version"),
    [
        ({"headSha256": "0" * 64}, "effb0-test"),
        ({}, "effb0-other"),
        ({"electronicsClassIndices": [1000]}, "effb0-test"),
        ({"minElectronicsMass": 1.5}, "effb0-test"),
        ({"extra": True}, "effb0-test"),
        ({"categoryClassIndices": {"Not A Slug": [1]}}, "effb0-test"),
        ({"categoryClassIndices": {"laptops": [1000]}}, "effb0-test"),
        ({"numClasses": 12}, "effb0-test"),
        ({"numClasses": 1}, "effb0-test"),
        ({"categoryRerankWeight": 2.5}, "effb0-test"),
        ({"categoryRerankWeight": True}, "effb0-test"),
        ({"minTopSimilarity": -0.1}, "effb0-test"),
        ({"minCategoryRatio": 1.5}, "effb0-test"),
        ({"minCategoryRatio": True}, "effb0-test"),
        ({"categoryFallbackConfidence": 1.5}, "effb0-test"),
    ],
)
def test_gate_artifact_is_refused_when_invalid(tmp_path: Path, overrides: dict[str, object], version: str) -> None:
    with pytest.raises(ArtifactRejectedError):
        load_relevance_gate(_write(tmp_path, **overrides), model_version=version)


def test_gate_carries_its_dev_selected_category_weight(tmp_path: Path) -> None:
    assert load_relevance_gate(_write(tmp_path), model_version="effb0-test").category_weight == 0.5
    gate = load_relevance_gate(_write(tmp_path, categoryRerankWeight=0), model_version="effb0-test")
    assert gate.category_weight == 0.0


def test_weak_best_match_returns_no_products(tmp_path: Path) -> None:
    gate = load_relevance_gate(_write(tmp_path, minTopSimilarity=0.36), model_version="effb0-test")
    assert gate.select(_ranked(0.35, 0.3), electronics_mass=0.99) == []
    assert [m.score for m in gate.select(_ranked(0.5, 0.45), electronics_mass=0.99)] == [0.5, 0.45]
    assert load_relevance_gate(_write(tmp_path), model_version="effb0-test").min_top_similarity == 0.0


def test_gate_carries_its_category_ratio(tmp_path: Path) -> None:
    assert load_relevance_gate(_write(tmp_path), model_version="effb0-test").min_category_ratio == 0.0
    gate = load_relevance_gate(_write(tmp_path, minCategoryRatio=0.1), model_version="effb0-test")
    assert gate.min_category_ratio == 0.1


def test_category_fallback_is_off_by_default_and_needs_a_confident_accepted_photo(tmp_path: Path) -> None:
    confident = Assessment(0.99, (("tablets", 0.95),))
    assert not load_relevance_gate(_write(tmp_path), model_version="effb0-test").fallback(confident)
    gate = load_relevance_gate(_write(tmp_path, categoryFallbackConfidence=0.9), model_version="effb0-test")
    assert gate.fallback(confident)
    assert not gate.fallback(Assessment(0.99, (("tablets", 0.6),)))
    assert not gate.fallback(Assessment(0.0, (("tablets", 0.95),)))
    assert not gate.fallback(Assessment(0.99, ()))


def test_gate_is_frozen() -> None:
    assert RelevanceGate.__dataclass_params__.frozen  # type: ignore[attr-defined]


def test_assessment_reports_category_hints_in_descending_order(tmp_path: Path) -> None:
    gate = load_relevance_gate(_write(tmp_path), model_version="effb0-test")
    assessment = gate.assess(torch.zeros(1, 1280))
    assert assessment.category_hints[0][0] == "keyboards-mice"
    assert assessment.category_hints[0][1] > 0.99
    # "laptops" is below MIN_HINT_PROBABILITY and is not sent.
    assert [slug for slug, _ in assessment.category_hints] == ["keyboards-mice"]


def _result(hints: list[CategoryHint]) -> ImageSearchResult:
    return ImageSearchResult(matches=[], category_hints=hints, model_version="m1", embedding_version="e1")


def test_result_contract_serialises_category_hints_in_camel_case() -> None:
    body = _result([CategoryHint(category="laptops", probability=0.6)]).model_dump(by_alias=True, mode="json")
    assert body["categoryHints"] == [{"category": "laptops", "probability": 0.6}]
    assert _result([]).model_dump(by_alias=True)["categoryHints"] == []


@pytest.mark.parametrize(
    "hints",
    [
        [{"category": "laptops", "probability": 0.2}, {"category": "laptops", "probability": 0.1}],
        [{"category": "laptops", "probability": 0.2}, {"category": "tablets", "probability": 0.3}],
        [{"category": "laptops", "probability": 0.7}, {"category": "tablets", "probability": 0.6}],
        [{"category": "Laptops", "probability": 0.2}],
        [{"category": "laptops", "probability": 1.2}],
    ],
)
def test_result_contract_rejects_invalid_category_hints(hints: list[dict[str, object]]) -> None:
    with pytest.raises(ValueError):
        ImageSearchResult.model_validate(
            {"matches": [], "categoryHints": hints, "modelVersion": "m1", "embeddingVersion": "e1"}
        )


def _write_family(
    directory: Path,
    *,
    sim_weight: float = 1.0,
    overrides: dict[str, object] | None = None,
) -> Path:
    _write(directory)
    text = torch.zeros(2, 4)
    text[0, 0] = 1.0
    weight = torch.zeros(7)
    weight[-1] = sim_weight  # evidence rises with the best catalog similarity
    save_file(
        {
            "supported_text": text,
            "weight": weight,
            "bias": torch.tensor([-3.0]),
            "text_calibration": torch.tensor([10.0, -5.0]),
        },
        str(directory / "family_gate.safetensors"),
    )
    descriptor = json.loads((directory / "relevance.json").read_text(encoding="utf-8"))
    descriptor |= {
        "familyGateSha256": hashlib.sha256((directory / "family_gate.safetensors").read_bytes()).hexdigest(),
        "minFamilyEvidence": 0.5,
    } | (overrides or {})
    (directory / "relevance.json").write_text(json.dumps(descriptor), encoding="utf-8")
    return directory


def test_family_gate_is_off_without_its_keys(tmp_path: Path) -> None:
    gate = load_relevance_gate(_write(tmp_path), model_version="effb0-test")
    assert gate.family_gate is None
    assert gate.family_supported(gate.assess(torch.zeros(1, 1280)), None)


def test_family_gate_needs_supported_family_evidence(tmp_path: Path) -> None:
    gate = load_relevance_gate(_write_family(tmp_path), model_version="effb0-test")
    assessment = gate.assess(torch.zeros(1, 1280), torch.tensor([[1.0, 0.0, 0.0, 0.0]]))
    assert assessment.family_logit is not None
    assert gate.family_supported(assessment, top_similarity=0.5)  # logit 10*0.5 - 3 > 0
    assert not gate.family_supported(assessment, top_similarity=0.1)  # logit 10*0.1 - 3 < 0
    # Fails closed when the evidence could not be computed.
    assert not gate.family_supported(gate.assess(torch.zeros(1, 1280)), top_similarity=0.9)
    assert not gate.family_supported(assessment, top_similarity=None)


@pytest.mark.parametrize(
    "overrides",
    [{"familyGateSha256": "0" * 64}, {"minFamilyEvidence": 1.0}, {"minFamilyEvidence": True}, {"minFamilyEvidence": 0}],
)
def test_family_gate_artifact_is_refused_when_invalid(tmp_path: Path, overrides: dict[str, object]) -> None:
    with pytest.raises(ArtifactRejectedError):
        load_relevance_gate(_write_family(tmp_path, overrides=overrides), model_version="effb0-test")


def test_family_gate_artifact_is_refused_with_wrong_shapes(tmp_path: Path) -> None:
    directory = _write_family(tmp_path)
    save_file(
        {
            "supported_text": torch.zeros(2, 4),
            "weight": torch.zeros(5),
            "bias": torch.zeros(1),
            "text_calibration": torch.zeros(2),
        },
        str(directory / "family_gate.safetensors"),
    )
    descriptor = json.loads((directory / "relevance.json").read_text(encoding="utf-8"))
    descriptor["familyGateSha256"] = hashlib.sha256((directory / "family_gate.safetensors").read_bytes()).hexdigest()
    (directory / "relevance.json").write_text(json.dumps(descriptor), encoding="utf-8")
    with pytest.raises(ArtifactRejectedError):
        load_relevance_gate(directory, model_version="effb0-test")
    (directory / "family_gate.safetensors").unlink()
    with pytest.raises(ArtifactRejectedError):
        load_relevance_gate(directory, model_version="effb0-test")
