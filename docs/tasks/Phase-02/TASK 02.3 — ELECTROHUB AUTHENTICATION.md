TASK 02.3 — ELECTROHUB AUTHENTICATION

ROLE

You are implementing TASK 02.3 of the ElectroHub project.

Act as a senior full-stack engineer working inside the existing ElectroHub monorepo.

You MUST preserve the architecture established by Phase 00, TASK 02.1 Backend Foundation, TASK 02.2 Database Foundation, and the existing Frontend Foundation.

Do NOT redesign the architecture unless the existing implementation makes the requirement impossible.

==================================================
AUTHORITATIVE SOURCES
==================================================

Use these sources in this order:

1. ElectroHub ROADMAP.md
2. Existing ElectroHub architecture and coding standards
3. Existing backend foundation
4. Existing database foundation / Prisma schema
5. Existing frontend foundation
6. The provided NIC Admin Authentication and Recovery document
7. The provided authentication screenshots / Figma Make screens

The NIC authentication document is a REFERENCE ONLY.

Reuse appropriate security concepts and recovery ideas.

DO NOT copy NIC-specific business logic into ElectroHub.

In particular:

- Do NOT implement cryptocurrency wallet authentication.
- Do NOT implement wallet signatures.
- Do NOT request/store private keys or seed phrases.
- Do NOT implement FIDO2 unless explicitly required by a later ElectroHub task.
- Do NOT implement NIC-specific Cloudflare/Turnstile infrastructure unless already part of ElectroHub architecture.
- Do NOT copy nicgroup.co-specific behavior.
- Do NOT copy NIC-specific roles or database structures.

Adapt the useful security principles to ElectroHub.

==================================================
TASK SCOPE
==================================================

Implement ElectroHub authentication for:

1. Customer
2. Administrator

Core requirements:

- Registration
- Login
- Logout
- JWT access authentication
- Refresh tokens
- Password hashing
- Protected routes
- Role-based access control
- Customer role
- Administrator role
- Current authenticated user
- Authentication state handling
- Password recovery foundation
- Secure authentication database persistence

==================================================
IMPORTANT PHASE BOUNDARY
==================================================

TASK 02.4 will handle Brevo email OTP.

Therefore:

02.3 MUST provide the authentication architecture required for OTP integration.

02.3 MUST NOT create a fake email provider.

Do not hard-code Brevo implementation into unrelated authentication services.

Create clean service boundaries so 02.4 can integrate Brevo without rewriting authentication.

==================================================
1. DATABASE
==================================================

Extend the existing Prisma schema.

DO NOT modify or recreate the existing Phase 02.2 models unnecessarily.

Use Prisma as the only database schema source of truth.

Add only the authentication entities required by ElectroHub.

At minimum evaluate:

User authentication state

RefreshToken/session persistence

Password recovery/reset state

Authentication-related verification state where required by the architecture

Use appropriate:

- primary keys
- foreign keys
- unique constraints
- indexes
- timestamps
- expiration fields
- revocation fields
- status fields

Refresh tokens MUST NOT be stored as plaintext.

Store a secure hash/token fingerprint that allows server-side revocation and lookup.

Password reset tokens MUST NOT be stored in plaintext.

Passwords MUST NEVER be stored plaintext.

Do not store OTP plaintext in the database if the later OTP design requires persistence.

Avoid introducing future-phase models such as:

- products
- orders
- payments
- delivery
- recommendations
- AI behavior

unless already present from Phase 02.2.

==================================================
2. ROLES
==================================================

Use the existing Role/User architecture from TASK 02.2.

Required application roles:

CUSTOMER
ADMINISTRATOR

Do not create duplicate role systems.

Authorization MUST be performed server-side.

Frontend route protection is UX only and MUST NOT be considered security.

A CUSTOMER must never be able to access administrator APIs.

An ADMINISTRATOR may access administrator-protected APIs according to the authorization rules.

==================================================
3. PASSWORD SECURITY
==================================================

Use a modern adaptive password hashing algorithm already approved by the project architecture.

Never:

- store plaintext passwords
- log passwords
- return password hashes to clients
- put passwords in JWT payloads
- expose password reset tokens in logs

Registration and password reset MUST hash the new password before persistence.

Login MUST verify the supplied password against the stored hash.

