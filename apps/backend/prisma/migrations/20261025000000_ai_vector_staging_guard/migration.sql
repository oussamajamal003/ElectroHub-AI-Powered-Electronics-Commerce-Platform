BEGIN;

-- Forward-only correction: the original vector migration is already applied to DEV.
-- The narrow ingestion login may mutate only STAGING vectors. Row SHARE locks conflict
-- with activation's model-row UPDATE/FOR UPDATE and are held until the ingestion commits.
-- Thus an activation waits for admitted writes, and a writer waiting behind activation
-- observes the new status and fails. No check depends on a CLI/process-local flag.
CREATE FUNCTION ai.enforce_staging_embeddings() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, ai AS $$
DECLARE
    target_version text;
    target_status text;
BEGIN
    -- Catalog deletion cascades and deliberate operator maintenance retain their
    -- existing authority. The ingestion role has no commerce DELETE or role-switch
    -- privileges; it cannot obtain this path by issuing a catalog mutation.
    IF current_user <> 'ai_vector_ingest' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;

    IF TG_OP = 'UPDATE' AND NEW.embedding_version IS DISTINCT FROM OLD.embedding_version THEN
        RAISE EXCEPTION 'embedding version cannot be reassigned' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'DELETE' THEN target_version := OLD.embedding_version;
    ELSE target_version := NEW.embedding_version;
    END IF;

    SELECT status INTO target_status FROM ai.model_versions
        WHERE embedding_version = target_version FOR SHARE;
    IF target_status IS DISTINCT FROM 'STAGING' THEN
        RAISE EXCEPTION 'ingestion requires a STAGING embedding version' USING ERRCODE = '42501';
    END IF;
    IF TG_OP <> 'DELETE' AND NOT EXISTS (
        SELECT 1 FROM ai.catalog_images
        WHERE product_image_id = NEW.product_image_id AND product_id = NEW.product_id
    ) THEN
        RAISE EXCEPTION 'image is not eligible for catalog ingestion' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;

REVOKE ALL ON FUNCTION ai.enforce_staging_embeddings() FROM PUBLIC;
CREATE TRIGGER embeddings_staging_only BEFORE INSERT OR UPDATE OR DELETE
    ON ai.product_image_embeddings FOR EACH ROW EXECUTE FUNCTION ai.enforce_staging_embeddings();

COMMIT;
