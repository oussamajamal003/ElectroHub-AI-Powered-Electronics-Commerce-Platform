BEGIN;

-- Task 04.3: source-revision-aware incremental embeddings. Base vectors and the active pointer remain immutable.
-- This migration follows 20261028000000_product_media, which adds the source/media fields and outbox.

CREATE TABLE ai.media_image_embeddings (
    embedding_version VARCHAR(64) NOT NULL REFERENCES ai.model_versions (embedding_version) ON DELETE CASCADE,
    product_image_id UUID NOT NULL,
    product_id UUID NOT NULL,
    source_revision UUID NOT NULL,
    source_sha256 CHAR(64) NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
    embedding extensions.vector(256) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (embedding_version, product_image_id),
    CHECK (abs(extensions.vector_norm(embedding) - 1) < 0.001)
);

CREATE INDEX media_image_embeddings_product_idx
    ON ai.media_image_embeddings (embedding_version, product_id);

-- Periodically recover current revisioned images whose outbox event was superseded while hidden,
-- or whose completed overlay disappeared. The fixed batch bound and stable idempotency key keep
-- reconciliation safe to run repeatedly without granting the worker INSERT on the public table.
CREATE FUNCTION ai.enqueue_missing_media_events(p_limit INTEGER DEFAULT 100) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, ai
AS $$
DECLARE
    inserted_count INTEGER;
BEGIN
    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
        RAISE EXCEPTION 'media reconciliation limit must be between 1 and 100'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    WITH active AS (
        SELECT a.embedding_version
        FROM ai.active_index AS a
        JOIN ai.model_versions AS m ON m.embedding_version = a.embedding_version
        WHERE a.singleton AND m.status = 'ACTIVE'
    ), candidates AS (
        SELECT active.embedding_version, source.product_id, source.product_image_id,
               source.source_revision, source.source_sha256
        FROM active
        JOIN ai.catalog_media_sources AS source ON source.eligible
        LEFT JOIN ai.media_image_embeddings AS overlay
          ON overlay.embedding_version = active.embedding_version
         AND overlay.product_image_id = source.product_image_id
         AND overlay.product_id = source.product_id
         AND overlay.source_revision = source.source_revision
         AND overlay.source_sha256 = source.source_sha256
        WHERE source.source_revision IS NOT NULL
          AND source.source_sha256 IS NOT NULL
          AND source.storage_provider = 'SUPABASE_STORAGE'
          AND overlay.product_image_id IS NULL
          AND NOT EXISTS (
              SELECT 1 FROM public.catalog_media_events AS event
              WHERE event."productImageId" = source.product_image_id
                AND event."sourceRevision" = source.source_revision
                AND event."sourceSha256" = source.source_sha256
                AND event.state IN ('READY', 'CLAIMED', 'RETRY_WAIT', 'PERMANENT_FAILURE')
          )
        ORDER BY source.product_id, source.product_image_id
        LIMIT p_limit
    ), queued AS (
        INSERT INTO public.catalog_media_events
          (id, "idempotencyKey", "requestSha256", "productId", "productImageId", operation,
           "sourceRevision", "sourceSha256", state, "attemptCount", "nextAttemptAt", "createdAt", "updatedAt")
        SELECT pg_catalog.gen_random_uuid(),
               'reconcile:' || candidate.embedding_version || ':' || candidate.product_image_id::text || ':' || candidate.source_revision::text,
               candidate.source_sha256,
               candidate.product_id,
               candidate.product_image_id,
               'RECONCILE',
               candidate.source_revision,
               candidate.source_sha256,
               'READY',
               0,
               clock_timestamp(),
               clock_timestamp(),
               clock_timestamp()
        FROM candidates AS candidate
        ON CONFLICT ("idempotencyKey") DO UPDATE SET
            state = 'READY',
            "attemptCount" = 0,
            "nextAttemptAt" = clock_timestamp(),
            "claimedUntil" = NULL,
            "leaseToken" = NULL,
            "lastErrorCode" = NULL,
            "completedAt" = NULL,
            "updatedAt" = clock_timestamp()
        WHERE public.catalog_media_events.state IN ('SUPERSEDED', 'COMPLETED')
          AND NOT EXISTS (
              SELECT 1 FROM ai.media_image_embeddings AS overlay
              WHERE overlay.embedding_version = split_part(public.catalog_media_events."idempotencyKey", ':', 2)
                AND overlay.product_image_id = public.catalog_media_events."productImageId"
                AND overlay.product_id = public.catalog_media_events."productId"
                AND overlay.source_revision = public.catalog_media_events."sourceRevision"
                AND overlay.source_sha256 = public.catalog_media_events."sourceSha256"
          )
        RETURNING 1
    )
    SELECT count(*)::INTEGER INTO inserted_count FROM queued;

    RETURN inserted_count;
