BEGIN;

ALTER TABLE "users"
  ADD COLUMN "profile_photo_path" VARCHAR(512);

-- Supabase Storage bucket metadata is versioned with the application database, but plain
-- disposable PostgreSQL used by backend tests has no Storage schema. Keep that environment
-- portable while provisioning a private, image-only bucket when running on Supabase.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('profile-photos', 'profile-photos', false, 5242880, ARRAY['image/webp']::text[])
    ON CONFLICT (id) DO NOTHING;

    IF NOT EXISTS (
      SELECT 1
      FROM storage.buckets
      WHERE id = 'profile-photos'
        AND name = 'profile-photos'
        AND public = false
        AND file_size_limit = 5242880
        AND allowed_mime_types = ARRAY['image/webp']::text[]
    ) THEN
      RAISE EXCEPTION 'The profile-photos bucket exists with unexpected access or upload restrictions';
    END IF;
  END IF;
END $$;

COMMIT;
