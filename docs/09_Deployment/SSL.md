# SSL

## 1. Purpose

This document defines the SSL/TLS strategy for ElectroHub production.

HTTPS protects communication between users and the production application and is a required part of the production deployment.

---

# 2. SSL/TLS Architecture

Production traffic follows:

```text
Client
 ↓
HTTPS
 ↓
Nginx
 ↓
Dockerized Application
```

Nginx is the public TLS termination point.

Internal Docker services should normally communicate through the private Docker network.

---

# 3. HTTPS Requirement

Production application traffic must use HTTPS.

Expected behavior:

```text
http://example.com
        ↓
HTTPS Redirect
        ↓
https://example.com
```

The exact production domain is environment-specific.

---

# 4. Certificate

The production domain must have a valid TLS certificate.

The certificate lifecycle includes:

```text
Issue
 ↓
Install
 ↓
Validate
 ↓
Renew
 ↓
Monitor
```

Certificate expiration must be monitored to prevent production outages.

---

# 5. Certificate Management

The selected certificate-management mechanism must support reliable renewal.

The deployment documentation should record:

```text
Certificate Authority
Certificate Location
Renewal Method
Renewal Schedule
Validation Procedure
Recovery Procedure
```

Production private keys must never be committed to Git.

---

# 6. Nginx Integration

Nginx terminates TLS and forwards valid application requests to the appropriate internal service.

Logical flow:

```text
Internet
 ↓
443 HTTPS
 ↓
Nginx
 ├── Frontend
 └── Backend API
```

---

# 7. HTTP Redirect

HTTP should redirect to HTTPS where appropriate.

The redirect must preserve:

```text
Host
Path
Query Parameters
```

The application should not create redirect loops.

---

# 8. TLS Configuration

The production configuration should use modern TLS settings.

Avoid obsolete protocols and insecure cipher configurations.

TLS configuration should be reviewed whenever the Nginx or operating-system stack is upgraded.

---

# 9. Security Headers

Where appropriate, production responses should include security headers such as:

```text
Strict-Transport-Security
X-Content-Type-Options
Referrer-Policy
Content-Security-Policy
```

Headers must be tested against the actual application before enforcing restrictive policies.

---

# 10. HSTS

HTTP Strict Transport Security may be enabled after HTTPS is verified and stable.

If enabled, the configuration must be deliberate because browsers may enforce HTTPS for future requests.

Do not enable aggressive HSTS settings before the production domain and HTTPS configuration are confirmed.

---

# 11. WebSocket Security

Socket.IO connections must use the secure production transport:

```text
HTTPS
 ↓
Secure WebSocket
 ↓
Nginx
 ↓
Socket.IO
```

Nginx must preserve the required WebSocket upgrade headers.

---

# 12. Cookies and Authentication

Authentication cookies, if used, must use appropriate security attributes.

Production authentication cookies should consider:

```text
Secure
HttpOnly
SameSite
```

JWT handling must follow the security architecture documented by the backend.

---

# 13. External Services

HTTPS must be used when communicating with external services such as:

```text
Supabase
Stripe
Brevo
Cloudinary
FastAPI
```

Internal FastAPI communication may use the private Docker network when appropriate.

---

# 14. Certificate Renewal Verification

Renewal should be tested before the certificate reaches expiration.

Verify:

```text
Renewal Command / Mechanism
 ↓
Certificate Updated
 ↓
Nginx Reload
 ↓
HTTPS Verification
```

A failed renewal must produce an actionable alert or operational response.

---

# 15. Monitoring

Production should monitor:

```text
Certificate Expiration
HTTPS Availability
Nginx Errors
TLS Handshake Failures
```

The goal is to detect certificate problems before users experience an outage.

---

# 16. Failure Recovery

If a certificate problem occurs:

```text
Identify Failure
 ↓
Validate Certificate
 ↓
Validate Nginx Configuration
 ↓
Renew / Restore Certificate
 ↓
Reload Nginx
 ↓
Verify HTTPS
```

Do not disable HTTPS as a permanent workaround.

---

# 17. Development and Testing

Local development may use HTTP where appropriate.

Production-like HTTPS testing should be performed before the final release.

Never use production private keys in development environments.

---

# 18. Security Requirements

- [ ] HTTPS is enabled.
- [ ] Valid certificate is installed.
- [ ] HTTP redirects correctly.
- [ ] TLS configuration is reviewed.
- [ ] Private keys are protected.
- [ ] Certificate renewal is configured.
- [ ] Renewal has been tested.
- [ ] WebSocket connections work securely.
- [ ] Security headers are reviewed.
- [ ] Certificate monitoring is available.

---

# 19. Definition of Done

SSL configuration is complete when:

- Production domain serves valid HTTPS.
- HTTP redirects correctly.
- Nginx terminates TLS successfully.
- Socket.IO works over secure connections.
- Certificate renewal is configured.
- Renewal/recovery procedure is documented.
- Private keys are not committed.
- Production verification passes.

---

# 20. SSL Principle

> **HTTPS is a production security requirement. Certificates, TLS configuration, renewal, and recovery must be treated as operational infrastructure rather than a one-time setup.**
