"""Process-wide runtime state and the FastAPI lifespan that owns it."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Callable
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from dataclasses import dataclass

from fastapi import FastAPI

from app.core.config import SERVICE_VERSION, ConfigurationError, Settings
from app.core.logging import log_event
from app.models.registry import ModelRegistry
from app.processors.inference import InferenceExecutor


@dataclass
class AppRuntime:
    settings: Settings
    registry: ModelRegistry
    executor: InferenceExecutor
    started: bool = False


def build_lifespan(
    runtime: AppRuntime,
    registry_factory: Callable[[Settings], ModelRegistry] | None = None,
) -> Callable[[FastAPI], AbstractAsyncContextManager[None]]:
    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        settings = runtime.settings
        log_event(
            "ai.runtime_start",
            environment=settings.AI_ENVIRONMENT,
            version=SERVICE_VERSION,
            authConfigured=settings.auth_configured,
            loopbackOnly=settings.binds_loopback,
            docsEnabled=settings.docs_enabled,
        )
        if settings.AI_ARTIFACT_DOWNLOAD_URL is not None and registry_factory is not None:
            try:
                from app.artifact_installer import ArtifactInstallError, install_approved_artifacts

                settings, _model_dir, _relevance_dir = install_approved_artifacts(settings)
                runtime.settings = settings
                runtime.registry = registry_factory(settings)
            except (ArtifactInstallError, ConfigurationError) as exc:
                runtime.started = False
                log_event("ai.artifact_install_failed", level=logging.ERROR, exception=type(exc).__name__)
                try:
                    yield
                finally:
                    await runtime.registry.stop()
                return

        await runtime.registry.start()
        runtime.started = True
        log_event("ai.ready", modelReady=runtime.registry.any_model_ready)
        try:
            yield
        finally:
            runtime.started = False
            await runtime.registry.stop()
            log_event("ai.runtime_stop")

    return lifespan
