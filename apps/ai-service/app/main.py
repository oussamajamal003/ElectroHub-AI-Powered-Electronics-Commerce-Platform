"""ElectroHub AI service: an internal ML processing service behind the Express gateway.

FastAPI holds no commerce authority (U01/U02): it authenticates the backend service, never
customers, and returns advisory product references that Express re-validates.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, FastAPI

from app.api.dependencies import require_internal_service
from app.api.routes import health, image_search, readiness, recommendations
from app.core.config import SERVICE_VERSION, Settings, get_settings
from app.core.errors import install_error_handlers
from app.core.logging import configure_logging
from app.core.middleware import BodySizeLimitMiddleware, InternalAuthMiddleware, RequestContextMiddleware
from app.core.runtime import AppRuntime, build_lifespan
from app.integrations.pgvector_gateway import PgVectorGateway
from app.integrations.vector_gateway import EmbeddingSearchGateway
from app.models.descriptor import ModelDescriptor
from app.models.embedding_recommender import EmbeddingRecommender
from app.models.registry import ModelRegistry, RecommenderFactory
from app.models.siglip_loader import ArtifactLoader
from app.processors.inference import InferenceExecutor


def build_registry(settings: Settings) -> ModelRegistry:
    """Loaders and the index are wired only when configured; unset settings keep features at 503."""
    loader = (
        ArtifactLoader(
            artifact_dir=settings.AI_MODEL_ARTIFACT_DIR,
            torch_threads=settings.AI_TORCH_THREADS,
            relevance_dir=settings.AI_RELEVANCE_ARTIFACT_DIR,
        )
        if settings.AI_MODEL_ARTIFACT_DIR is not None
        else None
    )
    gateway = (
        PgVectorGateway(dsn=settings.AI_VECTOR_DATABASE_URL.get_secret_value())
        if settings.AI_VECTOR_DATABASE_URL is not None
        else None
    )
    recommender_factory: RecommenderFactory | None = None
    if settings.AI_RECOMMENDATIONS_ENABLED and gateway is not None:
        reader = gateway

        def recommender_factory(descriptor: ModelDescriptor, _index: EmbeddingSearchGateway) -> EmbeddingRecommender:
            # Same read-only gateway as image search; the descriptor is the loaded D3 encoder's exact identity.
            return EmbeddingRecommender(descriptor=descriptor, reader=reader)

    return ModelRegistry(image_encoder_loader=loader, vector_gateway=gateway, recommender_factory=recommender_factory)


def create_app(settings: Settings | None = None, registry: ModelRegistry | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.AI_LOG_LEVEL)

    runtime = AppRuntime(
        settings=settings,
        registry=registry or build_registry(settings),
        executor=InferenceExecutor(
            max_concurrency=settings.AI_MAX_CONCURRENT_INFERENCES,
            timeout_seconds=settings.AI_INFERENCE_TIMEOUT_SECONDS,
        ),
    )

    docs = settings.docs_enabled
    app = FastAPI(
        title=settings.PROJECT_NAME,
        version=SERVICE_VERSION,
        description="Internal AI service for ElectroHub (image search and recommendations). "
        "Called only by the Express backend with a per-environment service credential.",
        lifespan=build_lifespan(runtime),
        docs_url="/docs" if docs else None,
        redoc_url=None,
        openapi_url="/openapi.json" if docs else None,
    )
    app.state.runtime = runtime

    install_error_handlers(app)

    internal = APIRouter(prefix="/internal/v1", dependencies=[Depends(require_internal_service)])
    internal.include_router(readiness.router)
    internal.include_router(image_search.router)
    internal.include_router(recommendations.router)
    app.include_router(health.router)
    app.include_router(internal)

    # Added innermost first: the request-context layer wraps everything, including auth rejections.
    image_limit = settings.AI_MAX_IMAGE_BYTES + image_search.MULTIPART_OVERHEAD_BYTES
    app.add_middleware(
        BodySizeLimitMiddleware,
        max_bytes=settings.AI_MAX_REQUEST_BYTES,
        route_limits={("POST", image_search.IMAGE_SEARCH_PATH): image_limit},
    )
    app.add_middleware(InternalAuthMiddleware, settings=settings)
    app.add_middleware(RequestContextMiddleware, settings=settings)
    return app


def __getattr__(name: str) -> FastAPI:
    # `uvicorn app.main:app` keeps working, but importing this module (tests, tooling) no longer
    # requires a configured environment or builds an application as a side effect.
    if name == "app":
        return create_app()
    raise AttributeError(name)
