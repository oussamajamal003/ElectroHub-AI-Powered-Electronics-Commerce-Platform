# ElectroHub — TASK 02.1 Backend Foundation

**Task ID:** 02.1  
**Task Name:** Backend Foundation  
**Phase:** 02 — Core Platform  
**Branch:** `feature/backend-foundation`  
**Target:** `develop`  
**Status:** Implementation Task  
**Primary Authority:** Approved ElectroHub architecture and Phase 00 foundation  
**Scope:** Node.js + Express.js backend foundation only  
**Do not merge until:** all completion gates and architect review requirements pass

---

# 1. Objective

Implement the foundational backend architecture required by all future ElectroHub commerce features.

TASK 02.1 establishes:

- Node.js backend runtime
- Express.js application
- layered backend architecture
- API routing
- controllers
- services
- middleware
- centralized error handling
- integration with the Phase 00 logging foundation
- centralized configuration
- environment validation
- health/readiness foundation where required
- backend testing foundation
- backend documentation

This is foundation work, not commerce-domain implementation.

The result must be stable, testable, observable, secure, and ready for later Phase 02+ features.

---

# 2. Phase 00 Dependency — Logging

**Logging was established in Phase 00.**

Therefore TASK 02.1 MUST reuse the Phase 00 logging foundation.

Before implementation:

1. Read the Phase 00 documentation.
2. Locate the actual logger implementation.
3. Inspect its API, levels, formatting, transports, configuration, and conventions.
4. Reuse it from the backend.
5. Extend it only if a genuine backend requirement is missing.
6. Document any extension.

Do NOT create a second logger.

Forbidden architecture:

```text
Phase 00 Logger
+
New Backend Logger
+
Separate Request Logger
```

Required conceptual architecture:

```text
Phase 00 Logging Foundation
          ↓
Backend middleware/application
          ↓
Routes → Controllers → Services
          ↓
Structured logs
```

---

# 3. Required Reading

Before changing code, inspect the actual repository.

Read:

```text
/AGENTS.md
```

Read the fixed ElectroHub developer prompt.

Read Phase 00 documentation, especially anything covering:

- architecture
- logging
- observability
- configuration
- environment
- project structure
- coding standards
- testing
- CI/CD

Inspect the actual repository structure rather than assuming paths.

Search for:

```text
logging
logger
observability
configuration
environment
env
backend
server
Express
Node
API
```

Inspect:

```text
package.json
```

and workspace configuration if applicable.

Also inspect:

- existing backend source
- scripts
- tests
- TypeScript configuration
- ESLint configuration
- build configuration
- Docker configuration
- GitHub Actions

---

# 4. Scope

TASK 02.1 includes:

## Runtime

- Node.js
- Express.js
- TypeScript if established by the repository

## Application

- Express application initialization
- server bootstrap
- configuration
- middleware pipeline
- routing
- controllers
- services
- centralized error handling
- Phase 00 logging integration

## API Foundation

- API routing foundation
- health endpoint
- readiness endpoint if required by the architecture
- consistent success/error behavior

## Quality

- unit tests
- integration/smoke tests where appropriate
- typecheck
- lint
- build
- CI
- documentation

---

# 5. Out of Scope

Do NOT implement commerce-domain functionality in this task.

Do not implement:

- products
- categories
- inventory
- carts
- orders
- customers
- payments
- Stripe workflows
- authentication workflows
- authorization roles
- OTP
- refresh tokens
- recommendations
- AI business logic
- Cloudinary workflows
- email workflows
- Socket.IO business events
- domain database models
- unrelated migrations

Those belong to later tasks.

If a future feature needs a foundation extension, create only the smallest necessary architectural boundary and document it.

---

# 6. Architecture

The backend must follow a clear layered architecture.

Preferred flow:

```text
HTTP Request
     ↓
Express
     ↓
Middleware
     ↓
Route
     ↓
Controller
     ↓
Service
     ↓
Repository / Infrastructure
     ↓
Database / External Service
```

For TASK 02.1, only the foundation layers actually required should be created.

Do not create abstractions merely to fill folders.

---

# 7. Application vs Server

Separate application construction from network startup.

Preferred:

```text
app.ts
  ↓
creates/configures Express application

server.ts
  ↓
loads configuration
  ↓
starts HTTP server
```

This is required to make HTTP integration testing possible without binding a production port.

Do not place the entire application inside an untestable startup file.

---

# 8. Recommended Structure

Adapt to the actual repository.

A suitable structure is:

