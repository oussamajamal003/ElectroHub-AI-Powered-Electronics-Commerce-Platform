"""Request-scoped dependencies: runtime access, internal auth and service injection."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request, Security
from fastapi.security import APIKeyHeader

from app.core.config import Settings
from app.core.errors import ServiceNotReadyError
from app.core.runtime import AppRuntime
from app.core.security import API_KEY_HEADER, ENVIRONMENT_HEADER, authorize_internal_request
from app.services.image_search_service import ImageSearchService
from app.services.recommendation_service import RecommendationService

_api_key_scheme = APIKeyHeader(name=API_KEY_HEADER, scheme_name="InternalServiceKey", auto_error=False)
_environment_scheme = APIKeyHeader(name=ENVIRONMENT_HEADER, scheme_name="InternalServiceEnvironment", auto_error=False)


def get_runtime(request: Request) -> AppRuntime:
    runtime: AppRuntime = request.app.state.runtime
    return runtime


def get_settings(runtime: Annotated[AppRuntime, Depends(get_runtime)]) -> Settings:
    return runtime.settings


def require_internal_service(
    settings: Annotated[Settings, Depends(get_settings)],
    api_key: Annotated[str | None, Security(_api_key_scheme)],
    environment: Annotated[str | None, Security(_environment_scheme)],
) -> None:
    # InternalAuthMiddleware already rejected unauthenticated requests before body parsing;
    # repeating the check here keeps each route safe if it is ever mounted elsewhere and
    # documents the scheme in OpenAPI.
    authorize_internal_request(api_key, environment, settings)


def get_started_runtime(runtime: Annotated[AppRuntime, Depends(get_runtime)]) -> AppRuntime:
    if not runtime.started:
        raise ServiceNotReadyError()
    return runtime


def get_image_search_service(runtime: Annotated[AppRuntime, Depends(get_started_runtime)]) -> ImageSearchService:
    return ImageSearchService(runtime.registry, runtime.executor, runtime.settings)


def get_recommendation_service(
    runtime: Annotated[AppRuntime, Depends(get_started_runtime)],
) -> RecommendationService:
    return RecommendationService(runtime.registry, runtime.executor, runtime.settings)
