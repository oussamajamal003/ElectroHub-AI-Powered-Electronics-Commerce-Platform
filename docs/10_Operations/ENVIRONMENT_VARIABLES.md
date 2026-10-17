# Environment Variables

## Google OAuth (Task 02.4-C)

Backend-only `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REDIRECT_URI` enable customer Google sign-in. Register GOOGLE_REDIRECT_URI exactly in the Google Web application client's authorized redirects. Development uses `http://localhost:3000/api/auth/google/callback`; production must use HTTPS. The callback must share the configured FRONTEND_URL origin through the API proxy. Set a strong JWT_SECRET (at least 16 characters); it also authenticates the five-minute OAuth transaction cookie. No additional provider-token session or linking-token secret is needed. Leave Google variables empty to keep the provider unavailable safely. Never put the client secret in frontend/Vite configuration.

## 1. Purpose

This document defines how ElectroHub environment variables are organized, protected, and managed.

Environment variables are used to separate configuration and secrets from application source code.

---

# 2. Environment Separation

The project uses environment-specific configuration:

```text
Development
Testing
Production
```

Production secrets must never be reused casually in development or testing.

---

# 3. Variable Categories

Variables generally belong to:

```text
Application
Database
Authentication
Payments
Email
Media
AI
Deployment
```

---

# 4. Application Variables

Examples:

```text
NODE_ENV
PORT
API_URL
FRONTEND_URL
AI_SERVICE_URL
```

Values must match the target environment.

---

# 5. Database Variables

Example:

```text
DATABASE_URL
DIRECT_URL
DB_SSL_CA_CERT_PATH
```

The database connection must point to the correct environment.

The current API and durable payment runner both import `src/lib/prisma.ts`, which selects `DIRECT_URL || DATABASE_URL` for runtime queries. Startup validation currently requires both variables, so `DIRECT_URL` wins in a normally configured process. `DIRECT_URL` is a variable name, not proof of a direct endpoint: the DEV example uses Supabase's IPv4 session pooler on port 5432; `DATABASE_URL` uses the transaction pooler on port 6543. A true direct endpoint has the `db.<project-ref>.supabase.co` hostname. Do not infer the active mode from the variable name or change connection modes without approved measurements.

Prisma schema configuration declares `url = env("DATABASE_URL")` and `directUrl = env("DIRECT_URL")`; Prisma migration operations use the direct URL. Runtime adapter configuration strips URL-level SSL and `pgbouncer` flags and requires certificate verification in all environments (`rejectUnauthorized: true`). `DB_SSL_CA_CERT_PATH` supplies a trusted CA when needed. There is no development TLS bypass. CLI migration certificate configuration is separate; this task does not apply migrations.

Environment selection is per process: development loads `.env` then `.env.local`; test loads `.env` then `.env.test.local`; production loads `.env` then `.env.production.local`. The later local file overrides inherited variables except the protected port, frontend origin and active webhook signing secret. Financial harnesses and their scoped runner use the test selection and verify runtime values against preflight in memory; credentials are never printed.

The Prisma adapter cap is **10 connections per process**, or **5** when `CI` is set and `NODE_ENV=test`. The API and durable runner are independent processes: one of each can request up to **20**, or **10** for two CI test processes. Additional API instances, test workers, verifier parents and scripts add their own capacity. This is configured capacity, not observed session usage. The historical Supavisor limit of 15 is not currently verified; no pool-size change or claim that exhaustion caused latency is justified from that historical number alone. The global singleton only deduplicates clients within one process, not across processes. Module reload reuses both the client and adapter.

The API closes its HTTP server and exits on shutdown; process exit releases its connections, but it does not currently explicitly await Prisma disconnect. The durable runner disconnects after its normal loop. One-shot scripts must explicitly disconnect Prisma or end their direct `pg` pools; interrupted financial harnesses preserve records and stop only their own process handles. Budget and runner reliability must be verified on the approved environment before financial execution.

`E2E_OTP_OUTBOX_DIR` is for isolated browser tests only. When `NODE_ENV=test`, the email adapter captures messages sent to `.invalid` addresses in this local directory. Keep it under an ignored test output folder and do not set it in production. The real Brevo API is used only outside `NODE_ENV=test`; test mocking is not activated by an inherited `VITEST` flag.