```text
apps/backend/
├── src/
│   ├── app.ts
│   ├── server.ts
│   ├── config/
│   ├── routes/
│   ├── controllers/
│   ├── services/
│   ├── middleware/
│   ├── errors/
│   ├── utils/
│   └── types/
├── tests/
│   ├── unit/
│   └── integration/
├── package.json
└── tsconfig.json
```

If equivalent structures already exist, reuse them.

Do not create duplicate architectures.

---

# 9. Express Foundation

Configure only the middleware actually required by the application.

Inspect whether the backend requires:

- JSON parsing
- URL-encoded parsing
- CORS
- request IDs
- request logging
- security headers
- request limits
- not-found handling
- centralized error handling
- API routes

Use existing dependencies where appropriate.

Every new dependency must have an explicit reason.

Do not add duplicate frameworks or libraries.

---

# 10. Middleware Ordering

Establish a deliberate middleware order.

A typical foundation is:

```text
1. Request ID
2. Request logging
3. Security middleware
4. CORS
5. Body parsing
6. API routes
7. 404 handler
8. Central error handler
```

The actual order must follow the semantics of the repository's chosen middleware.

Verify:

- request IDs exist before request logs
- routes receive parsed bodies
- 404s reach the not-found handler
- rejected/thrown errors reach the error handler
- sensitive data is not logged

Document the final order.

---

# 11. Routing

Establish centralized API routing.

Preferred conceptual model:

```text
/api
  ├── health
  └── future modules
```

Example:

```text
GET /api/health
```

If Phase 00 already establishes API versioning, follow it.

If no versioning strategy exists, document the chosen strategy before introducing one.

Do not add versioning for cosmetic reasons.

---

# 12. Health Endpoint

Implement a minimal health endpoint.

Example:

```text
GET /api/health
```

Requirements:

- deterministic
- fast
- machine-readable
- appropriate HTTP status
- no expensive database query
- no external API call
- no authentication unless explicitly required

Example conceptual response:

```json
{
  "status": "ok"
}
```

Follow existing project conventions if a response contract already exists.

Never expose:

- secrets
- environment values
- internal filesystem paths
- stack traces
- credentials
- internal infrastructure details

---

# 13. Readiness Endpoint

Determine whether deployment architecture requires a readiness endpoint.

If required, implement something such as:

```text
GET /api/ready
```

It must distinguish readiness from basic health/liveness.

If it checks dependencies, use only dependencies genuinely required for accepting traffic.

If not required:

```text
Readiness:
N/A — not required by current architecture
```

Document the decision.

Do not add unnecessary infrastructure.

---

# 14. Controllers

Controllers must remain thin.

Responsibilities:

- receive HTTP input
- validate/map request data as appropriate
- call service/application logic
- map result to HTTP response
- delegate errors

Avoid putting:

- database queries
- business rules
- payment operations
- authentication workflows
- large transformations

inside controllers.

Preferred:

```text
Controller
   ↓
Service
   ↓
Infrastructure
```

---

# 15. Services

Services represent application/domain operations.

For this task, create only meaningful services.

Do not create fake services solely because a `services/` directory exists.

If a health endpoint requires no application logic, a direct controller may be more appropriate than a meaningless service.

Architecture must favor clarity over ceremony.

---

# 16. Centralized Error Handling

Implement one consistent error pipeline.

Requirements:

- known application errors
- unknown errors
- correct HTTP status codes
- consistent response shape
- safe production messages
- useful development diagnostics
- Phase 00 logger integration
- no sensitive information leakage

Conceptual flow:

```text
Route / Controller / Service
          ↓
       Error
          ↓
Central Error Middleware
          ↓
Phase 00 Logger
          ↓
Sanitized HTTP Response
```

Do not duplicate error response logic across every controller.

---

# 17. Application Error Abstraction

If the repository has no existing application error abstraction, create a minimal one.

Potential fields:

```text
statusCode
code
message
details
```

Use only fields actually required.

Do not over-engineer.

Production responses must not expose internal implementation details.

---

# 18. Error Response Contract

Establish a consistent machine-readable error response.

Conceptual example:

```json
{
  "error": {
    "code": "INTERNAL_SERVER_ERROR",
    "message": "An unexpected error occurred."
  }
}
```

Follow existing project conventions if already defined.

Never expose production:

- stack traces
- SQL
- database errors
- filesystem paths
- environment variables
- tokens
- credentials
- internal URLs

Development diagnostics may be richer when safely controlled by configuration.

