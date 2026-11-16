# Task 05.2 — Implementation Plan, Architecture Decisions and API Contracts

Companion to `TASK_05.2_RECOMMENDATIONS_ANALYTICS_ADMIN_SECURITY_UX.md` (the authoritative scope). This file records the M0
baseline, the decisions taken and the exact contracts implemented. Evidence lives in `TASK_05.2_IMPLEMENTATION_EVIDENCE.md`.

## M0 baseline (2026-11-04/05)

| Item | Value |
|---|---|
| Branch | `feature/05.2-admin-advanced-features` (reused; HEAD = `origin/develop` = `581726eff055db1dca4778c6e17ce86228509a1f`) |
| Working tree at start | clean except the untracked task file |
| Shared DEV | `pzxekjybdiulzmssalfo` (enforced by `.github/scripts/migration-plan.cjs` through `scripts/dev-migrate.cjs`) |
| PROD | `yepfgjehdstlxbpespun` — not touched by this task |
| Disposable PostgreSQL | local PostgreSQL 18 binaries, fresh loopback cluster per run (pattern of `scripts/recommendation-fbt-pg.cjs`) |
| Local runtime | frontend `:3000`, backend `:5000` (local Express → shared DEV) |

### Session-issuance audit (A03)

Every path that mints an access/refresh pair goes through `AuthService.createSession` or `AuthService.refreshSession`:
`POST /auth/login`, `POST /auth/verify-email` (registration OTP), Google completion (`establishCustomerSession`, CUSTOMER-only
already) and `POST /auth/refresh`. Password reset, email change and account routes never mint tokens. Socket.IO authenticates
with the access token (`sockets/socket-auth.ts`).

## Architecture decisions

1. **One choke point for ADMIN sessions.** `createSession` refuses an ADMIN account unless called by the MFA service with a
   verified factor; `/auth/login` for an ADMIN returns a restricted MFA transaction instead of tokens. `refreshSession` refuses an
   ADMIN family without a live `AdminSession`. Legacy admin refresh families (pre-cutover) therefore die on first use — the
   cutover is enforced, not grandfathered.
2. **Session assurance is DB-authoritative.** ADMIN access tokens carry `sessionId` (= refresh `familyId`). `requireAuth` checks
   `admin_sessions` (unrevoked) AND a live refresh token in that family on every request, so logout, password change/reset, reuse
   detection, deletion and explicit revocation cut access immediately. Socket.IO handshakes apply the same check.
3. **Pre-auth transactions** (`admin_auth_challenges`): random 32-byte token, SHA-256 digest stored, 5-minute TTL, 5 attempts,
   single use (conditional `consumedAt` update), bound to the password-hash fingerprint the primary proof was checked against.
4. **TOTP**: RFC 6238 (SHA-1, 6 digits, 30 s, ±1 step) over `node:crypto` HMAC, verified against RFC test vectors; seeds AES-256-GCM
   encrypted under a versioned key (`ADMIN_MFA_ENCRYPTION_KEYS="1:<base64 32 bytes>"`, `ADMIN_MFA_ACTIVE_KEY_VERSION`), replay guard by
   atomic `lastUsedStep` compare-and-set. Missing key = fail closed.
5. **Recovery codes**: 10 codes × 60 bits, HMAC-SHA256 (keyed by the active MFA key) digests, single-use conditional update,
   regeneration revokes the previous batch.
6. **WebAuthn**: `@simplewebauthn/server` (second factor only, no passwordless). RP ID/origin from `WEBAUTHN_RP_ID` /
   `WEBAUTHN_ORIGIN` (default `localhost` / `FRONTEND_URL`), user verification required, challenge stored on the pre-auth or
   step-up transaction, counter monotonic, credentials owned per user.
7. **Bootstrap / existing admins**: a factor-less ADMIN may enroll only inside an operator-granted window
   (`admin_account_security.enrollmentAllowedUntil`), set by `npm run admin:security -- authorize-enrollment <email>` (DEV/operator
   CLI, never an HTTP route). `grant-owner` works only while no owner exists. Invitation acceptance grants a 24 h window.
8. **Capabilities**: `isOwner` and `canManageAdmins` (durable rows), checked server-side per request. New invitees get no
   capability unless the inviter (an owner) explicitly grants `MANAGE_ADMINS`. Last owner / last factor protected.
9. **Invitation link** carries the token in the URL fragment (`/admin/invite#token=…`): never sent to any server in a request line,
   never in referrers; the page clears it with `history.replaceState`. Possession of the emailed token is the email-ownership proof.
10. **Shipping settings** replace the 03.5 constants through one snapshot loaded from `shipping_settings` /
    `shipping_method_settings`; the cart revision hash keeps its exact 03.5 inputs when settings equal the seed, so the deploy does
    not invalidate in-flight checkouts, and any later change changes the revision (stale quotes → existing 409 path). Order and
    payment snapshots are never rewritten.
11. **Recommendation conversion** is derived at read time from authoritative facts only: paid, non-refunded orders whose customer had
    consented `RECOMMENDATION_CLICK` interactions on the same product within 7 days before the order (last-click, consenting signed-in
    customers only). Non-personal `recommendation_events` support impressions/clicks/CTR, never conversion.
12. **Categories** in analytics are current-catalog categories (order items carry no category snapshot) and are labelled so.