Production database credentials must never be committed.

---

# 6. Authentication Variables

Examples:

```text
JWT_SECRET
JWT_REFRESH_SECRET
```

These values must be strong, secret, and environment-specific.

Secrets must never be exposed to frontend code.

---

# 7. Stripe Variables

Examples:

```text
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
```

The project uses Stripe Test Mode.

Stripe secret keys must remain server-side.

---

# 8. Brevo Variables

Example:

```text
BREVO_API_KEY
```

Brevo is used for:

```text
OTP
Order Confirmation
Payment Confirmation
```

The API key must remain server-side.

---

# 9. Cloudinary Variables

Example:

```text
CLOUDINARY_URL
```

Cloudinary credentials must never be exposed to the public frontend unless the specific architecture explicitly requires a safe public configuration.

---

# 10. AI Variables

Example:

```text
AI_SERVICE_URL
```

The backend should communicate with the FastAPI service through the configured service boundary.

---

# 11. Frontend Variables

Frontend environment variables must contain only values that are safe to expose to the browser.

Never place:

```text
Database Passwords
JWT Secrets
Stripe Secret Keys
Brevo API Keys
Cloudinary Private Credentials
```

into frontend-exposed variables.

---

# 12. Naming

Environment variable names should use:

```text
UPPER_SNAKE_CASE
```

Examples:

```text
DATABASE_URL
JWT_SECRET
BREVO_API_KEY
```

---

# 13. Local Development

Local development should use an environment file that is excluded from Git.

Typical pattern:

```text
.env
.env.local
.env.test
```

The exact files depend on the service and framework.

---

# 14. Git Security

Environment files containing secrets must not be committed.

The repository should contain safe templates where useful, for example:

```text
.env.example
```

Templates must contain placeholders rather than real credentials.

---

# 15. CI/CD Secrets

GitHub Actions secrets should be used for protected CI/CD values.

Production secrets must not be printed in workflow logs.

Only workflows that require a secret should receive access to it.

---

# 16. Docker

Secrets must not be hard-coded into:

```text
Dockerfile
docker-compose.yml
Source Code
```

Production configuration should be injected at runtime through the approved deployment mechanism.

---

# 17. Secret Rotation

Secrets should be rotated when:

```text
Compromise Is Suspected
Team Access Changes
Credential Is Exposed
Provider Requires Rotation
```

After rotation, verify all dependent services.

---

# 18. Validation

Applications should fail safely when required environment variables are missing.

Required configuration should be validated during application startup or deployment.

Avoid silently using insecure defaults for production secrets.

---

# 19. Environment Variable Inventory

The project should maintain an up-to-date inventory covering at minimum:

```text
DATABASE_URL
JWT_SECRET
JWT_REFRESH_SECRET
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
BREVO_API_KEY
CLOUDINARY_URL
AI_SERVICE_URL
```

Additional variables may be introduced as implementation requires.

---

# 20. Security Rules

- [ ] No secrets are committed.
- [ ] Production secrets are separated.
- [ ] Frontend cannot access backend secrets.
- [ ] CI secrets are protected.
- [ ] Docker images contain no secrets.
- [ ] Required variables are validated.
- [ ] Exposed credentials are rotated.

---

# 21. Definition of Done

Environment configuration is complete when:

- Required variables are documented.
- Development configuration works.
- Test configuration is isolated.
- Production configuration is secured.
- Secret handling is documented.
- Required variables are validated.
- No credentials are committed.

---

# 22. Environment Principle

> **Configuration belongs to the environment; secrets belong in protected secret storage, never in source code.**

## Task 03.6 Stripe Test Mode

Backend STRIPE_SECRET_KEY must be a Test Mode server key. STRIPE_WEBHOOK_SECRET authenticates exact raw webhook bytes; the local Stripe CLI supplies its current listener secret in memory. Frontend VITE_STRIPE_PUBLISHABLE_KEY is the matching publishable Test Mode key. Missing/unsupported configuration keeps payment unavailable safely. No raw key values belong in docs, logs, traces or fixtures. The durable runner shares the app's database/provider environment; build backend then run npm run payment:worker under supervision in Phase 06. PROD migration and application deployment are distinct gates; see [Payment Core](../05_Features/PAYMENT_CORE_03.6.md).