---

# 19. Logging Integration

Use the Phase 00 logger for appropriate backend events:

- application startup
- application shutdown
- request completion
- request failure
- unexpected server errors
- configuration/startup failures

Request logs should preferably contain:

```text
requestId
method
route/path
statusCode
duration
timestamp
```

Avoid sensitive query/path data where appropriate.

Never log:

```text
password
JWT
refresh token
OTP
API key
Stripe secret
database password
Authorization header
Cookie
Set-Cookie
```

Use redaction where the logging framework supports it.

---

# 20. Request Correlation

If Phase 00 already provides request IDs/correlation IDs:

**reuse them.**

If Phase 00 does not provide them, determine whether a minimal request-ID middleware is required.

Desired flow:

```text
HTTP Request
    ↓
Request ID
    ↓
Request logs
    ↓
Application logs
    ↓
Error logs
```

If accepting a client-supplied request ID:

- validate it
- sanitize it
- prevent log injection
- cap its length

Do not create a second incompatible correlation system.

---

# 21. Configuration

Centralize configuration.

Do not scatter:

```text
process.env.X
```

throughout the backend.

Preferred:

```text
Environment
    ↓
Configuration module
    ↓
Validated configuration
    ↓
Application
```

Only expose configuration required by TASK 02.1.

Potential values:

- NODE_ENV
- PORT
- HOST
- API prefix
- CORS origin
- logging level

Use the actual repository variables.

---

# 22. Environment Validation

Validate required environment variables at startup.

Requirements:

- fail fast for invalid required configuration
- useful errors for developers
- no secret values in error messages
- clear required/optional distinction
- correct type validation
- no silent acceptance of malformed values

Never expose environment variables through an API endpoint.

---

# 23. Environment Files

Inspect repository policy for:

```text
.env
.env.example
.env.local
```

Never commit secrets.

If an example file is required, use placeholders only.

Do not include:

- real passwords
- real tokens
- real API keys
- production credentials

---

# 24. CORS

Inspect actual frontend/backend deployment architecture.

Do not blindly use:

```text
origin: "*"
```

especially for authenticated production architecture.

Prefer explicit allowed origins.

Use environment configuration where appropriate.

Do not hardcode deployment domains without repository evidence.

---

# 25. Security Middleware

Inspect the current architecture before adding packages.

Where appropriate, establish:

- secure headers
- safe CORS
- request body limits
- malformed-request handling

Do not claim this task implements complete application security.

Authentication, authorization, rate limiting, CSRF, and domain-specific security belong to their appropriate tasks unless already established.

---

# 26. Request Body Limits

Configure reasonable body limits.

Do not leave request bodies effectively unlimited if the application does not require it.

Choose a value appropriate for the current foundation and document it.

Do not use unnecessarily large limits.

---

# 27. Graceful Shutdown

Where appropriate, implement graceful shutdown.

Handle:

```text
SIGTERM
SIGINT
```

Conceptual flow:

```text
Signal
  ↓
Stop accepting new connections
  ↓
Allow active requests to finish where practical
  ↓
Close resources
  ↓
Log shutdown
  ↓
Exit
```

Keep implementation simple.

Ensure it is compatible with containerized deployment.

---

# 28. Startup Failure

If required initialization fails:

- log through Phase 00 logger
- do not expose secrets
- terminate cleanly
- return an appropriate non-success process status

Do not start a partially configured server.

---

# 29. Database Boundary

TASK 02.1 does not implement domain database functionality.

If Prisma/database infrastructure already exists:

- inspect it
- preserve it
- do not add domain models
- do not add unrelated migrations

Expected:

```text
Domain schema changes:
NONE

Migrations:
NONE
```

If a readiness check genuinely requires an existing database connection, integrate with the established infrastructure without expanding the domain model.

---

# 30. External Services

Do not implement business integrations for:

- Stripe
- Brevo
- Cloudinary
- AI
- Socket.IO business events

unless Phase 00 explicitly established a foundational initialization boundary that TASK 02.1 must preserve.

This task establishes backend architecture, not commerce features.

---

# 31. TypeScript

If TypeScript is established:

- use strict typing
- avoid unnecessary `any`
- type configuration
- type middleware
- type errors
- type service results
- type request/response boundaries appropriately

Do not disable compiler checks.

Avoid:

```ts
// @ts-ignore
```

Use proper types.

Only use `@ts-expect-error` for a verified unavoidable limitation and document why.

---

# 32. Dependency Management

