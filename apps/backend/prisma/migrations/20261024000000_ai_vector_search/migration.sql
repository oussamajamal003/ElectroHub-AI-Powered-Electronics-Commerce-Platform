BEGIN;

-- Task 04.2: visual-search vector index. Additive only: no existing table, enum, row or grant in "public" is altered.
-- Everything lives in a separate "ai" schema that Prisma does not model (Prisma only introspects "public"), is not
-- exposed through Supabase PostgREST and is reachable only through the two NOLOGIN roles below. Enabling LOGIN and
-- setting passwords for those roles is a per-environment operator step, never part of a migration.

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
CREATE SCHEMA IF NOT EXISTS ai;

-- One row per trained encoder/preprocessing/embedding space. Identity columns are immutable once VERIFIED or ACTIVE.
CREATE TABLE ai.model_versions (
    embedding_version   VARCHAR(64)  PRIMARY KEY CHECK (embedding_version ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
    model_version       VARCHAR(64)  NOT NULL CHECK (model_version ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
    preprocess_version  VARCHAR(64)  NOT NULL CHECK (preprocess_version ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
    embedding_dimension INTEGER      NOT NULL CHECK (embedding_dimension = 256),
    artifact_format     VARCHAR(16)  NOT NULL CHECK (artifact_format IN ('safetensors', 'onnx')),
    artifact_sha256     CHAR(64)     NOT NULL CHECK (artifact_sha256 ~ '^[0-9a-f]{64}$'),
    dataset_digest      CHAR(64)     CHECK (dataset_digest ~ '^[0-9a-f]{64}$'),
    evaluation_digest   CHAR(64)     CHECK (evaluation_digest ~ '^[0-9a-f]{64}$'),
    status              VARCHAR(16)  NOT NULL DEFAULT 'STAGING'
                        CHECK (status IN ('STAGING', 'VERIFIED', 'ACTIVE', 'RETIRED', 'FAILED')),
    expected_images     INTEGER      CHECK (expected_images >= 0),
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    verified_at         TIMESTAMPTZ,
    activated_at        TIMESTAMPTZ
);

CREATE FUNCTION ai.model_versions_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status IN ('VERIFIED', 'ACTIVE', 'RETIRED') AND (
        NEW.embedding_version, NEW.model_version, NEW.preprocess_version, NEW.embedding_dimension,
        NEW.artifact_format, NEW.artifact_sha256, NEW.expected_images
    ) IS DISTINCT FROM (
        OLD.embedding_version, OLD.model_version, OLD.preprocess_version, OLD.embedding_dimension,
        OLD.artifact_format, OLD.artifact_sha256, OLD.expected_images
    ) THEN
        RAISE EXCEPTION 'ai.model_versions identity is immutable after verification' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER model_versions_immutable BEFORE UPDATE ON ai.model_versions
    FOR EACH ROW EXECUTE FUNCTION ai.model_versions_immutable();

ALTER TABLE ai.model_versions ADD CONSTRAINT model_versions_new_rows_staging CHECK (
    status <> 'STAGING' OR (verified_at IS NULL AND activated_at IS NULL)
);

CREATE FUNCTION ai.model_versions_insert_staging() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status <> 'STAGING' THEN
        RAISE EXCEPTION 'new embedding versions start as STAGING' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER model_versions_insert_staging BEFORE INSERT ON ai.model_versions
    FOR EACH ROW EXECUTE FUNCTION ai.model_versions_insert_staging();

-- Learned catalog-image embeddings. Rows of a version are written while it is STAGING and only read once ACTIVE.
CREATE TABLE ai.product_image_embeddings (
    product_image_id  UUID         NOT NULL REFERENCES public.product_images ("id") ON DELETE CASCADE,
    product_id        UUID         NOT NULL REFERENCES public.products ("id") ON DELETE CASCADE,
    embedding_version VARCHAR(64)  NOT NULL REFERENCES ai.model_versions (embedding_version) ON DELETE CASCADE,
    image_sha256      CHAR(64)     NOT NULL CHECK (image_sha256 ~ '^[0-9a-f]{64}$'),
    embedding         extensions.vector(256) NOT NULL,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (embedding_version, product_image_id),
    -- Encoders emit L2-normalised vectors; anything else is corrupt input and is refused at write time.
    CHECK (abs(extensions.vector_norm(embedding) - 1) < 0.001)
);

CREATE INDEX product_image_embeddings_product_idx ON ai.product_image_embeddings (product_id);

-- Resumable ingestion journal (counts and safe error codes only; never image bytes or vectors).
CREATE TABLE ai.ingestion_jobs (
    id                UUID         PRIMARY KEY,
    embedding_version VARCHAR(64)  NOT NULL REFERENCES ai.model_versions (embedding_version) ON DELETE CASCADE,
    source_digest     CHAR(64)     NOT NULL CHECK (source_digest ~ '^[0-9a-f]{64}$'),
    state             VARCHAR(16)  NOT NULL DEFAULT 'RUNNING' CHECK (state IN ('RUNNING', 'COMPLETED', 'FAILED')),
    planned           INTEGER      NOT NULL DEFAULT 0 CHECK (planned >= 0),
    succeeded         INTEGER      NOT NULL DEFAULT 0 CHECK (succeeded >= 0),
    skipped           INTEGER      NOT NULL DEFAULT 0 CHECK (skipped >= 0),
    failed            INTEGER      NOT NULL DEFAULT 0 CHECK (failed >= 0),
    error_codes       JSONB        NOT NULL DEFAULT '{}'::jsonb,
    started_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    finished_at       TIMESTAMPTZ
);

-- Exactly one active embedding space per environment; switching it is a single-row update.
CREATE TABLE ai.active_index (
    singleton         BOOLEAN      PRIMARY KEY DEFAULT true CHECK (singleton),
    embedding_version VARCHAR(64)  NOT NULL REFERENCES ai.model_versions (embedding_version),
    previous_version  VARCHAR(64)  REFERENCES ai.model_versions (embedding_version),
    activated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- The ingestion worker's only view of the catalog: storefront-visible products' image references. No prices, stock,
-- users or orders are reachable through it.
CREATE VIEW ai.catalog_images AS
SELECT pi."id" AS product_image_id, pi."productId" AS product_id, pi."url" AS url, pi."isPrimary" AS is_primary
FROM public.product_images pi
JOIN public.products p ON p."id" = pi."productId"
JOIN public.categories c ON c."id" = p."categoryId"
WHERE p."status" = 'ACTIVE' AND p."isTestFixture" = false AND p."storefrontVisible" = true AND c."isActive" = true;

-- Least-privilege roles (NOLOGIN here; LOGIN + password are set per environment by an operator).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ai_vector_reader') THEN
        CREATE ROLE ai_vector_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ai_vector_ingest') THEN
        CREATE ROLE ai_vector_ingest NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
    END IF;
END $$;

REVOKE ALL ON SCHEMA ai FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA ai FROM PUBLIC;
REVOKE ALL ON FUNCTION ai.model_versions_immutable(), ai.model_versions_insert_staging() FROM PUBLIC;
DO $$
BEGIN
    -- Supabase API roles must never see the vector schema (they do not exist on plain PostgreSQL QA).
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON SCHEMA ai FROM anon; REVOKE ALL ON ALL TABLES IN SCHEMA ai FROM anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE 'REVOKE ALL ON SCHEMA ai FROM authenticated; REVOKE ALL ON ALL TABLES IN SCHEMA ai FROM authenticated';
    END IF;
END $$;

GRANT USAGE ON SCHEMA ai, extensions TO ai_vector_reader, ai_vector_ingest;

-- Online serving: read the active pointer, version identity and vectors. Nothing in "public".
GRANT SELECT ON ai.active_index, ai.model_versions, ai.product_image_embeddings TO ai_vector_reader;

-- Offline ingestion: register STAGING versions, write vectors and journal rows, read the narrow catalog view.
-- Verification and activation (status changes, ai.active_index) stay with the operator/migration role: the worker can
-- only create a version (status defaults to STAGING, enforced below) and record its expected image count.
GRANT SELECT ON ai.catalog_images, ai.model_versions, ai.active_index TO ai_vector_ingest;
GRANT INSERT ON ai.model_versions TO ai_vector_ingest;
GRANT UPDATE (expected_images) ON ai.model_versions TO ai_vector_ingest;
GRANT SELECT, INSERT, UPDATE, DELETE ON ai.product_image_embeddings TO ai_vector_ingest;
GRANT SELECT, INSERT, UPDATE ON ai.ingestion_jobs TO ai_vector_ingest;
-- The view reads public tables with its owner's rights; the worker itself gets no direct grant on them.

COMMIT;
