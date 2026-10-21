"""Typed domain errors and the single sanitized error envelope.

Every error leaving the service is ``{"error": {"code", "message", "requestId"}}`` with a
stable machine-readable code. Raw exception text, inputs and tracebacks never reach a client.
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.logging import log_event

MAX_VALIDATION_DETAILS = 20


class AIServiceError(Exception):
    status_code = 500
    code = "AI_INTERNAL_ERROR"
    message = "The AI service could not complete the request."

    def __init__(self, message: str | None = None, *, headers: dict[str, str] | None = None) -> None:
        super().__init__(message or self.message)
        if message:
            self.message = message
        self.headers = headers or {}


class UnauthorizedError(AIServiceError):
    status_code = 401
    code = "AI_UNAUTHORIZED"
    message = "Service authentication is required."


class EnvironmentMismatchError(AIServiceError):
    status_code = 403
    code = "AI_ENVIRONMENT_MISMATCH"
    message = "The caller is bound to a different environment."


class ValidationFailedError(AIServiceError):
    status_code = 422
    code = "AI_VALIDATION_FAILED"
    message = "The request is invalid."


class RateLimitedError(AIServiceError):
    status_code = 429
    code = "AI_RATE_LIMITED"
    message = "The AI service is busy. Retry shortly."

    def __init__(self, retry_after_seconds: int = 1) -> None:
        super().__init__(headers={"Retry-After": str(retry_after_seconds)})


class AuthNotConfiguredError(AIServiceError):
    status_code = 503
    code = "AI_AUTH_NOT_CONFIGURED"
    message = "AI processing is temporarily unavailable."


class ServiceNotReadyError(AIServiceError):
    status_code = 503
    code = "AI_NOT_READY"
    message = "AI processing is temporarily unavailable."


class ModelNotReadyError(AIServiceError):
    status_code = 503
    code = "AI_MODEL_NOT_READY"
    message = "AI processing is temporarily unavailable."


class IndexNotReadyError(AIServiceError):
    status_code = 503
    code = "AI_INDEX_NOT_READY"
    message = "AI processing is temporarily unavailable."


class InferenceTimeoutError(AIServiceError):
    status_code = 504
    code = "AI_INFERENCE_TIMEOUT"
    message = "AI processing took too long."


class FeatureNotImplementedError(AIServiceError):
    status_code = 501
    code = "AI_NOT_IMPLEMENTED"
    message = "This AI capability is not available yet."


class InferenceOutputError(AIServiceError):
    """A model, ranker or vector gateway produced output that violates its contract."""


_HTTP_CODES = {
    400: ("AI_BAD_REQUEST", "The request could not be processed."),
    404: ("AI_NOT_FOUND", "Not found."),
    405: ("AI_METHOD_NOT_ALLOWED", "Method not allowed."),
    413: ("AI_PAYLOAD_TOO_LARGE", "The request body is too large."),
    415: ("AI_UNSUPPORTED_MEDIA_TYPE", "Unsupported media type."),
}


def http_error_details(status_code: int) -> tuple[str, str]:
    return _HTTP_CODES.get(status_code, ("AI_REQUEST_FAILED", "The request could not be processed."))


def request_id_of(request: Request) -> str:
    value = getattr(request.state, "request_id", None)
    return value if isinstance(value, str) else "unknown"


def error_body(
    code: str, message: str, request_id: str, details: list[dict[str, object]] | None = None
) -> dict[str, object]:
    error: dict[str, object] = {"code": code, "message": message, "requestId": request_id}
    if details:
        error["details"] = details
    return {"error": error}


def error_response(
    status_code: int,
    code: str,
    message: str,
    request_id: str,
    *,
    headers: dict[str, str] | None = None,
    details: list[dict[str, object]] | None = None,
) -> JSONResponse:
    return JSONResponse(error_body(code, message, request_id, details), status_code=status_code, headers=headers)


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AIServiceError)
    async def _service_error(request: Request, exc: AIServiceError) -> JSONResponse:
        unavailable = exc.code in ("AI_MODEL_NOT_READY", "AI_INDEX_NOT_READY")
        # A missing model is an expected, truthfully reported state (04.1), not a service fault.
        level = logging.WARNING if exc.status_code < 500 or unavailable else logging.ERROR
        event = "ai.model_unavailable" if unavailable else "ai.request_rejected"
        log_event(event, level=level, requestId=request_id_of(request), code=exc.code, status=exc.status_code)
        return error_response(exc.status_code, exc.code, exc.message, request_id_of(request), headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        details: list[dict[str, object]] = [
            {"loc": [str(part) for part in error.get("loc", ())][:8], "type": str(error.get("type", "invalid"))[:64]}
            for error in exc.errors()[:MAX_VALIDATION_DETAILS]
        ]
        log_event(
            "ai.validation_rejected", level=logging.WARNING, requestId=request_id_of(request), issues=len(exc.errors())
        )
        return error_response(
            ValidationFailedError.status_code,
            ValidationFailedError.code,
            ValidationFailedError.message,
            request_id_of(request),
            details=details,
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code, message = http_error_details(exc.status_code)
        headers = {"Allow": exc.headers["Allow"]} if exc.headers and "Allow" in exc.headers else None
        return error_response(exc.status_code, code, message, request_id_of(request), headers=headers)