Before adding dependencies:

1. inspect existing packages
2. determine whether functionality already exists
3. reuse existing packages where appropriate
4. add only necessary dependencies
5. document architectural reasons

Do not add duplicate:

- loggers
- HTTP frameworks
- validators
- configuration libraries
- utility packages

---

# 33. Testing Foundation

The backend must be testable without production services.

Test at minimum:

## Application

- application initializes
- routes mount
- malformed requests are handled

## Health

- health endpoint response
- health endpoint status

## Errors

- unknown route
- known application error
- unexpected error
- sanitized production error

## Configuration

- valid configuration
- invalid required configuration

## Middleware

- request ID behavior if implemented
- request logging behavior where testable
- error middleware behavior
- middleware ordering where behavior matters

Test behavior, not file existence.

---

# 34. External Dependency Isolation

Tests must not depend on production:

- database
- Stripe
- Brevo
- Cloudinary
- AI services

unless an explicit integration environment exists.

Mock/stub external infrastructure appropriately.

Do not weaken production architecture to simplify tests.

---

# 35. Test Isolation

Tests must:

- be deterministic
- clean up resources
- avoid port collisions
- avoid global mutable state
- avoid test ordering dependencies

Prefer importing the Express app for integration tests instead of starting the production server.

---

# 36. Build and Scripts

Inspect the actual backend `package.json`.

Do not assume script names.

Run the repository's actual commands for:

- test
- typecheck
- lint
- build

Record exact commands and results.

---

# 37. GitHub CI

GitHub Actions is the remote verification source of truth.

After implementation:

1. commit changes
2. push the branch
3. inspect GitHub Actions
4. verify the exact commit
5. record:
   - workflow
   - run ID
   - commit SHA
   - job results
   - final status

Never claim CI passed without remote evidence.

---

# 38. Git Discipline

Before implementation:

```bash
git status
```

After implementation:

```bash
git status
git diff --stat
git diff
```

Before commit:

- inspect all files
- remove debug code
- remove temporary files
- check secrets
- check unrelated changes
- inspect dependency changes

Use a focused commit.

Suggested:

```text
feat(backend): establish foundation architecture
```

Follow repository conventions if different.

---

# 39. Documentation

Create/update appropriate Phase 02 documentation covering:

- backend architecture
- app/server separation
- routing
- middleware order
- controller/service boundaries
- error handling
- Phase 00 logging integration
- configuration
- environment variables
- health/readiness
- startup/shutdown
- testing
- security boundaries
- known limitations

Do not duplicate Phase 00 logging documentation unnecessarily.

Reference the Phase 00 logging foundation.

---

# 40. Architecture Documentation

Document the final request flow:

```text
Client
  ↓
Express
  ↓
Request ID / Security / Logging / CORS
  ↓
API Router
  ↓
Controller
  ↓
Service
  ↓
Infrastructure
  ↓
Response
```

Error flow:

```text
Any layer
  ↓
Central Error Handler
  ↓
Phase 00 Logger
  ↓
Sanitized HTTP Error
```

---

# 41. Configuration Documentation

Document the actual variables used.

Example format:

| Variable | Required | Purpose | Secret |
|---|---|---|---|
| NODE_ENV | | | No |
| PORT | | | No |
| HOST | | | No |
| CORS origin | | | No |
| LOG_LEVEL | | | No |

Do not invent variables.

Do not document real values.

---

# 42. API Documentation

Document foundation endpoints.

At minimum:

```text
GET /api/health
```

If readiness exists:

```text
GET /api/ready
```

For each document:

- method
- path
- purpose
- authentication requirement
- request
- response
- status codes

---

# 43. Security Review

Before completion inspect:

- secret leakage
- unsafe CORS
- excessive body limits
- stack trace leakage
- sensitive logging
- request ID/log injection
- unsafe error messages
- environment handling
- dependency vulnerabilities where CI provides evidence

Admin/business authorization is not part of this task unless already established.

---

# 44. Performance Review

Verify:

- startup remains reasonable
- middleware is not duplicated
- logging is not unnecessarily expensive
- health endpoint is lightweight
- no unnecessary DB query
- no unnecessary external requests
- configuration is not reparsed on every request
- request logging is appropriately bounded

Do not prematurely optimize.

---

# 45. Compatibility

Preserve compatibility with:

- Phase 00 foundation
- frontend expectations
- workspace structure
- package manager
- Docker/deployment
- CI/CD

Do not change frontend behavior unless required by an already-approved backend foundation contract.

