"""Image-search result contract (served by the fine-tuned encoder + pgvector in 04.2)."""

from __future__ import annotations

import itertools
from typing import Annotated

from pydantic import Field, StringConstraints, field_validator

from app.schemas.common import ContractModel, RankedProduct, VersionStr, validate_ranked

HARD_MAX_TOP_K = 100
MAX_CATEGORY_HINTS = 32

CategorySlug = Annotated[str, StringConstraints(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=64)]


class CategoryHint(ContractModel):
    """The photo's estimated probability of showing a product of this catalog category slug. Advisory only: Express
    reranks resolved products with it and ignores slugs it does not know."""

    category: CategorySlug
    probability: float = Field(ge=0.0, le=1.0, allow_inf_nan=False)


class ImageSearchResult(ContractModel):
    matches: list[RankedProduct] = Field(max_length=HARD_MAX_TOP_K)
    category_hints: list[CategoryHint] = Field(default_factory=list, max_length=MAX_CATEGORY_HINTS)
    # How strongly Express should reorder by the hints (selected per relevance gate); absent without hints.
    category_weight: float | None = Field(default=None, ge=0.0, le=2.0, allow_inf_nan=False)
    # Express drops products whose category hint is below this fraction of the strongest hint; absent means keep all.
    category_min_ratio: float | None = Field(default=None, ge=0.0, le=1.0, allow_inf_nan=False)
    # Present only when the gate's category fallback applies: nearest products without the gap cut (Express uses them
    # only if the regular list is empty after its category filter, keeping the top category and this score gap).
    fallback_matches: list[RankedProduct] | None = Field(default=None, max_length=HARD_MAX_TOP_K)
    fallback_score_gap: float | None = Field(default=None, ge=0.0, le=1.0, allow_inf_nan=False)
    model_version: VersionStr
    embedding_version: VersionStr

    @field_validator("matches")
    @classmethod
    def _ranked(cls, value: list[RankedProduct]) -> list[RankedProduct]:
        return validate_ranked(value)

    @field_validator("fallback_matches")
    @classmethod
    def _fallback_ranked(cls, value: list[RankedProduct] | None) -> list[RankedProduct] | None:
        return None if value is None else validate_ranked(value)

    @field_validator("category_hints")
    @classmethod
    def _hints(cls, value: list[CategoryHint]) -> list[CategoryHint]:
        if len({hint.category for hint in value}) != len(value):
            raise ValueError("duplicate category in hints")
        if any(later.probability > earlier.probability for earlier, later in itertools.pairwise(value)):
            raise ValueError("category hints must be ordered by descending probability")
        if sum(hint.probability for hint in value) > 1.0 + 1e-6:
            raise ValueError("category hint probabilities must not exceed 1 in total")
        return value