==================================================
4. REGISTRATION
==================================================

Implement customer registration.

Required behavior:

1. Validate input.
2. Normalize appropriate fields such as email.
3. Check account uniqueness.
4. Hash password.
5. Create the user.
6. Assign CUSTOMER role.
7. Return a safe response.
8. Do not return password/hash/internal security fields.

Do not allow public registration to create ADMINISTRATOR accounts.

Administrator accounts must be created through controlled administrative/seed mechanisms.

Registration responses must not expose unnecessary account internals.

Prepare registration flow for TASK 02.4 email OTP verification.

Do not falsely mark an email as verified before the OTP workflow exists.

==================================================
5. LOGIN
==================================================

Implement email/password login.

Flow:

Client
 ↓
POST /auth/login
 ↓
Validate credentials
 ↓
Verify password
 ↓
Determine account status
 ↓
Issue access token
 ↓
Issue refresh token
 ↓
Return authenticated state

Use generic authentication failure responses.

Do not reveal whether an email exists.

Avoid responses such as:

- "email does not exist"
- "wrong password"

Use a generic authentication failure.

Implement reasonable login rate limiting using the middleware architecture from TASK 02.1.

Do not permanently lock accounts based only on unauthenticated failures.

Follow the security principles from the provided NIC document:

- enumeration resistance
- rate limiting
- generic failure responses
- safe logging
- no secrets in logs

==================================================
6. JWT ACCESS TOKEN
==================================================

Implement short-lived JWT access tokens.

JWT payload MUST contain only the minimum required claims.

Do NOT put:

- password
- password hash
- refresh token
- OTP
- reset token
- sensitive personal information

inside the JWT.

Use a server-side secret/key from environment configuration.

Never hard-code JWT secrets.

Validate:

- signature
- expiration
- issuer/audience where configured
- required claims

Keep token generation and verification in a dedicated authentication/security service.

==================================================
7. REFRESH TOKENS
==================================================

Implement refresh-token rotation.

Required behavior:

- refresh token is generated securely
- server stores only a safe representation/hash
- token has expiration
- token can be revoked
- refresh endpoint validates token
- successful refresh rotates the token
- old refresh token becomes invalid
- revoked/expired tokens cannot create new sessions

Protect against refresh-token replay.

Where practical, maintain token/session metadata such as:

- user
- issued time
- expiration
- revoked time
- replacement/replaced-by relationship
- created timestamp

Do not expose internal token persistence details to the frontend.

==================================================
8. LOGOUT
==================================================

Implement logout.

Logout MUST invalidate the relevant refresh-token/session state.

Access tokens are short-lived and should naturally expire.

If the architecture supports logout-all-sessions, implement it only if it fits the existing model cleanly.

Do not claim logout invalidates already-issued JWT access tokens immediately unless the architecture actually supports server-side access-token revocation.

==================================================
9. AUTHENTICATION MIDDLEWARE
==================================================

Create middleware for protected routes.

Responsibilities:

- extract access token
- validate token
- resolve authenticated user
- attach safe authenticated-user context
- reject missing/invalid/expired authentication

Do not put authorization logic inside controllers repeatedly.

Use centralized middleware.

==================================================
10. ROLE-BASED ACCESS CONTROL
==================================================

Create reusable authorization middleware.

Example concept:

requireAuth()
requireRole('ADMINISTRATOR')

Do not duplicate role checks across every controller.

Required behavior:

CUSTOMER → customer-protected APIs

ADMINISTRATOR → administrator-protected APIs

CUSTOMER → administrator API → 403

Unauthenticated request → 401

Authenticated user with insufficient permissions → 403

Do not rely on frontend navigation to enforce authorization.

==================================================
11. CURRENT USER
==================================================

Implement a current-user endpoint.

Example:

GET /api/auth/me

It MUST return only safe authenticated-user information.

Do not return:

- password hash
- refresh token
- reset token
- OTP
- internal security secrets

This endpoint will be used by the frontend to restore authentication state.

==================================================
12. PASSWORD RECOVERY FOUNDATION
==================================================

Reuse the useful recovery concepts from the NIC reference document.

The reference document describes:

- generic forgot-password response
- single-use email token
- short expiry
- restricted recovery state
- no dashboard access during recovery
- fresh verification
- password replacement
- session/token revocation after password change

