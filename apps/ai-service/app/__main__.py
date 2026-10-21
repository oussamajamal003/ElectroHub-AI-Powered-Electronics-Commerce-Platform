"""`python -m app`: start the service on the validated bind address.

One worker by default: a future model is loaded once per process, so extra workers multiply
memory. Uvicorn's access log is disabled because the service writes its own redacted
``ai.request`` events.
"""

from __future__ import annotations

import sys

import uvicorn

from app.core.config import ConfigurationError, get_settings


def main() -> int:
    try:
        settings = get_settings()
    except ConfigurationError as exc:
        print(f"electrohub-ai-service: {exc}", file=sys.stderr)
        return 2

    from app.main import create_app

    uvicorn.run(
        create_app(settings),
        host=settings.AI_BIND_HOST,
        port=settings.AI_PORT,
        workers=1,
        access_log=False,
        log_config=None,
        server_header=False,
        proxy_headers=False,
        limit_concurrency=64,
        timeout_keep_alive=5,
        timeout_graceful_shutdown=10,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