## Lane ownership (parallel implementation)

| Lane | Owns |
|---|---|
| Lead (security core) | schema/migration, `middleware/auth.ts`, `middleware/adminGuard.ts`, `services/admin-session.ts`, `services/admin-audit.ts`, auth service/repository/controller/routes, admin MFA/invitation/session services and routes, socket auth, `routes/index.ts`, frontend `routes/index.tsx`, `features/admin/shell/navigation.ts`, `layouts/AdminLayout.tsx` |
| Analytics | analytics service/routes/controller, image-search instrumentation, `/admin/analytics` page |
| Recommendations | recommendation admin service/routes, recommendation.service integration, customer rail label, `/admin/recommendations` page |
| Settings | settings + shipping snapshot services/routes, checkout/payment/order shipping integration, `/admin/settings` Store/Notifications/Shipping tabs |
| Bulk | catalog bulk-status API, products-table selection |
| Security UI | admin login MFA, invitation acceptance, profile/security/sessions, team & invitations pages, AuthContext admin MFA handling |

## Authentication / administrator API contracts

Envelopes: success `{ data, meta? }` for `/api/admin/**`; errors `{ error: { code, message } }`. Session success bodies on
`/api/auth/**` keep the existing login shape `{ accessToken, user }` and set the httpOnly refresh cookie.

### Pre-auth (public, challenge-bound) — `/api/auth`

| Method + path | Body | Success | Errors |
|---|---|---|---|
| `POST /login` (existing) | `{ email, password }` | CUSTOMER unchanged. ADMIN: `200 { requiresMfa: true, mfaToken, expiresAt, enrollmentRequired, factors: { totp, passkey, recoveryCode } }`, no cookie | `401 Invalid credentials`, `403 ENROLLMENT_NOT_AUTHORIZED` (factor-less admin without operator window) |
| `POST /admin/mfa/totp/verify` | `{ mfaToken, code }` | `200 { accessToken, user }` + cookie | `401 MFA_CHALLENGE_INVALID`, `401 MFA_CODE_INVALID`, `429 MFA_ATTEMPTS_EXCEEDED` |
| `POST /admin/mfa/recovery/verify` | `{ mfaToken, code }` | same | same |
| `POST /admin/mfa/webauthn/options` | `{ mfaToken }` | `200 { options }` | `401 MFA_CHALLENGE_INVALID`, `422 NO_PASSKEY` |
| `POST /admin/mfa/webauthn/verify` | `{ mfaToken, response }` | `200 { accessToken, user }` + cookie | `401 MFA_CODE_INVALID` |
| `POST /admin/mfa/enrollment/start` | `{ mfaToken }` | `200 { factorId, otpauthUri, secret }` | `403 ENROLLMENT_NOT_AUTHORIZED`, `409 ALREADY_ENROLLED` |
| `POST /admin/mfa/enrollment/confirm` | `{ mfaToken, factorId, code }` | `200 { accessToken, user, recoveryCodes: string[] }` + cookie | `401 MFA_CODE_INVALID` |
| `POST /admin/invitations/preview` | `{ token }` | `200 { email, expiresAt }` | `410 INVITATION_UNAVAILABLE` (generic) |
| `POST /admin/invitations/accept` | `{ token, firstName, lastName, password }` | `201` same body as ADMIN `/login` (`enrollmentRequired: true`) | `410 INVITATION_UNAVAILABLE`, `409 ACCOUNT_EXISTS`, `400` |

### Self-service (MFA-assured session) — `/api/admin/me`

`GET /profile`, `PATCH /profile {firstName,lastName}`, `POST /security/step-up {method:'TOTP'|'RECOVERY_CODE', code}`,
`POST /security/step-up/webauthn/options`, `POST /security/step-up/webauthn {response}`, `GET /security/factors`,
`POST /security/totp {label}` → `{factorId, otpauthUri, secret}`, `POST /security/totp/:id/confirm {code}`,
`DELETE /security/totp/:id`, `POST /security/recovery-codes` → `{codes}`, `POST /security/passkeys/options`,
`POST /security/passkeys {response, label}`, `PATCH /security/passkeys/:id {label}`, `DELETE /security/passkeys/:id`,
`GET /sessions`, `DELETE /sessions/:id`, `POST /sessions/revoke-others`, `GET /login-history?page`.
Factor/recovery/passkey/session-of-others writes require step-up (`403 STEP_UP_REQUIRED`); removing the last usable factor →
`409 LAST_FACTOR`.

### Team — `/api/admin` (MANAGE_ADMINS; writes also step-up)

`GET /administrators`, `PATCH /administrators/:id/access {isActive?, canManageAdmins?}` (OWNER; `409 LAST_OWNER`/`SELF_CHANGE`),
`GET /invitations?status`, `POST /invitations {email, grantManageAdmins?}` (`409 INVITATION_EXISTS`/`ACCOUNT_EXISTS`),
`POST /invitations/:id/resend`, `POST /invitations/:id/revoke`.

## Migration

`20261105000000_admin_security_settings_analytics` — additive (15 tables, 4 enums, 11 enum values, seed rows equal to previous
constants, CHECK constraints, partial unique pending-invitation index, RLS/REVOKE like 04.5). DEV gate:
`node scripts/admin-security-migrate.cjs pre|deploy|post`. PROD: only through the reviewed release workflow after approval.
