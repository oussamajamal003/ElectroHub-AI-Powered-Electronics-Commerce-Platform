"""Boundary to the future version-specific pgvector catalog projection (04.2).

The service receives no database credential in 04.1. A 04.2 implementation must use a
read-only role limited to the embedding projection (no orders, payments, auth or mail tables)
and must refuse queries whose model/embedding versions differ from the active index.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol, runtime_checkable

from app.models.descriptor import ModelDescriptor
from app.schemas.common import RankedProduct


@runtime_checkable
class EmbeddingSearchGateway(Protocol):
    async def is_ready(self, descriptor: ModelDescriptor) -> bool:
        """True only when a complete index built with exactly this descriptor is active."""
        ...

    async def nearest(
        self,
        vector: Sequence[float],
        *,
        top_k: int,
        descriptor: ModelDescriptor,
    ) -> Sequence[RankedProduct]:
        """Bounded nearest-neighbour search returning unique, ranked product references."""
        ...

    async def close(self) -> None: ...
