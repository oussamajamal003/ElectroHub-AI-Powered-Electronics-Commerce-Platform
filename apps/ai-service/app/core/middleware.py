"""Pure ASGI middleware: request correlation, internal authentication and body limits.

They are ASGI (not ``BaseHTTPMiddleware``) so limits apply while the body streams and so an
unauthenticated request to ``/internal/*`` is rejected before any body is read or parsed.
"""

from __future__ import annotations

import logging
import re
import time
import uuid
from collections.abc import Mapping

from fastapi import HTTPException
from starlette.datastructures import Headers
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.config import Settings
from app.core.errors import AIServiceError, error_response, http_error_details
from app.core.logging import log_event
from app.core.security import (
    API_KEY_HEADER,
    ENVIRONMENT_HEADER,
    INTERNAL_PATH_PREFIX,
    authorize_internal_request,
)

REQUEST_ID_HEADER = "X-Request-Id"
_SAFE_REQUEST_ID = re.compile(r"^[A-Za-z0-9_-]{1,100}$")


def _request_id(scope: Scope) -> str:
    state = scope.get("state")
    value = state.get("request_id") if isinstance(state, dict) else None
    return value if isinstance(value, str) else "unknown"


class RequestContextMiddleware:
    """Outermost layer: assigns a request id, stamps response headers, logs one event per request,
    and converts any unhandled exception into a sanitized 500 envelope."""

    def __init__(self, app: ASGIApp, settings: Settings) -> None:
        self.app = app
        self.settings = settings

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        incoming = Headers(scope=scope).get(REQUEST_ID_HEADER)
        request_id = incoming if incoming and _SAFE_REQUEST_ID.fullmatch(incoming) else str(uuid.uuid4())
        scope.setdefault("state", {})["request_id"] = request_id
        started = time.perf_counter()
        status = 500
        response_started = False

        async def send_with_context(message: Message) -> None:
            nonlocal status, response_started
            if message["type"] == "http.response.start":
                response_started = True
                status = message["status"]
                headers = list(message.get("headers", []))
                headers += [
                    (b"x-request-id", request_id.encode("ascii")),
                    (ENVIRONMENT_HEADER.lower().encode("ascii"), self.settings.AI_ENVIRONMENT.encode("ascii")),
                    (b"cache-control", b"no-store"),
                    (b"x-content-type-options", b"nosniff"),
                ]
                message = {**message, "headers": headers}
            await send(message)

        try:
            await self.app(scope, receive, send_with_context)
        except Exception:
            log_event("ai.unhandled_error", level=logging.ERROR, exc_info=True, requestId=request_id)
            if not response_started:
                response = error_response(500, AIServiceError.code, AIServiceError.message, request_id)
                await response(scope, receive, send_with_context)
        finally:
            log_event(
                "ai.request",
                requestId=request_id,
                method=scope.get("method"),
                path=str(scope.get("path", ""))[:200],
                status=status,
                durationMs=round((time.perf_counter() - started) * 1000, 2),
            )


class InternalAuthMiddleware:
    """Authenticates every ``/internal/*`` request before routing or body parsing."""

    def __init__(self, app: ASGIApp, settings: Settings) -> None:
        self.app = app
        self.settings = settings

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and str(scope.get("path", "")).startswith(INTERNAL_PATH_PREFIX):
            headers = Headers(scope=scope)
            try:
                authorize_internal_request(headers.get(API_KEY_HEADER), headers.get(ENVIRONMENT_HEADER), self.settings)
            except AIServiceError as exc:
                log_event("ai.auth_rejected", level=logging.WARNING, requestId=_request_id(scope), code=exc.code)
                response = error_response(
                    exc.status_code, exc.code, exc.message, _request_id(scope), headers=exc.headers
                )
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)


class BodySizeLimitMiddleware:
    """Rejects bodies above ``max_bytes`` from Content-Length or while streaming.

    ``route_limits`` raises the ceiling for named ``(method, path)`` pairs only (the image upload); every other
    route keeps ``max_bytes``.
    """

    def __init__(
        self,
        app: ASGIApp,
        max_bytes: int,
        route_limits: Mapping[tuple[str, str], int] | None = None,
    ) -> None:
        self.app = app
        self.max_bytes = max_bytes
        self.route_limits: dict[tuple[str, str], int] = dict(route_limits or {})

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        limit = self.route_limits.get((str(scope.get("method", "")), str(scope.get("path", ""))), self.max_bytes)
        declared = Headers(scope=scope).get("content-length")
        if declared is not None and (not declared.isdigit() or int(declared) > limit):
            status = 413 if declared.isdigit() else 400
            code, message = http_error_details(status)
            response = error_response(status, code, message, _request_id(scope))
            await response(scope, receive, send)
            return

        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    # Raised inside body parsing; FastAPI re-raises HTTPException unchanged.
                    raise HTTPException(status_code=413)
            return message

        await self.app(scope, limited_receive, send)
