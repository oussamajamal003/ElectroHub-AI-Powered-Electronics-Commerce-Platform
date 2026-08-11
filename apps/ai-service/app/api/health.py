from fastapi import APIRouter
from datetime import datetime
from app.core.config import settings

router = APIRouter()

@router.get("/health", response_model=dict)
async def health_check():
    """
    Health check endpoint for the AI service.
    Returns status, timestamp, and environment.
    """
    return {
        "status": "healthy",
        "service": "electrohub-ai-service",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "environment": settings.ENVIRONMENT,
        "version": "0.1.0"
    }