---

# 46. Docker / Deployment Compatibility

Inspect existing Docker/deployment configuration.

If startup behavior changes, verify:

- entrypoint remains valid
- PORT behavior remains compatible
- environment configuration remains valid
- health checks remain valid
- graceful shutdown works in containers

Do not redesign deployment infrastructure.

---

# 47. Architecture Matrix

Create/update:

| Concern | Implementation | Source | Status |
|---|---|---|---|
| Runtime | | Phase 00/repository | |
| Express | | | |
| Routing | | | |
| Controllers | | | |
| Services | | | |
| Middleware | | | |
| Error handling | | | |
| Logging | Phase 00 logger | Phase 00 | |
| Configuration | | | |
| Health | | | |
| Readiness | | | |
| Testing | | | |
| CI | GitHub Actions | | |

Use evidence-based statuses.

---

# 48. Logging Matrix

Because logging was established in Phase 00, document:

| Event | Level | Logged Data | Sensitive Data |
|---|---|---|---|
| Startup | | | |
| Shutdown | | | |
| Request | | | |
| Request failure | | | |
| Unexpected error | | | |
| Config failure | | | |

Verify sensitive fields are excluded/redacted.

---

# 49. API Matrix

| Endpoint | Method | Auth | Purpose | Status |
|---|---|---|---|---|
| `/api/health` | GET | | | |
| `/api/ready` | GET | | | |

If readiness is not needed:

```text
/api/ready:
N/A — not required
```

---

# 50. Completion Criteria

TASK 02.1 is complete only when:

## Architecture

- [ ] Node.js foundation established
- [ ] Express established
- [ ] app/server separation established
- [ ] layered architecture established
- [ ] API routing established
- [ ] controllers established where meaningful
- [ ] services established where meaningful
- [ ] middleware pipeline established
- [ ] centralized error handling established
- [ ] centralized configuration established
- [ ] environment validation established

## Logging

- [ ] Phase 00 logger located
- [ ] Phase 00 logger reused
- [ ] no duplicate logger
- [ ] request logging integrated appropriately
- [ ] error logging integrated
- [ ] sensitive data excluded/redacted
- [ ] request correlation reused/implemented where required

## API

- [ ] API routing foundation established
- [ ] health endpoint implemented
- [ ] readiness decision documented
- [ ] response/error behavior documented

## Security

- [ ] CORS reviewed
- [ ] body limits reviewed
- [ ] security middleware reviewed
- [ ] error leakage prevented
- [ ] secret handling verified
- [ ] logging security verified

## Quality

- [ ] tests pass
- [ ] typecheck passes
- [ ] lint passes
- [ ] build passes

## CI

- [ ] branch pushed
- [ ] GitHub Actions verified
- [ ] exact commit verified
- [ ] required jobs pass

## Documentation

- [ ] architecture documented
- [ ] middleware order documented
- [ ] logging integration documented
- [ ] configuration documented
- [ ] API foundation documented
- [ ] testing documented
- [ ] limitations documented

## Git

- [ ] complete diff reviewed
- [ ] no unrelated changes
- [ ] no secrets
- [ ] no debug code
- [ ] focused commit
- [ ] working tree clean

---

# 51. Final Verification Report

The implementation summary MUST end with:

