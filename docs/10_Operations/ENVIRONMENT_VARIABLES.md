# Environment Variables

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
```

The database connection must point to the correct environment.

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
