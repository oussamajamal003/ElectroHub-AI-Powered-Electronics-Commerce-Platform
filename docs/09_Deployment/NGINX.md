# Nginx

## 1. Purpose

This document defines the Nginx role in the ElectroHub production architecture.

Nginx acts as the public-facing web server and reverse proxy in front of the Dockerized application.

---

# 2. Responsibilities

Nginx is responsible for:

```text
HTTP Handling
HTTPS
SSL Termination
Reverse Proxy
Routing
Static Frontend Serving where configured
Security Headers
Request Limits
```

Nginx must not contain application business logic.

---

# 3. Production Traffic Flow

```text
Internet
   │
   ▼
Nginx
   │
   ├── Frontend
   │
   └── Backend API
          │
          ├── FastAPI AI Service
          ├── Prisma
          └── Socket.IO
```

Internal services should remain private.

---

# 4. HTTP and HTTPS

Production should support HTTPS.

Expected behavior:

```text
HTTP
 ↓
HTTPS Redirect
 ↓
Nginx
 ↓
Application
```

The application should not rely on unencrypted production traffic.

---

# 5. SSL

SSL certificates should be configured for the production domain.

The certificate lifecycle must include:

```text
Issue
 ↓
Install
 ↓
Verify
 ↓
Renew
```

Certificate renewal must be tested or monitored to avoid unexpected expiration.

---

# 6. Reverse Proxy

Nginx forwards requests to the appropriate application service.

Example logical routing:

```text
/
    ↓
Frontend

/api/
    ↓
Backend

/socket.io/
    ↓
Backend Socket.IO
```

The exact public route structure must follow the API architecture documentation.

---

# 7. Backend Proxy

Backend requests should pass through Nginx rather than exposing the Node.js port directly.

```text
Client
 ↓
HTTPS
 ↓
Nginx
 ↓
Backend Container
```

Nginx must preserve the headers required by the backend.

---

# 8. Socket.IO Proxy

Socket.IO requires appropriate WebSocket upgrade handling.

Logical flow:

```text
Client
 ↓
Nginx
 ↓
WebSocket Upgrade
 ↓
Socket.IO
 ↓
Backend
```

The proxy configuration must support connection upgrades and appropriate timeouts.

---

# 9. Frontend Routing

For a React SPA, Nginx must support client-side routing.

Requests for application routes should resolve to the frontend entry point when appropriate.

Example:

```text
/products
/products/123
/cart
/checkout
/orders
```

The exact implementation depends on the final frontend deployment configuration.

---

# 10. API Routing

Nginx must route API traffic to the backend without exposing unnecessary internal ports.

Example:

```text
/api/*
    ↓
Backend
```

API versioning and public route structure must remain consistent with the backend API documentation.

---

# 11. Security Headers

Where appropriate, Nginx should provide security-related headers such as:

```text
Strict-Transport-Security
X-Content-Type-Options
Referrer-Policy
Content-Security-Policy
```

Headers must be reviewed against the actual application requirements before enabling restrictive policies.

---

# 12. Request Limits

Nginx should apply appropriate request limits where useful.

This is particularly relevant to:

```text
Image Uploads
Large Requests
Abusive Traffic
```

Application-level validation remains mandatory.

Nginx limits are not a replacement for backend security validation.

---

# 13. Timeouts

Timeouts should be configured according to endpoint behavior.

Long-running AI requests and file operations should have explicitly considered timeout values.

Avoid globally increasing timeouts without evidence.

---

# 14. Compression and Caching

Nginx may provide:

```text
Compression
Static Asset Caching
Cache-Control Headers
```

Static assets should use appropriate cache policies.

User-specific or sensitive responses must not be accidentally cached publicly.

---

# 15. Logging

Nginx access and error logs should support troubleshooting.

Do not expose or intentionally log:

```text
Passwords
JWT Secrets
OTP Values
Payment Secrets
API Keys
Sensitive Customer Data
```

Log retention should be appropriate for the server capacity.

---

# 16. Internal Services

The following services should normally remain internal:

```text
Backend Container Port
AI Service Port
Socket.IO Internal Port
```

Nginx should be the public entry point where possible.

---

# 17. Health Checks

Nginx should proxy traffic only to healthy application services according to the deployment configuration.

Health endpoints should not expose sensitive system information.

---

# 18. Deployment

Nginx configuration is part of the production deployment process.

Expected flow:

```text
Build
 ↓
Deploy Containers
 ↓
Configure / Validate Nginx
 ↓
SSL Verification
 ↓
Health Checks
 ↓
Production Verification
```

Configuration syntax should be validated before reloading Nginx.

---

# 19. Failure Handling

If a backend or AI service becomes unavailable:

```text
Nginx
 ↓
Controlled Error
 ↓
Client
```

The system should return appropriate HTTP errors rather than exposing internal server details.

---

# 20. Security Principles

Nginx configuration must:

- Minimize exposed ports.
- Enforce HTTPS in production.
- Avoid exposing internal services.
- Apply appropriate security headers.
- Apply reasonable request limits.
- Avoid leaking infrastructure details.
- Keep configuration under version control where appropriate.
- Never contain production secrets.

---

# 21. Definition of Done

Nginx configuration is complete when:

- HTTP/HTTPS behavior works.
- SSL is valid.
- Frontend routing works.
- Backend API routing works.
- Socket.IO connections work.
- Internal service ports remain protected.
- Security headers are reviewed.
- Request limits are configured where required.
- Logs are available.
- Configuration validation passes.
- Production health checks pass.

---

# 22. Nginx Principle

> **Nginx provides the controlled public entry point to ElectroHub, separating internet traffic from internal Docker services while handling HTTPS and reverse-proxy responsibilities.**