Adapt these principles for ElectroHub.

Implement the backend foundation for:

POST /api/auth/forgot-password

POST /api/auth/reset-password

The forgot-password endpoint MUST return a generic response regardless of whether the email exists.

Example concept:

"If the account exists, a password reset message has been sent."

Do not reveal account existence.

Reset tokens must:

- be cryptographically random
- be single-use
- expire
- be stored only as a secure hash/representation
- be invalidated after successful reset

Password reset MUST:

1. validate reset token
2. validate token state/expiry
3. validate new password
4. hash new password
5. update password
6. invalidate reset token
7. revoke existing refresh sessions/tokens
8. return safe success response

Do not automatically create an administrator session from a password reset.

==================================================
13. RECOVERY SECURITY
==================================================

The provided NIC reference shows a useful security principle:

A recovery process must not silently bypass stronger authentication controls.

For ElectroHub:

- email reset token proves mailbox access
- later OTP functionality from TASK 02.4 provides an additional verification layer where required
- recovery sessions must be purpose-scoped
- recovery tokens must not grant normal application access
- reset tokens must not be usable as access tokens
- reset tokens must be single-use
- successful password reset should revoke active refresh sessions

Do NOT implement wallet/FIDO2 recovery in this task.

Those mechanisms are outside the ElectroHub 02.3/02.4 scope.

==================================================
14. AUTHENTICATION API
==================================================

Use the existing backend API conventions.

Expected API surface should be approximately:

POST /api/auth/register

POST /api/auth/login

POST /api/auth/refresh

POST /api/auth/logout

GET /api/auth/me

POST /api/auth/forgot-password

POST /api/auth/reset-password

Adapt exact paths to the existing API conventions if different.

Do not create duplicate routes.

Controllers MUST remain thin.

Expected structure:

route
 ↓
middleware
 ↓
controller
 ↓
service
 ↓
repository/Prisma boundary

Do not place database queries directly throughout controllers.

==================================================
15. FRONTEND
==================================================

Frontend authentication MUST be implemented ONLY according to the approved ElectroHub design direction.

There are separate Make/Figma screen areas for:

- customer
- administrator

Inspect the existing Make design and use the relevant screenshots/screens for each area.

Do NOT invent a new visual design.

Do NOT copy the NIC website visual design.

The NIC document is used for SECURITY FLOW IDEAS, not UI styling.

==================================================
CUSTOMER AUTH UI
==================================================

Implement the customer authentication screens represented by the existing design.

At minimum:

- Customer Login
- Customer Registration
- Forgot Password
- Reset Password
- Authentication loading state
- Authentication error state
- Successful authentication navigation

Use the existing:

- React
- TypeScript
- React Router
- SCSS
- CSS Modules
- existing shared UI components
- existing design tokens

Do not introduce another styling framework.

==================================================
ADMIN AUTH UI
==================================================

Implement the administrator authentication screens represented by the existing design.

At minimum:

- Administrator Login
- Administrator authentication states
- Forgot Password if included by the approved admin design
- Reset Password if included by the approved admin design
- Admin protected-route behavior

Do not expose customer navigation inside the admin experience.

Do not expose administrator functionality to customer routes.

==================================================
16. FRONTEND AUTH STATE
==================================================

Use the project's approved API/data architecture.

Authentication state must support:

- login
- logout
- refresh
- current user
- protected navigation
- session restoration
- expired access token handling

Do not duplicate authentication state across multiple unrelated stores.

Use the existing React Query/API architecture where appropriate.

Avoid storing sensitive authentication data unnecessarily in localStorage.

If the architecture uses HttpOnly cookies for refresh tokens, frontend JavaScript MUST NOT attempt to read the refresh token.

==================================================
17. SECURITY COOKIE RULES
==================================================

If refresh tokens are implemented using cookies:

Use secure cookie configuration appropriate for the environment.

Production:

- HttpOnly
- Secure
- appropriate SameSite
- appropriate domain/path restrictions

Do not expose refresh tokens to JavaScript.

If cross-origin frontend/backend communication requires specific cookie configuration, document it explicitly.

Do not use wildcard CORS with credentials.

==================================================
18. ERROR HANDLING
==================================================

Use the centralized backend error handling from TASK 02.1.

