# Authentication

## Task 02.4-C Google OAuth

Customer Login and Register share one Continue with Google control. The popup calls `GET /api/auth/google/start`, which binds authorization to a five-minute, HMAC-signed HttpOnly transaction cookie using the existing JWT secret. State prevents login CSRF; PKCE binds code exchange; nonce binds the verified ID token. The official Google Auth Library validates signature, audience, issuer and expiration. Subject, verified email and nonce are also validated server-side. Provider codes and tokens are never persisted or logged.

`GET /api/auth/google/callback` resolves the canonical `OAuthAccount` by `(GOOGLE, sub)`. Existing identities use their linked active, verified CUSTOMER. New identities with no email/pending-email collision create a verified CUSTOMER with `passwordHash=null` and an OAuthAccount atomically. Database uniqueness resolves concurrent callbacks. Google-only password login returns normal invalid credentials without calling bcrypt on null.

Email equality alone never connects an existing account. A collision returns the `linking_required` popup status. The verified identity remains only in the short-lived HttpOnly transaction cookie. `POST /api/auth/google/link` requires the exact configured frontend Origin and the existing account password; the account must be active, verified and CUSTOMER. It rechecks ownership and cannot move a provider identity between users. Successful connections record GOOGLE_CONNECTED; logins record LOGIN_SUCCESS. Cancellation or retry overwrites/clears transient state; abandoned transactions expire in five minutes.

Successful Google authentication uses the existing refresh cookie, refresh rotation, access JWT and AuthContext. The popup sends only a status to its opener at the configured origin; the frontend validates origin and popup source, then obtains the existing session through refresh/me. No provider tokens are sent in popup messages. Admin Google authentication is unsupported; password admin login remains available.

Configure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI and FRONTEND_URL on the backend. Register the exact callback URI with a Google Web application client. Local development permits `http://localhost:5000/api/auth/google/callback` with frontend origin `http://localhost:3000`. The frontend accepts that explicit callback origin only on this local development origin and also verifies the popup source and message status. Production requires a same-origin callback through the existing `/api` proxy and HTTPS. The callback uses `Cross-Origin-Opener-Policy: unsafe-none` to preserve its cross-origin opener; messages target only the configured frontend origin and contain no tokens. The fallback close-window message appears only without an opener. Redact OAuth query strings in upstream access logs. Missing configuration fails safely. No Google secrets belong in Vite variables.

Migration `20260926000000_google_oauth` adds OAuthProvider, oauth_accounts with subject uniqueness, user/provider-email indexes, foreign key, RLS without public policies, and nullable passwordHash. Generated using Prisma migrate diff against the prior schema. Apply with Prisma migrate deploy; never db push or manually edit the migration ledger. The existing DEV seed remains unchanged and creates password-bearing fixtures only; never seed PROD.

Focused tests stub Google verification while integration tests use DEV fixture accounts under `.invalid`, remove them afterward, and verify password/admin compatibility. Browser tests control popup outcomes; they do not prove a live Google console configuration. Real Google verification requires configured credentials and an authorized interactive account.

Google may isolate the popup's browsing context and remove its opener. The local backend callback therefore redirects to `/api/auth/google/complete` on the configured frontend origin. A 30-second HMAC-signed HttpOnly completion cookie carries only the outcome and the transaction's random channel identifier; the completion endpoint validates and clears it, and ignores client-supplied status values. Completion uses explicit-origin postMessage when an opener exists, otherwise a transaction-specific same-origin BroadcastChannel. Neither mechanism creates a session: the frontend must obtain the actual backend session through refresh/me. Completion URLs contain no tokens or outcome credentials. Google authorization uses `prompt=select_account` without `login_hint` or `hd`; the available account list is controlled by Google's active browser sessions.

## Task 02.4-B recovery and security events

Password recovery uses a `PASSWORD_RESET` OTP followed by a short-lived, single-use `PasswordResetToken` authorization. The token is stored only as a SHA-256 hash, cannot authenticate a session, and is consumed atomically with the password update and refresh-session revocation.

Customer security OTPs expire after 1 minute (60 seconds); reset authorization expires after 10 minutes. Both are single-use. Access JWTs expire after 15 minutes and refresh tokens after 7 days. Password changes and resets revoke refresh sessions, but already-issued access JWTs remain valid for at most 15 minutes; immediate access-token revocation is not implemented.

