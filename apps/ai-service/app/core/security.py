"""Service-to-service authentication for the internal API.

FastAPI authenticates the Express backend, never end users: callers present a per-environment
shared credential plus the environment they believe they are talking to. CORS is not used and is
not an authentication mechanism (U03).
"""

from __future__ import annotations

import hmac

from app.core.config import Settings
from app.core.errors import (
    AuthNotConfiguredError,
    EnvironmentMismatchError,
    UnauthorizedError,
)

API_KEY_HEADER = "X-ElectroHub-AI-Key"
ENVIRONMENT_HEADER = "X-ElectroHub-AI-Environment"
INTERNAL_PATH_PREFIX = "/internal/"

# Longest credential header we are willing to compare; anything larger is rejected unread.
_MAX_HEADER_LENGTH = 512


def authorize_internal_request(api_key: str | None, environment: str | None, settings: Settings) -> None:
    """Raise a typed error unless the caller holds this environment's credential."""
    configured = settings.AI_SERVICE_API_KEY
    if configured is None:
        # Fail closed: without a credential no internal capability is reachable.
        raise AuthNotConfiguredError()
    if api_key is None or len(api_key) > _MAX_HEADER_LENGTH:
        raise UnauthorizedError()
    if not hmac.compare_digest(api_key.encode("utf-8"), configured.get_secret_value().encode("utf-8")):
        raise UnauthorizedError()
    # Checked only after authentication so an anonymous caller learns nothing about the target.
    if environment != settings.AI_ENVIRONMENT:
        raise EnvironmentMismatchError()
