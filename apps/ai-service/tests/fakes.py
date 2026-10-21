"""Deterministic test doubles for the model/index seams. Test-only: the service ships none."""

from __future__ import annotations

import threading
import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

from app.models.descriptor import ModelDescriptor
from app.processors.image import ValidatedImage
from app.schemas.common import RankedProduct
from app.schemas.recommendations import RecommendationRequest

DESCRIPTOR = ModelDescriptor(
    name="test-encoder",
    model_version="test-model-1",
    embedding_version="test-emb-1",
    preprocess_version="test-pre-1",
    embedding_dimension=4,
    artifact_format="safetensors",
    artifact_sha256="0" * 64,
)

PRODUCTS = [uuid.UUID(int=i) for i in range(1, 6)]


@dataclass
class FakeEncoder:
    vector: Sequence[float] = (1.0, 0.0, 0.0, 0.0)
    descriptor: ModelDescriptor = DESCRIPTOR
    closed: bool = False
    encode_threads: list[int] = field(default_factory=list)

    def encode(self, image: ValidatedImage) -> Sequence[float]:
        self.encode_threads.append(threading.get_ident())
        return self.vector

    def close(self) -> None:
        self.closed = True


@dataclass
class FakeRanker:
    items: Sequence[RankedProduct] = ()
    descriptor: ModelDescriptor = DESCRIPTOR
    closed: bool = False

    def rank(self, request: RecommendationRequest) -> Sequence[RankedProduct]:
        return self.items

    def close(self) -> None:
        self.closed = True


@dataclass
class FakeGateway:
    ready: bool = True
    results: Sequence[RankedProduct] = ()
    closed: bool = False
    queried_with: list[ModelDescriptor] = field(default_factory=list)

    async def is_ready(self, descriptor: ModelDescriptor) -> bool:
        return self.ready

    async def nearest(
        self, vector: Sequence[float], *, top_k: int, descriptor: ModelDescriptor
    ) -> Sequence[RankedProduct]:
        self.queried_with.append(descriptor)
        return self.results

    async def close(self) -> None:
        self.closed = True


def ranked(*scores: float, ids: Sequence[uuid.UUID] = PRODUCTS) -> list[RankedProduct]:
    return [RankedProduct(product_id=ids[i], score=score, rank=i + 1) for i, score in enumerate(scores)]


class CountingLoader:
    def __init__(self, model: object) -> None:
        self.model = model
        self.calls = 0
        self.threads: list[int] = []

    def __call__(self) -> Any:
        self.calls += 1
        self.threads.append(threading.get_ident())
        return self.model