END;
$$;

-- Include hidden/retired extant images so the reader can explicitly exclude their base/overlay vectors.
-- The view is private to the AI roles and exposes no commerce fields beyond image identity and trusted source location.
CREATE VIEW ai.catalog_media_sources AS
SELECT pi."id" AS product_image_id,
       pi."productId" AS product_id,
       pi."sourceRevision" AS source_revision,
       pi."sourceSha256" AS source_sha256,
       (pi."mediaState" = 'PUBLISHED'
          AND p."status" = 'ACTIVE'
          AND p."isTestFixture" = false
          AND p."storefrontVisible" = true
          AND c."isActive" = true) AS eligible,
       pi."storageProvider" AS storage_provider,
       pi."storageBucket" AS storage_bucket,
       pi."storagePath" AS storage_path,
       pi."url" AS url
FROM public.product_images pi
JOIN public.products p ON p."id" = pi."productId"
JOIN public.categories c ON c."id" = p."categoryId";

-- Only ACTIVE model vectors are incrementally published. Worker cannot write the protected base snapshot.
CREATE FUNCTION ai.publish_media_embedding(
    p_event_id UUID,
    p_lease_token UUID,
    p_embedding_version VARCHAR(64),
    p_model_version VARCHAR(64),
    p_preprocess_version VARCHAR(64),
    p_artifact_sha256 CHAR(64),
    p_product_image_id UUID,
    p_product_id UUID,
    p_source_revision UUID,
    p_source_sha256 CHAR(64),
    p_embedding extensions.vector(256)
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, ai, extensions
AS $$
DECLARE
    current_source record;
    claimed_event record;
    active_version VARCHAR(64);
    active_model VARCHAR(64);
    active_preprocess VARCHAR(64);
    active_sha CHAR(64);
BEGIN
    -- Serialize publication with the catalog transaction that replaces/retires this image.
    PERFORM 1 FROM public.product_images
      WHERE "id" = p_product_image_id AND "productId" = p_product_id
      FOR UPDATE;
    IF NOT FOUND THEN RETURN FALSE; END IF;

    SELECT "productId", "productImageId", "sourceRevision", "sourceSha256"
      INTO claimed_event
      FROM public.catalog_media_events
      WHERE id = p_event_id AND state = 'CLAIMED' AND "leaseToken" = p_lease_token
        AND "claimedUntil" > clock_timestamp()
      FOR UPDATE;
    IF NOT FOUND OR claimed_event."productId" <> p_product_id
       OR claimed_event."productImageId" <> p_product_image_id
       OR claimed_event."sourceRevision" IS DISTINCT FROM p_source_revision
       OR claimed_event."sourceSha256" IS DISTINCT FROM p_source_sha256 THEN
        RETURN FALSE;
    END IF;

    SELECT product_id, source_revision, source_sha256, eligible
      INTO current_source
      FROM ai.catalog_media_sources
      WHERE product_image_id = p_product_image_id;
    IF NOT FOUND OR NOT current_source.eligible
       OR current_source.product_id <> p_product_id
       OR current_source.source_revision IS DISTINCT FROM p_source_revision
       OR current_source.source_sha256 IS DISTINCT FROM p_source_sha256 THEN
        RETURN FALSE;
    END IF;

    SELECT a.embedding_version, m.model_version, m.preprocess_version, m.artifact_sha256
      INTO active_version, active_model, active_preprocess, active_sha
      FROM ai.active_index a
      JOIN ai.model_versions m ON m.embedding_version = a.embedding_version
      WHERE a.singleton AND a.embedding_version = p_embedding_version AND m.status = 'ACTIVE'
      FOR SHARE OF a, m;
    IF NOT FOUND THEN
        -- A pointer switch is retryable work, not evidence that this current source was superseded.
        RAISE EXCEPTION 'active media model changed during publication'
            USING ERRCODE = 'serialization_failure';
    END IF;
    IF active_model IS DISTINCT FROM p_model_version
       OR active_preprocess IS DISTINCT FROM p_preprocess_version
       OR active_sha IS DISTINCT FROM p_artifact_sha256 THEN
        RAISE EXCEPTION 'media worker descriptor is not the active embedding identity'
            USING ERRCODE = 'serialization_failure';
    END IF;

    -- A lock wait on the active pointer can consume the lease after the event-row lock was acquired.
    IF (SELECT "claimedUntil" FROM public.catalog_media_events WHERE id = p_event_id) <= clock_timestamp() THEN
        RETURN FALSE;
    END IF;

    INSERT INTO ai.media_image_embeddings
      (embedding_version, product_image_id, product_id, source_revision, source_sha256, embedding)
    VALUES
      (p_embedding_version, p_product_image_id, p_product_id, p_source_revision, p_source_sha256, p_embedding)
    ON CONFLICT (embedding_version, product_image_id) DO UPDATE SET
      product_id = EXCLUDED.product_id,
      source_revision = EXCLUDED.source_revision,
      source_sha256 = EXCLUDED.source_sha256,
      embedding = EXCLUDED.embedding,
      created_at = clock_timestamp();
    RETURN TRUE;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ai_media_worker') THEN
        CREATE ROLE ai_media_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
    END IF;
END $$;

REVOKE ALL ON ai.media_image_embeddings, ai.catalog_media_sources FROM PUBLIC;
REVOKE ALL ON FUNCTION ai.publish_media_embedding(UUID, UUID, VARCHAR, VARCHAR, VARCHAR, CHAR, UUID, UUID, UUID, CHAR, extensions.vector) FROM PUBLIC;
REVOKE ALL ON FUNCTION ai.enqueue_missing_media_events(INTEGER) FROM PUBLIC;
GRANT USAGE ON SCHEMA ai, extensions TO ai_vector_reader, ai_media_worker;
GRANT USAGE ON SCHEMA public TO ai_media_worker;
GRANT SELECT ON ai.catalog_media_sources, ai.media_image_embeddings TO ai_vector_reader;
GRANT SELECT (product_image_id, product_id, source_revision, source_sha256, eligible)
    ON ai.catalog_media_sources TO ai_vector_ingest;
GRANT SELECT ON ai.catalog_media_sources, ai.active_index, ai.model_versions TO ai_media_worker;
GRANT SELECT (id, "productId", "productImageId", operation, "sourceRevision", "sourceSha256", state,
              "attemptCount", "nextAttemptAt", "claimedUntil", "leaseToken", "createdAt")
    ON public.catalog_media_events TO ai_media_worker;
GRANT UPDATE (state, "attemptCount", "nextAttemptAt", "claimedUntil", "leaseToken", "lastErrorCode",
              "completedAt", "updatedAt") ON public.catalog_media_events TO ai_media_worker;
GRANT EXECUTE ON FUNCTION ai.publish_media_embedding(UUID, UUID, VARCHAR, VARCHAR, VARCHAR, CHAR, UUID, UUID, UUID, CHAR, extensions.vector)
    TO ai_media_worker;
GRANT EXECUTE ON FUNCTION ai.enqueue_missing_media_events(INTEGER) TO ai_media_worker;

CREATE POLICY catalog_media_events_worker_select ON public.catalog_media_events
    FOR SELECT TO ai_media_worker USING (true);
CREATE POLICY catalog_media_events_worker_update ON public.catalog_media_events
    FOR UPDATE TO ai_media_worker
    USING (
        (state IN ('READY', 'RETRY_WAIT') AND "nextAttemptAt" <= clock_timestamp()
          AND ("claimedUntil" IS NULL OR "claimedUntil" <= clock_timestamp()))
        OR (state = 'CLAIMED' AND ("claimedUntil" IS NULL OR "claimedUntil" <= clock_timestamp()))
        OR (state = 'CLAIMED' AND "claimedUntil" > clock_timestamp() AND "leaseToken" IS NOT NULL)
    )
    WITH CHECK (
        (state = 'CLAIMED' AND "claimedUntil" > clock_timestamp() AND "leaseToken" IS NOT NULL)
        OR (state IN ('RETRY_WAIT', 'COMPLETED', 'PERMANENT_FAILURE', 'SUPERSEDED')
          AND "claimedUntil" IS NULL AND "leaseToken" IS NULL)
    );

-- The older ingestion view remains compatible, but retired/hidden media is no longer a staging candidate.
CREATE OR REPLACE VIEW ai.catalog_images AS
SELECT pi."id" AS product_image_id, pi."productId" AS product_id, pi."url" AS url, pi."isPrimary" AS is_primary
FROM public.product_images pi
JOIN public.products p ON p."id" = pi."productId"
JOIN public.categories c ON c."id" = p."categoryId"
WHERE pi."mediaState" = 'PUBLISHED'
  AND p."status" = 'ACTIVE' AND p."isTestFixture" = false AND p."storefrontVisible" = true AND c."isActive" = true;

COMMIT;
