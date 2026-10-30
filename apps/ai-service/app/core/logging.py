"""Structured JSON event logging with defensive redaction.

Callers pass small scalar fields (ids, codes, durations, counts). Anything whose name looks
like a credential, raw payload, image or vector is dropped before it is written (U11).
"""

from __future__ import annotations

import json
import logging
import re
import sys
from contextvars import ContextVar
from datetime import UTC, datetime

LOGGER_NAME = "electrohub.ai"
_logger = logging.getLogger(LOGGER_NAME)
request_context: ContextVar[str | None] = ContextVar("ai_request_id", default=None)

_SENSITIVE_FIELD = re.compile(
    r"key|secret|token|authorization|password|cookie|credential|image|vector|embedding|body|payload|email|address|phone",
    re.IGNORECASE,
)
_MAX_STRING = 200


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, object] = {
            "timestamp": datetime.fromtimestamp(record.created, UTC).isoformat().replace("+00:00", "Z"),
            "level": record.levelname.lower(),
            "event": record.getMessage(),
        }
        fields = getattr(record, "fields", None)
        if isinstance(fields, dict):
            entry.update(fields)
        if record.exc_info and record.exc_info[0] is not None:
            # Exception type and traceback only go to the restricted process log, never to clients.
            entry["exception"] = record.exc_info[0].__name__
            entry["traceback"] = self.formatException(record.exc_info)
        return json.dumps(entry, default=str, separators=(",", ":"))


def configure_logging(level: str) -> None:
    """Idempotently attach one JSON stdout handler to the service logger."""
    _logger.setLevel(level)
    _logger.propagate = False
    if not any(getattr(handler, "_electrohub_ai", False) for handler in _logger.handlers):
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(JsonFormatter())
        handler._electrohub_ai = True  # type: ignore[attr-defined]
        _logger.addHandler(handler)


def sanitize_fields(fields: dict[str, object]) -> dict[str, object]:
    clean: dict[str, object] = {}
    for name, value in fields.items():
        if _SENSITIVE_FIELD.search(name):
            continue
        if isinstance(value, str):
            clean[name] = value[:_MAX_STRING]
        elif value is None or isinstance(value, bool | int | float):
            clean[name] = value
        else:
            clean[name] = str(value)[:_MAX_STRING]
    return clean


def log_event(event: str, *, level: int = logging.INFO, exc_info: bool = False, **fields: object) -> None:
    request_id = request_context.get()
    if request_id is not None:
        fields.setdefault("requestId", request_id)
    _logger.log(level, event, exc_info=exc_info, extra={"fields": sanitize_fields(fields)})
