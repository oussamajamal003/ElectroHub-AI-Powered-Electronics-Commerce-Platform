# Development administrator activation without real inboxes

Task 05.2. This runbook covers how the seeded development administrators (`admin1@electrohub.com` … `admin4@electrohub.com`) are made usable without anyone controlling their mailboxes, and how local QA exercises the real activation and recovery emails without sending them.

> **This is not email verification and not a production account-recovery mechanism.** Seed provisioning proves that an operator authorized setup of one known development identity. It never sets or relies on `emailVerifiedAt`, and it is refused on production by design.

## Two trust models, never mixed

| | Normal administrator activation | Seeded DEV provisioning |
|---|---|---|
| Who authorizes | An Owner, in the console, with a fresh MFA step-up | An operator, with the `admin:security` CLI, naming the exact database, account, tester and reason |
| Proof the user holds | A single-use link emailed through Brevo (mailbox possession) | A single-use link handed over out of band in a private file (operator handoff) |
| Where it is redeemed | `/admin/activate` → `POST /api/auth/admin/activation/redeem` | `/admin/provision` → `POST /api/auth/admin/provisioning/redeem` |
| Proof purpose (`admin_mfa_activations.purpose`) | `OWNER_ACTIVATION` | `SEED_PROVISIONING` |
| Audit | `ADMIN_MFA_ACTIVATION_REQUESTED` / `…_REDEEMED` | `ADMIN_SEED_PROVISIONING_AUTHORIZED` / `…_REDEEMED` / `…_REVOKED`; `ADMIN_SEED_IDENTITY_REGISTERED` |
| Afterwards (identical) | The password is rotated. Every session, refresh family and pending sign-in challenge is revoked. Only a 30-minute first-factor enrollment window opens: TOTP must be confirmed and recovery codes saved before any ADMIN session exists. | (same) |

A proof is accepted only on its own endpoint. An emailed activation token is refused by `/admin/provisioning`, and an operator setup link is refused by `/admin/activate`. An Owner cannot "resend" an operator setup as an email (`PROVISIONING_PENDING`).

Neither path changes the account's role, `isOwner`, `canManageAdmins` or `emailVerifiedAt`. Neither restores deleted accounts or bypasses deactivation. Neither applies to an account that already has a factor (lost factors follow the separate MFA recovery procedure).

## A. Local / disposable QA: captured email

No real email leaves the machine.

1. Start a disposable stack with capture:
   ```bash
   cd apps/backend
   TASK05_2_EMAIL_CAPTURE=1 TASK05_2_API_PORT=5205 TASK05_2_FRONTEND_PORT=3205 node scripts/task05-2-browser-stack.cjs
   ```
   The stack runs on its own loopback PostgreSQL. Brevo is not configured. Mail to `.invalid` recipients is written as JSON into `<run dir>/outbox`; the path is `outboxDir` in `.cache/task05-2-browser-credentials-5205.json`. Every other recipient is refused.
2. Owner activation:
   1. The Owner signs in and enrolls.
   2. **Settings → Administrators → Activate account**, then **Send activation link**.
   3. The activation email appears in the outbox (`sha256("<to>:<subject>").json`).
   4. Open its `/admin/activate#token=…` link, choose a new password, set up TOTP, save the recovery codes, and sign in with password + TOTP.
3. Forgot password: **Forgot Password?** → the reset code arrives in the outbox → enter it → prove the existing factor → set a new password.
4. Automated journeys: `cd apps/frontend && npm run test:visual:task05-2-dev-activation`.

**Guards:**
- Capture is honoured only with `NODE_ENV=test`, or with `NODE_ENV=development` against a loopback database.
- The server refuses to boot with `E2E_OTP_OUTBOX_DIR` set in production, or in development against a remote database. Shared DEV therefore keeps using Brevo for real administrators.
- Tokens never appear in application logs; the outbox lives in git-ignored `.cache` and is removed with the run directory.

Mailpit was not adopted: it is not installed, Docker is unavailable on the reference workstation, and the task forbids new dependencies. The file outbox is the repository's existing test email sink, extended as above.

## B. Shared DEV: operator provisioning of seed administrators

### Before anything is run