Password changes and resets update the hash, revoke all refresh sessions, and persist a `SecurityEvent` in one database transaction. Email notifications run after that transaction and failed delivery is recorded separately. Email verification also persists an `EMAIL_VERIFIED` event. The `20260925000000_security_events` migration creates the event table with RLS enabled and no public policies.

## Task 02.4-B profile and recovery contracts

- `PATCH /api/auth/me` updates first and last name. An email change stores `pendingEmail`, sends an `EMAIL_CHANGE` OTP, and leaves the current email and session valid until OTP verification.
- The same pending-email rule applies when correcting an unverified registration: the verified/current `User.email` is not replaced before successful OTP verification. Brevo acceptance means only that the provider accepted a send request; it does not prove delivery, mailbox existence, or ownership. Ownership is proven only when the user submits the correct, unexpired OTP. A failed send leaves the original email authoritative and permits a rate-limited resend; abandoned pending addresses expire with their OTP and are not activated.
- `POST /api/auth/me/verify-email-change` consumes the authenticated customer's email-change OTP, promotes the pending address, and writes `EMAIL_CHANGED`. `POST /api/auth/me/resend-email-change` uses the OTP resend cooldown and rate limit.
- `POST /api/auth/change-verification-email` requires the current unverified email, its password, and the corrected address. It supersedes the previous `EMAIL_VERIFICATION` challenge. Duplicate-target and non-matching requests use a generic response to avoid exposing account ownership; the new address is never marked verified by the change request.
- Resend endpoints retain IP rate limiting (10 requests per 15 minutes) and OTP challenge cooldowns. Verification resend returns the same generic `200` body for unknown addresses and challenge cooldowns; the IP-wide limiter may still return `429`. Known-account and unknown-account DB paths can differ slightly in timing; this remains a residual side-channel risk.
- `POST /api/auth/forgot-password` and `POST /api/auth/resend-password-reset` return an enumeration-safe response. Both use only the `PASSWORD_RESET` OTP purpose.
- `POST /api/auth/verify-reset-otp` consumes the reset OTP and issues a reset authorization valid for ten minutes. `POST /api/auth/reset-password` accepts only that authorization and a new password. Replaying either the OTP or authorization fails.
- OTP validation errors use the structured `{ error: { code, message } }` response. `OTP_INCORRECT`, `OTP_EXPIRED`, `OTP_CONSUMED`, and `OTP_INVALID` return `400`; `OTP_ATTEMPTS_EXHAUSTED` returns `429`. Unexpected system failures use a generic `500` response.
- The password-reset IP limiter returns `429` with neutral copy: “Too many password reset attempts. Please try again in an hour.” The response does not identify whether an account or challenge exists.
- Email delivery records use `SENT` to mean Brevo accepted the API request and supplied a message ID. It does not assert inbox delivery, mailbox existence, or ownership. Brevo rejection logs/records retain only safe HTTP status/provider code or a generic network category; raw provider messages are not exposed.
- Outside `NODE_ENV=test`, the Brevo adapter always uses the configured provider. Test-only message capture/mocking is not selected from the `VITEST` process flag.
- Password changes and email changes preserve the current authenticated identity while revoking refresh sessions only for password changes/resets.

## Task 02.4-D customer account deletion

`POST /api/account/deletion/reauth/password` verifies the authenticated CUSTOMER's current password and sets a five-minute HttpOnly, SameSite=Strict, purpose- and user-bound deletion proof. Google-only customers use `POST /api/auth/google/deletion-reauth/start` followed by the existing state/nonce/PKCE callback. The callback compares the verified Google subject with the exact GOOGLE OAuthAccount linked to the current customer; it does not create a login session. Hybrid customers may use either available method. The endpoints require the configured frontend Origin and use the account security rate limiter.

`GET /api/auth/me` and successful login responses include `authMethods.password` and `authMethods.google` booleans so the UI offers only methods actually linked to the customer; password hashes and provider subjects are never returned.

`DELETE /api/account` accepts only `{ "confirmation": "DELETE" }`, the current authenticated CUSTOMER identity, and a valid deletion proof cookie. It clears the access-token client state and refresh cookie after the database transaction commits. Protected API authentication reloads the current User and rejects inactive accounts, so an access JWT issued before deletion stops authorizing requests immediately.

