from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.dependencies import get_settings
from app.core.config import SERVICE_NAME, SERVICE_VERSION, Settings
from app.schemas.common import Health

router = APIRouter(tags=["Health"])


@router.get("/health", response_model=Health)
async def health_check(settings: Annotated[Settings, Depends(get_settings)]) -> Health:
    """Liveness only: the process answers HTTP. Never touches models, databases or GPUs."""
    return Health(
        status="healthy",
        service=SERVICE_NAME,
        timestamp=datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        environment=settings.AI_ENVIRONMENT,
        version=SERVICE_VERSION,
    )