Every real shared DEV execution needs a **separate explicit authorization** naming:
- the target administrator (email **and** id),
- the tester who will control the account,
- the exact database (`pzxekjybdiulzmssalfo`),
- the permitted action.

Implementing this procedure is not that authorization.

The schema change (`20261108000000_admin_seed_provisioning`: `admin_seed_identities`, plus `admin_mfa_activations.purpose`/`operatorName`/`operatorReason`) must be applied to shared DEV first. That is also a separately approved step. Until it is applied, a backend built from this branch fails to read activations on shared DEV.

### Allowed targets

The CLI resolves the database identity from `DATABASE_URL` itself:
- `local` for a loopback cluster;
- otherwise the Supabase project ref (an ambiguous pooler user/host pair resolves to `unknown`).

The seed commands accept only `local` and `pzxekjybdiulzmssalfo`, and `--confirm-target` must name it exactly. Production (`yepfgjehdstlxbpespun`), unknown identities and `NODE_ENV=production` are refused before any database access. The application's own database-target guard also rejects unapproved URLs at start-up.

### Commands

Run from `apps/backend`:

```bash
# 1. Read-only overview: id, active, Owner, management, factor count and provenance (SEED | OPERATOR | NONE) of the seed accounts.
npm run admin:security -- seed-status --confirm-target=pzxekjybdiulzmssalfo

# 2. Accounts seeded before provenance existed show provenance NONE. Record the EXACT id after checking it out of band.
npm run admin:security -- register-seed-identity admin1@electrohub.com --user-id=<uuid> \
  --operator="<your name>" --reason="<ticket / why>" --confirm-target=pzxekjybdiulzmssalfo

# 3. Issue the one-time setup link into a private file OUTSIDE any git checkout (the file must not exist; owner-only where supported).
npm run admin:security -- provision-seeded-admin admin1@electrohub.com --user-id=<uuid> \
  --operator="<your name>" --tester="<person who will use the account>" --reason="<ticket / why>" \
  --handoff-file="<private folder>/admin1-setup.txt" --confirm-target=pzxekjybdiulzmssalfo [--minutes=30]

# 4. Hand the file to the tester privately and delete it. If plans change:
npm run admin:security -- revoke-seed-provisioning admin1@electrohub.com --user-id=<uuid> \
  --operator="<your name>" --reason="<why>" --confirm-target=pzxekjybdiulzmssalfo
```

**What the tester does with the link:**
1. Opens `/admin/provision#token=…`. The token is removed from the address bar on load.
2. Chooses a new unique password. The unknown seeded password stops working.
3. Sets up an authenticator app, confirms a code and saves the recovery codes.
4. From then on, signs in with password + TOTP like every administrator.

The deployment serving `/admin/provision` must run with `ADMIN_SEED_PROVISIONING_ENABLED=true`. Never set it in production; the server refuses to start with it there.

### What is refused (each refusal is audited `DENIED` with its code, except target refusals, which write nothing)

| Code | Meaning |
|---|---|
| `PRODUCTION_REFUSED`, `TARGET_NOT_ALLOWED`, `TARGET_CONFIRMATION_MISMATCH` | Wrong or unconfirmed database, or production mode. |
| `APPROVAL_REQUIRED` | Missing operator, tester or a reason of at least 10 characters. |
| `NOT_SEED_EMAIL`, `PRIMARY_OWNER_REFUSED` | Only `admin1–2`; never `admin@electrohub.com`. |
| `USER_ID_REQUIRED`, `USER_NOT_FOUND`, `IDENTITY_MISMATCH` | The id must be the exact account holding that email. |
| `NOT_ADMIN`, `ACCOUNT_INACTIVE`, `ACCOUNT_DELETED`, `OWNER_REFUSED` | Customers, deactivated, deleted (anonymized) and Owner accounts. |
| `PROVENANCE_MISSING` | Not a recorded seed identity (for example, an account recreated with the same email after the original was deleted). |
| `SUPERSEDE_REQUIRED`, `PROVENANCE_CONFLICT`, `ALREADY_REGISTERED` | Replacing the provenance of a deleted original needs `--supersede-deleted`; a live holder is never displaced. |
| `ALREADY_ENROLLED`, `PENDING_EXISTS`, `NOT_PENDING` | First-time setup only; one pending proof per account. |

