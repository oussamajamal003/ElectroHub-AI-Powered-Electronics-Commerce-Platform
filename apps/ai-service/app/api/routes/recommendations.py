from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.dependencies import get_recommendation_service
from app.schemas.common import DataEnvelope, ErrorEnvelope
from app.schemas.recommendations import RecommendationRequest, RecommendationResult
from app.services.recommendation_service import RecommendationService

router = APIRouter(tags=["Recommendations"])


@router.post(
    "/recommendations",
    response_model=DataEnvelope[RecommendationResult],
    responses={
        422: {"model": ErrorEnvelope, "description": "AI_VALIDATION_FAILED"},
        429: {"model": ErrorEnvelope, "description": "AI_RATE_LIMITED"},
        503: {"model": ErrorEnvelope, "description": "AI_MODEL_NOT_READY (always in Task 04.1)"},
        504: {"model": ErrorEnvelope, "description": "AI_INFERENCE_TIMEOUT"},
    },
)
async def recommend(
    body: RecommendationRequest,
    service: Annotated[RecommendationService, Depends(get_recommendation_service)],
) -> DataEnvelope[RecommendationResult]:
    """Ranked product references from a trained ranker (Task 04.4). Returns 503 until one exists."""
    return DataEnvelope(data=await service.recommend(body))
