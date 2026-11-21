"""Compose readiness probe for the authenticated AI model and compatible active vector index."""

from __future__ import annotations

import json
import os
from urllib.request import Request, urlopen


def is_ready(payload: object) -> bool:
    if not isinstance(payload, dict):
        return False
    data = payload.get("data")
    if not isinstance(data, dict) or data.get("modelReady") is not True:
        return False
    features = data.get("features")
    if not isinstance(features, dict):
        return False
    return all(
        isinstance(features.get(name), dict) and features[name].get("available") is True
        for name in ("imageSearch", "recommendations")
    )


def main() -> int:
    key = os.environ.get("AI_SERVICE_API_KEY", "")
    environment = os.environ.get("AI_ENVIRONMENT", "")
    if not key or not environment:
        return 1
    request = Request(
        "http://127.0.0.1:8000/internal/v1/ready",
        headers={
            "X-ElectroHub-AI-Key": key,
            "X-ElectroHub-AI-Environment": environment,
        },
    )
    try:
        with urlopen(request, timeout=10) as response:  # noqa: S310 - internal loopback readiness probe only
            if response.status != 200:
                return 1
            payload = json.loads(response.read(64 * 1024))
        return 0 if is_ready(payload) else 1
    except Exception:
        # Docker health output is intentionally data-free; never print request headers or response bodies.
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