**Provenance:**
- The seed records `admin_seed_identities` (source `SEED`) only for accounts it creates itself, bound to the user id.
- Existing accounts are never assumed to be seed identities. Re-running the seed never resets passwords, permissions or factors.

### Forgot password for a seeded DEV administrator

| Situation | Procedure |
|---|---|
| **No factor yet** | Issue a new setup link (step 3). |
| **Factor enrolled, password forgotten, still has the authenticator, a recovery code or a passkey** | Issue an operator recovery link (below). It replaces **only** the email-code step of the normal Forgot Password flow; the existing factor is still required. Never send fake codes, reveal codes, or reset the password or MFA from the database. |
| **All factors lost** | Follow the separately approved high-assurance MFA recovery policy (`reset-mfa`, with out-of-band identity verification). It is never triggered just because a password was forgotten. |

#### Operator recovery link (`recover-seeded-admin-password`)

Same guards as provisioning: allowed targets only (`local` or shared DEV, exact `--confirm-target`, refused under `NODE_ENV=production` and on
production before any database access), seed email + exact `--user-id`, recorded provenance, not an Owner, active, not deleted, and named
`--operator`, `--tester` and `--reason`. Unlike provisioning, the account **must already have** a factor (`NOT_ENROLLED` otherwise).

```bash
cd apps/backend
npm run admin:security -- recover-seeded-admin-password admin1@electrohub.com --user-id=<uuid> --operator="<name>" --tester="<name>"   --reason="<why>" --handoff-file=<private path outside any git checkout> --confirm-target=<ref> [--minutes=30]
# Withdraw an unused link:
npm run admin:security -- revoke-seed-password-recovery admin1@electrohub.com --user-id=<uuid> --operator="<name>" --reason="<why>" --confirm-target=<ref>
```

- The handoff file holds `/admin/forgot-password#seed-recovery=<proof>`. The proof is hashed in `admin_mfa_activations` (purpose
  `SEED_PASSWORD_RECOVERY`), lasts 30 minutes by default (5–60), is single use and is never printed or audited.
- Opening the link removes the fragment from the address bar and redeems it once at `POST /api/auth/admin/password-recovery/seed-proof`
  (mounted only when `ADMIN_SEED_PROVISIONING_ENABLED=true` outside production). This opens the ordinary recovery transaction: the tester
  must then pass TOTP, a recovery code or a passkey before a new password can be set. No session or reset authorization comes from the
  proof itself.
- It never resets or disables factors, never sets `emailVerifiedAt`, and never changes Owner or management capabilities. It is not accepted
  by `/admin/provision` or `/admin/activate`, and Owners do not see it as an activation on the Administrators page.
- Redemption re-checks the live account (still the seed identity, active, non-Owner, still has a factor). Expired, revoked, reused or
  ineligible proofs return `410 SEED_RECOVERY_UNAVAILABLE` and are audited `ADMIN_SEED_PASSWORD_RECOVERY_REDEEMED` / `DENIED` with a code
  (`EXPIRED`, `ALREADY_USED`, `REVOKED`, `NOT_ENROLLED`, …). Issue and revoke are audited as `ADMIN_SEED_PASSWORD_RECOVERY_AUTHORIZED` /
  `_REVOKED` with operator, tester and reason.
- Migration `20261109000000_admin_seed_password_recovery` adds the enum value only (additive).

## Verification

- `apps/backend`: `node scripts/admin-security-pg.cjs` (PROV-01…08 and REC-01…04 on disposable PostgreSQL, including the real CLI).
- `apps/backend`: `npx vitest run src/integrations/brevo` (capture guard).
- `apps/frontend`: `npx vitest run src/pages/admin/AdminActivatePage src/pages/admin/AdminForgotPasswordPage`.
- Playwright: `npm run test:visual:task05-2-dev-activation` on a stack started with `TASK05_2_EMAIL_CAPTURE=1 TASK05_2_API_PORT=5205 TASK05_2_FRONTEND_PORT=3205` (PROV-UI-01…04; PROV-UI-04 is the seed recovery link).