Authentication errors must not leak sensitive information.

Examples:

401:

Unauthenticated / invalid authentication

403:

Authenticated but unauthorized

400/422:

Invalid request data

Do not return stack traces in production.

Do not log:

- passwords
- JWTs
- refresh tokens
- reset tokens
- OTP values
- password hashes

Use the existing project logger.

==================================================
19. RATE LIMITING / ABUSE PROTECTION
==================================================

At minimum protect:

- login
- registration
- refresh
- forgot-password
- reset-password

Use the existing middleware architecture.

Do not create a second unrelated rate-limiting system.

Use generic responses where appropriate.

The NIC reference document specifically emphasizes enumeration resistance, layered rate limiting, safe logging, and detection of repeated failures.

Adapt those principles to ElectroHub.

Advanced Redis/Cloudflare abuse infrastructure is NOT required unless already implemented.

==================================================
20. DATABASE MIGRATION
==================================================

Create a Prisma migration for the authentication changes.

Requirements:

- migration is committed
- migration is deterministic
- Prisma schema validates
- migration applies successfully to DEV
- no destructive production reset
- no prisma db push
- no manual Supabase schema creation

Run the migration against the ElectroHub DEV Supabase project first.

==================================================
21. DEV DATABASE
==================================================

Update seed data for authentication.

DEV seed MUST include controlled test data.

Minimum:

CUSTOMER role
ADMINISTRATOR role

At least one test customer.

At least one test administrator.

Passwords MUST be deterministic test-only passwords and MUST be hashed.

Clearly document that these credentials are DEV/test credentials only.

Do NOT seed development users into production.

Run the seed against DEV.

Verify:

- roles exist
- users exist
- correct roles are assigned
- duplicate users are not created on repeated seed execution
- passwords are not stored plaintext
- no orphan records

Run the seed more than once and verify idempotency.

==================================================
22. PRODUCTION DATABASE
==================================================

After DEV verification succeeds:

Apply the authentication Prisma migration to the ElectroHub PRODUCTION database.

Production migration MUST:

- use Prisma migration tooling
- contain schema changes only
- not seed development users
- not mutate application business data
- not reset the database

Verify production schema after migration.

Use read-only verification queries where possible.

Do NOT put production database credentials into ordinary PR CI.

Production migration should be a controlled deployment operation.

==================================================
23. TESTING
==================================================

Tests are mandatory.

Backend tests MUST cover at minimum:

Registration:

- valid registration
- duplicate email
- invalid input
- customer role assignment
- administrator cannot be publicly registered

Login:

- valid credentials
- invalid password
- unknown email
- generic error behavior
- disabled/inactive account if supported

JWT:

- valid token
- expired token
- invalid token
- malformed token

Refresh:

- valid refresh
- expired refresh
- revoked refresh
- rotated refresh token
- replay of old refresh token

Authorization:

- unauthenticated → 401
- customer accessing customer endpoint → allowed
- customer accessing admin endpoint → 403
- administrator accessing admin endpoint → allowed

Logout:

- refresh session invalidated

Password recovery:

- generic forgot-password response
- valid reset token
- expired reset token
- reused reset token
- password successfully changed
- existing refresh sessions revoked

Security:

- sensitive values do not appear in logs
- password hashes are never returned
- reset tokens are never returned by API responses
- JWT does not contain secrets

==================================================
24. FRONTEND TESTING
==================================================

Test the authentication UI behavior.

At minimum verify:

- login form validation
- registration form validation
- login loading state
- login error state
- successful login navigation
- protected route behavior
- customer/admin route separation
- logout behavior
- session restoration
- forgot-password flow
- reset-password flow

Use existing frontend test infrastructure.

Do not add a second test framework.

==================================================
25. API COMPATIBILITY
==================================================

Before implementation:

Inspect existing backend routes and API conventions.

Do not break:

- /api/health
- existing middleware
- existing error handling
- existing database connection
- existing frontend API configuration
- existing CI

Authentication must be additive unless a change is required by the approved architecture.

==================================================
26. DOCUMENTATION
==================================================

Update documentation for:

- authentication architecture
- API endpoints
- token strategy
- refresh-token strategy
- roles
- protected routes
- password recovery
- security considerations
- DEV authentication credentials policy
- environment variables

Clearly document the boundary:

