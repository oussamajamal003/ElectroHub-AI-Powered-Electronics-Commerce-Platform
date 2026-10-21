"""Image-search result contract (served by the fine-tuned encoder + pgvector in 04.2)."""

from __future__ import annotations

from pydantic import Field, field_validator

from app.schemas.common import ContractModel, RankedProduct, VersionStr, validate_ranked

HARD_MAX_TOP_K = 100


class ImageSearchResult(ContractModel):
    matches: list[RankedProduct] = Field(max_length=HARD_MAX_TOP_K)
    model_version: VersionStr
    embedding_version: VersionStr

    @field_validator("matches")
    @classmethod
    def _ranked(cls, value: list[RankedProduct]) -> list[RankedProduct]:
        return validate_ranked(value)
