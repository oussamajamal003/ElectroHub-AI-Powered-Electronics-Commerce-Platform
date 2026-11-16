-- Keep the persisted preference and consent timestamp in the same state.
-- The service already writes these values together; this also protects against other DB writers.
ALTER TABLE "recommendation_preferences"
  ADD CONSTRAINT "recommendation_preferences_consent_consistency_check"
  CHECK (
    ("personalizationEnabled" = TRUE AND "consentedAt" IS NOT NULL)
    OR ("personalizationEnabled" = FALSE AND "consentedAt" IS NULL)
  );