Deletion runs as one Prisma transaction. Refresh tokens, OTP challenges, password-reset authorization, OAuthAccount, addresses, cart, wishlist, and prior security events are deleted; customer-linked email-delivery records retain their relation to the anonymized tombstone but have their recipient and failure details sanitized. The User row becomes an inactive, non-authenticating tombstone with a synthetic `.invalid` email and generic name because `Order.userId` is required and uses `onDelete: Restrict`. This preserves order/admin/fulfillment joins without preserving login credentials. A minimal `ACCOUNT_DELETED` event remains linked only to that pseudonymous tombstone and contains no customer snapshot.

Order, OrderItem, Payment, and Delivery transaction records are retained. Shipping recipient/address and destination coordinates remain unchanged for orders in `CONFIRMED`, `PREPARING`, or `OUT_FOR_DELIVERY` so fulfillment can complete. For `DELIVERED` and `CANCELLED` orders, customer-identifying shipping fields and delivery coordinates are redacted; order totals, items, payment state/provider references, tracking identifiers, and fulfillment status remain. The repository defines no automated post-fulfillment purge or legal retention period; none is introduced here, and this behavior is not a claim of legal compliance.

Expected errors use the existing structured API contract: 401 for unauthenticated/unavailable accounts, 400 for password/confirmation validation, 403 for missing/invalid deletion proof or identity mismatch, 429 for security throttling, and sanitized 500 only for unexpected failures. Production migration preflight must review the exact `ACCOUNT_DELETED` enum migration and history before an approved deployment. Account deletion and destructive browser tests are DEV/test-only; PROD is never seeded or used for deletion tests.

## 1. Purpose

This document defines the authentication and account-security behavior for ElectroHub.

Authentication is implemented by the backend and applies to:

- Customer accounts.
- Administrator accounts.
- Protected API requests.
- OTP verification.
- Session/token management.

The frontend is not a security boundary.

---

## 2. Authentication Architecture

```text
User
 ↓
React Frontend
 ↓
Backend Authentication API
 ↓
Validation
 ↓
Credential / OTP Verification
 ↓
JWT + Refresh Token
 ↓
Authenticated Session
```

All sensitive authentication decisions are enforced server-side.

---

## 3. Registration

A customer can create an account through the registration flow.

Conceptually:

```text
Registration Form
 ↓
Frontend Validation
 ↓
Backend Validation
 ↓
Account Creation
 ↓
Password Hashing
 ↓
OTP / Verification Flow where required
 ↓
Account Ready
```

The backend must validate all submitted registration data.

---

## 4. Login

The login flow is:

```text
Email / Credentials
 ↓
Backend
 ↓
Validate Credentials
 ↓
Authentication Success
 ↓
Issue Session Tokens
```

Authentication failures must return safe messages and must not unnecessarily reveal whether a specific account exists.

---

## 5. Password Security

Passwords must:

- Never be stored in plaintext.
- Never be logged.
- Never be returned through APIs.
- Be hashed using an approved password-hashing algorithm.
- Be handled only by trusted backend authentication logic.

---

## 6. OTP

OTP is used where verification is required by the authentication workflow.

Flow:

```text
User Requests OTP
 ↓
Backend Generates OTP
 ↓
OTP Stored Securely / Temporarily
 ↓
Brevo
 ↓
User Email
 ↓
User Submits OTP
 ↓
Backend Verifies OTP
 ↓
Verification Result
```

OTP requirements:

- Secure generation.
- Expiration.
- Single-use behavior.
- Attempt limits.
- Request rate limiting.
- No OTP values in logs.
- No OTP values in API responses.

---

## 7. Brevo Email Integration

Brevo is used for transactional authentication email.

The backend is responsible for communicating with Brevo.

```text
Backend
 ↓
Email Service
 ↓
Brevo
 ↓
User Email
```

Brevo credentials must remain server-side.

Possible authentication email events include:

```text
OTP Requested
OTP Verification
Account Verification
```

The exact email templates should follow the approved design and feature requirements.

---

## 8. JWT

JWTs are used for authenticated API access.

The backend must:

- Sign tokens securely.
- Validate signatures.
- Validate expiration.
- Validate relevant claims.
- Avoid unnecessary sensitive information in token payloads.

JWT signing secrets must be stored securely in environment configuration.

---

## 9. Refresh Tokens

Refresh tokens support continued authenticated sessions.

The implementation must define:

- Expiration.
- Secure storage.
- Rotation where appropriate.
- Revocation.
- Logout behavior.
- Protection against token theft.

Refresh tokens must never be logged.

---

## 10. Authorization

Authentication determines identity.

Authorization determines permissions.

ElectroHub includes at minimum:

