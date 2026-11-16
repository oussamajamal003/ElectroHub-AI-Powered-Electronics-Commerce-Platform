"""Metadata that identifies one trained model artifact (an ML artifact, not an ORM model).

An embedding is only comparable with another embedding produced by the same model version,
embedding version, preprocessing version and dimension; the descriptor carries all of them so
inference and the vector index can be checked against each other before use.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.schemas.common import VersionStr

# Formats that load without executing serialized Python objects. Pickle-based checkpoints
# (.pt/.pth/.pkl) are converted offline in 04.2 and never loaded by the service.
ArtifactFormat = Literal["safetensors", "onnx"]


class ModelDescriptor(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", protected_namespaces=())

    name: VersionStr
    model_version: VersionStr
    embedding_version: VersionStr
    preprocess_version: VersionStr
    embedding_dimension: int = Field(ge=1, le=4096)
    artifact_format: ArtifactFormat
    artifact_sha256: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
