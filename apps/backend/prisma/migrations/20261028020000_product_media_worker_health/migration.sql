BEGIN;

-- Bounded operational heartbeat for the isolated catalog media worker.
CREATE TABLE ai.media_worker_heartbeats (
    worker_id UUID PRIMARY KEY,
    environment VARCHAR(16) NOT NULL CHECK (environment IN ('development', 'qa', 'production', 'test')),
    state VARCHAR(16) NOT NULL CHECK (state IN ('STARTING', 'READY', 'PROCESSING', 'STOPPING', 'STOPPED', 'FAILED')),
    heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    active_model_version VARCHAR(100),
    current_event_id UUID,
    processed_success_count BIGINT NOT NULL DEFAULT 0 CHECK (processed_success_count >= 0),
    processed_failure_count BIGINT NOT NULL DEFAULT 0 CHECK (processed_failure_count >= 0),
    last_error_code VARCHAR(80) CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Z0-9_]{1,80}$')
);

CREATE INDEX media_worker_heartbeats_heartbeat_at_idx ON ai.media_worker_heartbeats (heartbeat_at);

ALTER TABLE ai.media_worker_heartbeats ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ai.media_worker_heartbeats FROM PUBLIC;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        REVOKE ALL ON ai.media_worker_heartbeats FROM anon;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        REVOKE ALL ON ai.media_worker_heartbeats FROM authenticated;
    END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ai.media_worker_heartbeats TO ai_media_worker;
CREATE POLICY media_worker_heartbeats_worker_access ON ai.media_worker_heartbeats
    FOR ALL TO ai_media_worker USING (true) WITH CHECK (true);

COMMIT;