```text
Customer
Administrator
```

Authorization is enforced by the backend.

Example:

```text
Customer
 ├── Own Profile
 ├── Own Cart
 ├── Own Wishlist
 └── Own Orders

Administrator
 ├── Product Management
 ├── Inventory Management
 ├── Order Management
 ├── Delivery Management
 └── Administrative Analytics
```

---

## 11. Protected Routes

Protected frontend routes improve user experience but do not provide security by themselves.

The backend must independently verify:

```text
Authentication
+
Authorization
+
Resource Ownership
```

before performing protected operations.

---

## 12. Resource Ownership

Customers may only access resources they own.

Examples:

```text
GET /orders/:id
GET /wishlist
GET /cart
```

The backend must verify that the authenticated user is authorized to access the requested resource.

Changing an ID in a URL must never provide access to another user's data.

---

## 13. Logout

Logout should invalidate the authenticated session according to the selected token strategy.

The implementation should handle:

- Access-token expiration.
- Refresh-token invalidation/revocation where applicable.
- Client-side authentication state cleanup.
- Redirecting the user to an appropriate public state.

---

## 14. Authentication Errors

Authentication errors should be safe and predictable.

Examples:

```text
Invalid Credentials
Expired OTP
Invalid OTP
Too Many Attempts
Unauthorized
Session Expired
```

Do not expose:

```text
Passwords
OTP values
JWTs
Refresh tokens
Internal authentication errors
```

---

## 15. Rate Limiting

Authentication endpoints require protection against abuse.

Important operations include:

```text
Login
Registration
OTP Request
OTP Verification
Refresh Token
Password-related operations
```

Controls may include:

- Request rate limits.
- Attempt limits.
- Temporary lockout.
- Progressive delays.

---

## 16. Session Security

Authentication state must be handled securely.

The implementation should minimize exposure to:

```text
XSS
Token theft
Accidental logging
Unauthorized reuse
```

Sensitive tokens must not be placed in source code or logs.

---

## 17. Frontend Responsibilities

The frontend is responsible for:

- Authentication forms.
- Form validation.
- Authentication UI.
- Loading states.
- Error feedback.
- Session-aware navigation.
- Protected-route UX.

The frontend is not responsible for final authorization decisions.

---

## 18. Backend Responsibilities

The backend is responsible for:

- Credential verification.
- Password hashing.
- OTP generation and verification.
- JWT issuance and validation.
- Refresh-token handling.
- Role checks.
- Resource ownership.
- Rate limiting.
- Authentication audit events.
- Secure error handling.

---

## 19. Authentication API

The authentication API may include:

```text
POST /api/auth/register
POST /api/auth/login
POST /api/auth/refresh
POST /api/auth/logout
POST /api/auth/otp/request
POST /api/auth/otp/verify
PATCH /api/auth/me
POST /api/auth/me/verify-email-change
POST /api/auth/me/resend-email-change
POST /api/auth/change-verification-email
POST /api/auth/forgot-password
POST /api/auth/resend-password-reset
POST /api/auth/verify-reset-otp
POST /api/auth/reset-password
```

The exact API contract is defined by the backend implementation and `API_GUIDELINES.md`.

---

## 20. Testing

Authentication testing should cover:

```text
Registration
Login Success
Login Failure
OTP Request
OTP Verification
Expired OTP
Invalid OTP
OTP Attempt Limits
Token Expiration
Refresh Token
Logout
Protected Routes
Role Authorization
Resource Ownership
Rate Limiting
```

Critical authentication workflows should also be covered by E2E tests.

---

## 21. Security Requirements

Authentication must satisfy:

- No plaintext passwords.
- No secrets in source control.
- No tokens in logs.
- Server-side authorization.
- Resource ownership checks.
- OTP expiration.
- OTP rate limiting.
- Secure token handling.
- Safe authentication errors.
- HTTPS in production.

---

## 22. Definition of Done

Authentication is complete when:

- Registration works.
- Login works.
- JWT authentication works.
- Refresh-token behavior is implemented.
- OTP delivery through Brevo works where required.
- OTP verification works.
- Roles are enforced.
- Protected APIs are secured.
- Ownership checks are implemented.
- Rate limiting is applied to sensitive endpoints.
- Error states are handled.
- Tests pass.
- Security requirements are verified.

---

## 23. Authentication Principle

> **Authentication establishes identity, while authorization and ownership checks protect every sensitive resource and operation.**
