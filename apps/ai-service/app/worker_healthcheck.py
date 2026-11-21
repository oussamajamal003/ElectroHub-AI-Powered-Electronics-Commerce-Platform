"""Read-only liveness/readiness probe for the isolated media worker's own heartbeat row."""

from __future__ import annotations

import psycopg

from app.core.config import get_settings


def main() -> int:
    try:
        settings = get_settings()
        if settings.AI_MEDIA_WORKER_DATABASE_URL is None:
            return 1
        with psycopg.connect(
            settings.AI_MEDIA_WORKER_DATABASE_URL.get_secret_value(),
            options="-c search_path=ai,extensions,public -c statement_timeout=5000",
            connect_timeout=5,
            application_name="electrohub-ai-media-worker-healthcheck",
        ) as conn:
            row = conn.execute(
                """SELECT state, heartbeat_at > clock_timestamp() - interval '90 seconds'
                   FROM ai.media_worker_heartbeats
                   WHERE environment = %s
                   ORDER BY heartbeat_at DESC
                   LIMIT 1""",
                (settings.AI_ENVIRONMENT,),
            ).fetchone()
        return 0 if row and row[0] in {"READY", "PROCESSING"} and row[1] is True else 1
    except Exception:
        # The probe reveals only a failing exit status. It never writes worker or customer data.
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
