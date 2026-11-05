# ADR-011: Mandatory administrator MFA with DB-authoritative session assurance

Status: Implemented proposal for Principal Architect review; not self-approved.
Date: 2026-11-05. Task: 05.2.

## Context

Before 05.2, `/api/auth/login` returned a full ADMIN access/refresh pair after a password check, and access JWTs (15 minutes) were
honoured without consulting session state, so revoking a refresh family left its access token working until expiry. Administrators
were provisioned only by seed. Task 05.2 requires invitation-only onboarding, mandatory MFA (TOTP, recovery codes, passkeys), per-session
revocation that ends access and refresh together, and no password-only bypass on any legacy path.

## Decision

1. **Single issuance choke point.** `AuthService.createSession` refuses an ADMIN account unless called through
   `createAssuredAdminSession` with a verified factor; `/auth/login` for an ADMIN returns a restricted pre-auth transaction
   (`admin_auth_challenges`: random 32-byte token, SHA-256 digest at rest, 5-minute TTL, 5 attempts, single use, bound to the password-hash
   fingerprint). Google sign-in already issues CUSTOMER sessions only; registration OTP and password reset never issue ADMIN sessions.
2. **Session assurance.** An MFA-assured refresh family gets one `admin_sessions` row in the same transaction (under the existing per-user
   lifecycle lock). ADMIN access tokens carry `sessionId = familyId`. `requireAuth` and the Socket.IO handshake accept an ADMIN identity only
   while that row is unrevoked **and** the family still has a live refresh token — one indexed query per request. Refresh rotation re-checks
   the row under the lifecycle lock. Every revocation path (logout, password change/reset, reuse detection, global revoke, deactivation,
   explicit session revoke, operator MFA reset) therefore ends access and refresh together.
3. **Cutover by enforcement.** Pre-existing admin refresh families have no `admin_sessions` row and are revoked on first use; tokens without
   `sessionId` are refused. There is no grandfathered password-only mode and no debug bypass.
4. **Factors.** TOTP (RFC 6238 over `node:crypto`, ±1 step, monotonic `lastUsedStep` compare-and-set), seeds AES-256-GCM encrypted under a
   versioned key ring with owner-bound AAD; recovery codes (10 × 60 bits) stored as keyed HMAC digests; WebAuthn via
   `@simplewebauthn/server` with required user verification, exact RP ID/origin, server-stored challenges and counter compare-and-set.
   Passkeys are a second factor only (no passwordless sign-in).
5. **Bootstrap and capabilities.** A factor-less ADMIN can enroll only inside an `enrollmentAllowedUntil` window granted by an accepted
   invitation (24 h) or by the operator CLI (`npm run admin:security`, never HTTP, requires `--confirm-target=<database identity>`).
   `isOwner` / `canManageAdmins` are durable rows checked per request; the ADMIN role alone cannot invite. Sensitive writes need a step-up
   within 10 minutes; the last factor and self-access changes are refused.

## Consequences

- Every protected ADMIN request costs one extra indexed query; customers are unaffected (the check runs only for DB role ADMIN).
- Losing the MFA key ring makes TOTP/recovery verification fail closed (503); recovery is operator `reset-mfa` + re-enrollment, never a
  plaintext fallback. Key rotation: add version N+1, set it active; old ciphertext stays readable while its version remains in the ring.
  Recovery verification checks digests under all retained keys, so saved recovery codes also remain usable during rotation. Retire an old
  key only after its TOTP factors and recovery batches have been replaced; removing it intentionally ends their usability.
- Release ordering: deploy migration `20261105000000` → deploy code → run `admin:security grant-owner` / `authorize-enrollment` for the
  operators → operators enroll. Between code deploy and enrollment no administrator can sign in (intended fail-closed window).
