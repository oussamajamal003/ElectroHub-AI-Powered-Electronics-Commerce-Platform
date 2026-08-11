# Authentication

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
