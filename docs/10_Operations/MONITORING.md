# Monitoring

## 1. Purpose

This document defines the production monitoring strategy for ElectroHub.

Monitoring provides evidence about application health, infrastructure health, failures, and resource usage.

---

# 2. Monitoring Scope

Monitor:

```text
DigitalOcean VPS
Docker
Nginx
Frontend
Backend
AI Service
Database Connectivity
External Integrations
SSL
```

---

# 3. Infrastructure Metrics

Monitor:

```text
CPU
Memory
Disk Usage
Disk Space
Network
Container Resource Usage
```

The AI service receives particular attention because AI workloads may consume significant resources.

---

# 4. Application Health

The backend should expose a health endpoint such as:

```text
/health
```

Health checks should verify service availability without exposing secrets.

---

# 5. Service Health

Monitor:

```text
Frontend Availability
Backend Availability
AI Service Availability
Nginx Availability
Database Connectivity
Socket.IO Connectivity
```

---

# 6. HTTP Monitoring

Track important HTTP behavior:

```text
2xx
4xx
5xx
Response Time
Request Volume
```

Unexpected increases in 5xx responses should trigger investigation.

---

# 7. Database Monitoring

Monitor:

```text
Connectivity
Query Performance
Connection Problems
Storage
Migration Failures
```

Supabase provides the managed PostgreSQL infrastructure.

Application monitoring should still detect database connectivity failures.

---

# 8. AI Monitoring

Monitor:

```text
Request Count
Response Time
Errors
Timeouts
Resource Usage
Unavailable Service
```

AI failures should not silently break unrelated commerce functionality.

---

# 9. Payment Monitoring

Monitor application-level payment events such as:

```text
Payment Success
Payment Failure
Webhook Failure
Order/Payment Mismatch
```

Stripe Test Mode is used for the project.

Sensitive payment credentials must never appear in monitoring output.

---

# 10. Email Monitoring

Monitor Brevo-related application events:

```text
OTP Delivery Attempt
Order Email Attempt
Payment Email Attempt
Email Failure
```

Do not log OTP values or API keys.

---

# 11. PDF Monitoring

Monitor PDF generation failures:

```text
Invoice Generation Failure
Receipt Generation Failure
Download Failure
Authorization Failure
```

PDF monitoring must not expose customer-sensitive document content unnecessarily.

---

# 12. Socket.IO Monitoring

Monitor:

```text
Connection Failures
Disconnects
Server Errors
Unauthorized Access Attempts
Delivery Update Failures
```

Do not expose customer data through operational metrics.

---

# 13. Nginx Monitoring

Monitor:

```text
Access Logs
Error Logs
5xx Responses
TLS Errors
Upstream Failures
```

Nginx logs must not contain secrets.

---

# 14. SSL Monitoring

Monitor:

```text
Certificate Expiration
HTTPS Availability
TLS Errors
```

Certificate problems should be detected before expiration.

---

# 15. Docker Monitoring

Monitor:

```text
Container Status
Restart Count
CPU
Memory
Container Logs
Health Checks
```

Unexpected repeated restarts require investigation.

---

# 16. Logging

Logs should support:

```text
Debugging
Incident Investigation
Error Analysis
Deployment Verification
```

Never log:

```text
Passwords
OTP Values
JWT Secrets
Refresh Tokens
API Keys
Payment Secrets
Private Customer Data
```

---

# 17. Alerting

Alerts should prioritize actionable conditions.

Examples:

```text
Backend Down
AI Service Down
High 5xx Rate
Critical Container Failure
Disk Nearly Full
Memory Exhaustion
SSL Expiration Risk
Database Connectivity Failure
```

Avoid excessive alerts that do not require action.

---

# 18. Health Check Flow

```text
Monitor
 ↓
Detect Failure
 ↓
Alert
 ↓
Investigate
 ↓
Contain
 ↓
Recover
 ↓
Verify
 ↓
Document
```

---

# 19. Production Monitoring

Monitoring must be active after production deployment.

The deployment is not considered operationally complete if there is no way to determine whether the application is healthy.

---

# 20. Performance Monitoring

Monitor important performance indicators:

```text
API Response Time
Database Query Time
AI Processing Time
PDF Generation Time
Frontend Load Performance
```

Performance changes should be compared against known baselines where available.

---

# 21. Incident Evidence

When an incident occurs, preserve relevant:

```text
Timestamp
Release Version
Logs
Health Status
Error Messages
Resource Metrics
Deployment Information
```

Avoid collecting unnecessary sensitive customer information.

---

# 22. Monitoring Security

Monitoring infrastructure must follow the same security requirements as the application.

Access should be limited to authorized personnel.

Sensitive credentials must never appear in monitoring dashboards or alerts.

---

# 23. Definition of Done

Monitoring is complete when:

- Infrastructure health can be observed.
- Application health can be verified.
- Container health is visible.
- Database connectivity is monitored.
- AI service health is monitored.
- Nginx and HTTPS are monitored.
- Critical failures produce actionable alerts.
- Logs avoid sensitive data.
- Incident evidence can be collected.

---

# 24. Monitoring Principle

> **Monitoring must provide actionable evidence about system health without becoming a source of sensitive-data exposure.**