```text
TASK 02.1 BACKEND FOUNDATION — FINAL VERIFICATION

Branch:
feature/backend-foundation

Commit:
<full 40-character SHA>

Target:
develop

============================================================
ARCHITECTURE
============================================================

Node.js:
PASS / FAIL

Express:
PASS / FAIL

App/server separation:
PASS / FAIL

Layered architecture:
PASS / FAIL

Routing:
PASS / FAIL

Controllers:
PASS / FAIL

Services:
PASS / FAIL

Middleware:
PASS / FAIL

Error handling:
PASS / FAIL

Configuration:
PASS / FAIL

Environment validation:
PASS / FAIL

============================================================
LOGGING
============================================================

Phase 00 logger reused:
PASS / FAIL

Duplicate logger introduced:
NO / YES

Request logging:
PASS / FAIL

Error logging:
PASS / FAIL

Sensitive data protection:
PASS / FAIL

Request correlation:
PASS / FAIL / N/A

============================================================
API
============================================================

Health endpoint:
PASS / FAIL

Readiness:
PASS / FAIL / N/A

API contract:
PASS / FAIL

============================================================
SECURITY
============================================================

CORS:
PASS / FAIL

Body limits:
PASS / FAIL

Error leakage:
PASS / FAIL

Secret handling:
PASS / FAIL

Logging security:
PASS / FAIL

============================================================
DATABASE
============================================================

Schema changes:
NONE / REVIEW REQUIRED

Migrations:
NONE / REVIEW REQUIRED

============================================================
QUALITY
============================================================

Tests:
PASS / FAIL

Typecheck:
PASS / FAIL

Lint:
PASS / FAIL

Build:
PASS / FAIL

============================================================
CI
============================================================

Workflow:
<actual workflow>

Run ID:
<actual run ID>

Commit SHA:
<actual SHA>

Jobs:
<actual results>

GitHub CI:
PASS / FAIL / NOT VERIFIED

============================================================
DOCUMENTATION
============================================================

Architecture:
PASS / FAIL

Logging:
PASS / FAIL

Configuration:
PASS / FAIL

API:
PASS / FAIL

Testing:
PASS / FAIL

============================================================
GIT
============================================================

git status:
<actual output>

git diff --stat:
<actual output>

Unrelated changes:
NONE / <list>

============================================================
NOT VERIFIED
============================================================

<explicit list>

============================================================
FINAL IMPLEMENTER STATUS
============================================================

Remaining blockers:
<list>

Recommended score:
XX/100

Recommended status:
READY FOR ARCHITECT REVIEW / NOT READY

Do NOT declare architect approval.

The Principal Architect makes the final:
APPROVE / REQUEST CHANGES / REJECT
decision independently.
```

---

# 52. Architect Approval Standard

Passing local tests alone is not enough.

The Principal Architect will independently inspect:

1. changed files
2. backend architecture
3. middleware order
4. Phase 00 logging integration
5. configuration
6. environment validation
7. error handling
8. security
9. API compatibility
10. database impact
11. tests
12. GitHub CI
13. documentation
14. complete git diff

Suggested thresholds:

```text
90–100 → APPROVE
75–89  → REQUEST CHANGES
0–74   → REJECT
```

Any critical security issue, duplicate logging architecture, broken layering, secret leakage, or unverified CI may block approval regardless of score.

---

# 53. Non-Negotiable Rules

1. Reuse Phase 00 logging.
2. Never create a second logging architecture.
3. Never log secrets.
4. Never expose production stack traces.
5. Never hardcode environment-specific configuration.
6. Do not scatter `process.env` access.
7. Do not put database logic in controllers.
8. Do not put business logic in routes.
9. Keep controllers thin.
10. Create services only when they have meaningful responsibility.
11. Do not over-engineer abstractions.
12. Do not implement future commerce features prematurely.
13. Do not change API contracts without explicit requirement.
14. Do not create database migrations without explicit requirement.
15. Do not add duplicate dependencies.
16. Do not create a second configuration system.
17. Do not claim CI passed without remote evidence.
18. Do not claim tests passed without running them.
19. Do not fabricate Phase 00 behavior.
20. Do not fabricate repository paths.
21. Do not introduce unrelated refactors.
22. Do not commit secrets.
23. Do not approve your own implementation.
24. Stop and report when required architectural evidence is unavailable.

---

# 54. Expected Backend Architecture

The final foundation should conceptually resemble:

```text
                    CLIENT
                      │
                      ▼
                 ┌─────────┐
                 │ Express │
                 └────┬────┘
                      │
          ┌───────────┼───────────┐
          ▼           ▼           ▼
      Request ID   Security     Logging
          │        / CORS         │
          └───────────┼───────────┘
                      ▼
                 API Router
                      │
             ┌────────┴────────┐
             ▼                 ▼
        Controller          Controller
             │                 │
             ▼                 ▼
          Service           Service
             │                 │
             └────────┬────────┘
                      ▼
               Infrastructure
                      │
             ┌────────┼────────┐
             ▼        ▼        ▼
           DB       Stripe    Other
         (future)  (future)  (future)

                      │
                      ▼
              Central Error Handler
                      │
                      ▼
              Phase 00 Logger
```

TASK 02.1 establishes the foundation only.

---

# 55. Final Principle

Build the smallest backend foundation capable of safely supporting future ElectroHub phases.

Prefer:

```text
Simple
+
Layered
+
Testable
+
Observable
+
Secure
+
Configurable
```

over:

```text
Over-engineered
+
Duplicated
+
Premature abstractions
+
Hidden dependencies
```

The foundation must make later commerce tasks easier without prematurely implementing them.

# END OF TASK 02.1
