-- Task 05.2 disposable upgrade fixture: state that exists BEFORE 20261105000000 is applied (roles, a legacy password-only admin
-- with a live pre-MFA refresh family, a customer and a historical order line price). Synthetic .invalid identities only.
INSERT INTO "roles" ("id", "name", "description", "createdAt", "updatedAt") VALUES
  (gen_random_uuid(), 'CUSTOMER', 'Standard customer role', now(), now()),
  (gen_random_uuid(), 'ADMIN', 'Administrator', now(), now());
INSERT INTO "users" ("id", "roleId", "email", "passwordHash", "firstName", "lastName", "isActive", "emailVerifiedAt", "createdAt", "updatedAt")
  SELECT '11111111-1111-4111-8111-111111111111', r."id", 'legacy-admin@qa.invalid', 'placeholder', 'Legacy', 'Admin', true, now(), now(), now()
  FROM "roles" r WHERE r."name" = 'ADMIN';
INSERT INTO "refresh_tokens" ("id", "userId", "tokenHash", "expiresAt", "isRevoked", "familyId", "createdAt", "updatedAt") VALUES
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', encode(sha256('legacy-admin-refresh-token'::bytea), 'hex'),
   now() + interval '7 days', false, '22222222-2222-4222-8222-222222222222', now(), now());