02.3 = Authentication foundation

02.4 = Brevo OTP/email integration

==================================================
27. CI/CD
==================================================

Do NOT assume local tests are sufficient.

Run the relevant GitHub Actions CI.

Verify:

- frontend typecheck
- frontend build
- frontend tests
- frontend lint
- backend typecheck
- backend build
- backend tests
- backend lint
- AI service tests
- security audit

If CI fails:

DO NOT declare the task complete.

Investigate the actual failing job and fix the root cause.

Do not hide failures with:

- continue-on-error
- lowered security thresholds
- skipped tests
- disabled jobs
- fake success output

==================================================
28. SECURITY REVIEW
==================================================

Before declaring completion, explicitly verify:

[ ] No plaintext passwords

[ ] No secrets in source control

[ ] No JWT secret hardcoded

[ ] Refresh tokens protected

[ ] Reset tokens hashed/protected

[ ] Generic login errors

[ ] Generic forgot-password response

[ ] Protected routes enforced server-side

[ ] RBAC enforced server-side

[ ] Customer cannot access admin APIs

[ ] Admin role cannot be created through public registration

[ ] Authentication secrets absent from logs

[ ] Access token contains minimal claims

[ ] Refresh token rotation implemented

[ ] Revoked refresh tokens rejected

[ ] Password reset revokes sessions

[ ] Reset tokens expire and become single-use

[ ] Production does not receive DEV seed data

==================================================
29. ACCEPTANCE CRITERIA
==================================================

TASK 02.3 is complete ONLY when all of the following are proven:

1. Customer registration works.

2. Administrator test account exists through controlled DEV seed.

3. Login works for valid credentials.

4. Invalid credentials produce safe generic errors.

5. Access JWT authentication works.

6. Refresh tokens work and rotate securely.

7. Logout invalidates the refresh session.

8. Protected APIs reject unauthenticated requests.

9. Customer APIs are accessible to customers.

10. Administrator APIs reject customers.

11. Administrator APIs accept administrators.

12. /api/auth/me returns safe authenticated-user information.

13. Password recovery foundation works.

14. Reset tokens are single-use and expire.

15. Password reset invalidates existing refresh sessions.

16. No authentication secrets appear in logs.

17. DEV migration succeeds.

18. DEV seed succeeds.

19. DEV seed is idempotent.

20. Production migration succeeds without production seed data.

21. Frontend customer authentication matches the approved Make design.

22. Frontend administrator authentication matches the approved Make design.

23. Frontend protected routes work.

24. Backend tests pass.

25. Frontend tests pass.

26. Typecheck passes.

27. Lint passes.

28. Build passes.

29. GitHub Actions CI passes.

30. Documentation is updated.

==================================================
30. REQUIRED FINAL REPORT
==================================================

Create:

docs/reviews/TASK_02.3_AUTHENTICATION_IMPLEMENTATION_REPORT.md

The report MUST contain:

# TASK 02.3 Authentication Implementation Report

## Implementation
- backend authentication architecture
- frontend authentication implementation
- database changes
- API endpoints
- JWT strategy
- refresh-token strategy
- RBAC

## Password Recovery
- forgot password
- reset password
- token security
- session revocation

## Database
- migration name
- DEV verification
- seed data
- seed idempotency
- production migration verification

## Security
- password hashing
- token handling
- logging
- rate limiting
- enumeration protection
- RBAC

## Frontend
- customer authentication
- administrator authentication
- protected routes
- session restoration

## Tests
List every test command and exact result.

Example:

Backend Tests: PASS — X/X
Frontend Tests: PASS — X/X
Typecheck: PASS
Lint: PASS
Build: PASS
GitHub CI: PASS — run ID XXXXX

Do NOT write "verified" without evidence.

## Known Limitations

Explicitly list anything not implemented.

Especially distinguish:

TASK 02.3 authentication

from

TASK 02.4 Brevo OTP

==================================================
FINAL RULE
==================================================

DO NOT declare TASK 02.3 complete merely because the code exists.

The task is complete only when:

IMPLEMENTED
+
TESTED
+
DATABASE VERIFIED
+
SECURITY REVIEWED
+
FRONTEND VERIFIED
+
CI VERIFIED
+
DOCUMENTED

Evidence is required for every completion claim.