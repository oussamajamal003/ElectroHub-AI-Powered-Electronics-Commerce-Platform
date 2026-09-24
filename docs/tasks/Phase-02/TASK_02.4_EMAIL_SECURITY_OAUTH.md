# ELECTROHUB — TASK 02.4+
# EMAIL SECURITY, OTP, ACCOUNT SECURITY & GOOGLE OAUTH FOUNDATION

**Branch:** `feature/auth-email-security-02.4`  
**Target branch:** `develop`  
**Status:** Authoritative implementation task  
**Phase:** 02.4+  
**Scope:** Security + communications + persistence + customer authentication workflows + Google OAuth

---

# 0. Task Authority

TASK 02.4+ is a larger **security + communications + persistence phase**.

It is **not** merely an "add OTP" task.

The implementation must preserve the architecture established by:

1. Phase 00
2. TASK 02.1 — Backend Foundation
3. TASK 02.2 — Database Foundation
4. TASK 02.3 — Authentication
5. Existing Frontend Foundation
6. Existing ElectroHub design/Figma implementation

The implementation must evolve the **actual current `develop` schema**. Do not invent a new database baseline.

The current 02.2 foundation intentionally excluded authentication/OTP persistence and future advanced commerce/payment/AI/analytics tables. TASK 02.4+ is the approved boundary for the required authentication/email-security persistence introduced here.

> **Principal architecture rule:** Do not create overlapping authentication tables, duplicate token systems, or future commerce/payment/AI/analytics tables merely because those features are planned.

If an implementation detail is genuinely ambiguous, stop and document the ambiguity rather than silently inventing another architecture.

---

# 1. Branch and Delivery Model

Use:

```text
feature/auth-email-security-02.4
        ↓
develop
```

The phase is implemented sequentially:

```text
02.4-A
   ↓
02.4-B
   ↓
02.4-C
   ↓
02.4-D
```

Do not skip ahead and then retrofit the architecture.

Each stage must leave the repository in a coherent state.

---

# 2. Phase Architecture

## Stage responsibilities

| Stage | Backend | Database | Frontend | Testing |
|---|---|---|---|---|
| **02.4-A** | Brevo service + EmailService + OTP generation/delivery | Begin OTP/email-delivery persistence | Reusable OTP component foundation | Unit/API |
| **02.4-B** | Email verification + password recovery + sensitive account changes | Use/adjust security tables as required | Main verification/recovery/password workflows | Integration/E2E |
| **02.4-C** | Google OAuth + secure account linking | `OAuthAccount` migration design | Google login/register/linking states | OAuth/integration |
| **02.4-D** | Final hardening and compatibility verification | Final Prisma migration + DEV/PROD migration validation + seed | Final UI QA/fixes only | Full test + security review |

---

# 3. Critical Database Distinction

There is an important difference between:

```text
DB implementation
```

and:

```text
DB migration deployment
```

The schema can evolve during A and C without applying the final production migration immediately.

Example:

```text
02.4-A
schema.prisma
   ↓
OtpChallenge
EmailDelivery
User.emailVerifiedAt

02.4-C
schema.prisma
   ↓
OAuthAccount

02.4-D
all approved schema changes
   ↓
final Prisma migration
   ↓
DEV migration
   ↓
verification/tests
   ↓
PRODUCTION migration
```

This is preferred to waiting until 02.4-D to design the entire schema.

**Prisma remains the authoritative schema/migration source of truth.**

Do not use:

```text
prisma db push
```

for the authoritative migration workflow.

Do not manually create the authoritative tables through the Supabase dashboard or SQL editor.

---

# 4. Existing Schema Must Be Evolved

TASK 02.2 already established the foundation.

The existing database includes the core platform models and TASK 02.3 introduced authentication persistence including:

```text
User
RefreshToken
PasswordResetToken
```

Therefore:

> **TASK 02.4+ is an evolution of the actual existing schema, not a replacement schema.**

The implementation agent MUST inspect the current `develop` state before changing Prisma.

Do not recreate existing models from scratch.

Do not silently rename or delete existing fields unless the migration plan explicitly accounts for compatibility.

---

# 5. User Model Evolution

The current `User` model must gain email verification state.

Required concept:

```prisma
emailVerifiedAt DateTime?
```

`phone` must not be introduced.

The project has intentionally moved away from phone-based account/profile functionality.

The expected security-related relationships are:

```text
User
 ├── RefreshToken[]
 ├── OtpChallenge[]
 ├── OAuthAccount[]
 ├── EmailDelivery[]
 └── SecurityEvent[]
```

The existing `PasswordResetToken` must be evaluated as described below.

---

# 6. Password Hash Nullability

`passwordHash` may need to become nullable:

```prisma
passwordHash String?
```

Reason:

```text
Normal account
    ↓
email + password

Google-only account
    ↓
Google identity
```

Do not create fake passwords for OAuth-only accounts.

However, this change MUST be handled safely against existing development/admin/customer seed records.

Before changing nullability:

- inspect current data
- verify existing users have valid password hashes
- ensure local password login still works
- ensure admin login still works
- ensure seed behavior remains deterministic

---

# 7. Canonical OTP Architecture

Use **one generalized OTP challenge model** instead of creating:

```text
EmailVerificationOTP
PasswordResetOTP
ChangeEmailOTP
LoginOTP
SensitiveActionOTP
```

as separate competing tables.

The canonical model is:

```text
OtpChallenge
```

Recommended structure:

```prisma
enum OtpPurpose {
  EMAIL_VERIFICATION
  PASSWORD_RESET
  EMAIL_CHANGE
  SENSITIVE_ACTION
}

enum OtpChannel {
  EMAIL
}

model OtpChallenge {
  id          String      @id @default(uuid()) @db.Uuid
  userId      String      @db.Uuid
  purpose     OtpPurpose
  channel     OtpChannel  @default(EMAIL)

  destination String      @db.VarChar(255)
  codeHash    String      @db.VarChar(255)

  expiresAt   DateTime
  attempts    Int         @default(0)
  maxAttempts Int         @default(5)

  resendCount Int         @default(0)
  lastSentAt  DateTime?

  consumedAt  DateTime?
  lockedAt    DateTime?

  user User @relation(
    fields: [userId],
    references: [id],
    onDelete: Cascade,
    onUpdate: Cascade
  )

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([userId, purpose])
  @@index([userId, expiresAt])
  @@index([expiresAt])
  @@map("otp_challenges")
}
```

The agent may adapt exact naming/types to the current schema conventions, but must preserve the architecture.

---

# 8. OTP Purpose Scope

The model can eventually support:

```text
EMAIL_VERIFICATION
PASSWORD_RESET
EMAIL_CHANGE
SENSITIVE_ACTION
```

But:

> **Do not blindly implement every future OTP purpose in 02.4-A.**

Implement only the purposes required by the current workflow.

Current required workflows:

```text
EMAIL_VERIFICATION
PASSWORD_RESET
```

Potentially:

```text
EMAIL_CHANGE
SENSITIVE_ACTION
```

only if the corresponding customer feature is actually implemented in 02.4-B.

There is no requirement for customer login OTP in the current phase.

---

# 9. OTP Security Rules

Never store:

```text
123456
```

Store a protected hash:

```text
codeHash
```

The OTP must be generated with a cryptographically secure random source.

Required security properties:

- short expiration
- maximum attempts
- single-use consumption
- server-side expiration enforcement
- server-side resend throttling
- challenge locking after excessive failures
- challenge invalidation after successful use
- protection against replay
- no plaintext OTP persistence

The UI countdown is **not** a security mechanism.

The backend must enforce every security limit independently.

---

# 10. Secrets That Must Never Be Logged

Never log:

- OTP values
- password-reset credentials
- verification tokens
- JWTs
- passwords
- password hashes
- refresh tokens
- Brevo API keys
- database credentials
- OAuth client secrets
- OAuth authorization codes
- provider access/refresh tokens

Use the existing centralized application logger.

Do not introduce a second logging/correlation architecture.

---

# 11. Email Delivery Persistence

Add a delivery metadata boundary:

```prisma
enum EmailDeliveryStatus {
  QUEUED
  SENT
  DELIVERED
  FAILED
  BOUNCED
  BLOCKED
}

enum EmailType {
  ACCOUNT_VERIFICATION
  PASSWORD_RESET
  PASSWORD_CHANGED
  EMAIL_CHANGED
  SECURITY_ALERT
}

model EmailDelivery {
  id                String              @id @default(uuid()) @db.Uuid
  userId            String?             @db.Uuid

  type              EmailType
  recipient         String              @db.VarChar(255)

  provider          String              @default("BREVO") @db.VarChar(50)
  providerMessageId String?             @unique @db.VarChar(255)

  status            EmailDeliveryStatus @default(QUEUED)

  sentAt            DateTime?
  deliveredAt       DateTime?
  failedAt          DateTime?

  failureReason     String?

  user User? @relation(
    fields: [userId],
    references: [id],
    onDelete: SetNull,
    onUpdate: Cascade
  )

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([userId])
  @@index([type, status])
  @@index([recipient])
  @@index([createdAt])
  @@map("email_deliveries")
}
```

Adapt to current schema conventions if necessary.

## Never store in `EmailDelivery`

- OTP values
- reset credentials
- access tokens
- refresh tokens
- password hashes
- complete security-email HTML containing active credentials

`EmailDelivery` is delivery metadata, not secret storage.

---

# 12. Security Event Persistence

Add a small security-history boundary:

```prisma
enum SecurityEventType {
  EMAIL_VERIFIED
  PASSWORD_CHANGED
  PASSWORD_RESET
  EMAIL_CHANGED
  GOOGLE_CONNECTED
  LOGIN_SUCCESS
  LOGIN_FAILED
  LOGOUT
}

model SecurityEvent {
  id        String            @id @default(uuid()) @db.Uuid
  userId    String?           @db.Uuid
  type      SecurityEventType

  ipAddress String?           @db.VarChar(64)
  userAgent String?           @db.VarChar(1000)

  createdAt DateTime          @default(now())

  user User? @relation(
    fields: [userId],
    references: [id],
    onDelete: SetNull,
    onUpdate: Cascade
  )

  @@index([userId, createdAt])
  @@index([type, createdAt])
  @@map("security_events")
}
```

`SecurityEvent` is **not** a replacement for operational application logs.

Use:

```text
Logger
  ↓
operational/debug/security diagnostics

SecurityEvent
  ↓
important account-security history
```

No secrets in either.

---

# 13. Existing PasswordResetToken

The current schema already has:

```text
PasswordResetToken
```

02.4 will use OTP-based password recovery.

Do not accidentally maintain two active password-recovery mechanisms:

```text
PasswordResetToken
+
OtpChallenge(PASSWORD_RESET)
```

for the same workflow.

Choose one canonical recovery mechanism.

Preferred:

```text
Forgot Password
   ↓
Email
   ↓
OTP
   ↓
New Password
```

Then:

```text
OtpChallenge(PASSWORD_RESET)
```

is the active credential.

The existing `PasswordResetToken` must either:

1. remain temporarily for backward compatibility and be explicitly marked for later removal, or
2. be removed in 02.4 if the migration completely replaces it.

The implementation must document which option is chosen.

There must be no hidden duplicate recovery path.

---

# 14. Google OAuth Persistence

02.4-C introduces:

```prisma
enum OAuthProvider {
  GOOGLE
}

model OAuthAccount {
  id                String        @id @default(uuid()) @db.Uuid
  userId            String        @db.Uuid
  provider          OAuthProvider
  providerAccountId String        @db.VarChar(255)
  providerEmail     String        @db.VarChar(255)

  user User @relation(
    fields: [userId],
    references: [id],
    onDelete: Cascade,
    onUpdate: Cascade
  )

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([provider, providerAccountId])
  @@index([userId])
  @@index([provider, providerEmail])
  @@map("oauth_accounts")
}
```

Adapt exact field names to existing conventions without changing the architecture.

---

# 15. Google Account-Linking Security

Never blindly perform:

```text
Google email == existing User.email
```

→ automatic account linking.

That can create account-takeover scenarios.

The implementation must define a secure linking policy.

At minimum distinguish:

### New Google user

```text
Google identity
   ↓
No OAuthAccount
   ↓
No existing safe linked identity
   ↓
Create customer account
```

### Existing linked Google account

```text
Google identity
   ↓
OAuthAccount found
   ↓
Authenticate existing User
```

### Existing password account with same email

Do not silently merge identities.

Require a secure account-linking path consistent with the authentication architecture.

---

# 16. Brevo Integration

Brevo is the transactional email provider for 02.4.

Brevo transactional email is accessed through:

```text
POST /v3/smtp/email
```

The provider supports template IDs/parameters and returns a provider message ID.

Brevo transactional events include delivery-related events such as:

```text
delivered
bounced
blocked
```

and other provider statuses/events.

The exact provider integration must remain behind ElectroHub's own service boundary.

---

# 17. Brevo Environment Variables

Use backend-only environment variables:

```env
# Brevo (Email)
BREVO_API_KEY=your-brevo-api-key-here
BREVO_SENDER_EMAIL=your-verified-email@example.com
BREVO_SENDER_NAME=ElectroHub
```

Rules:

- real key belongs only in local/secret environment configuration
- `.env.example` contains placeholders only
- never commit the actual API key
- never expose the key through Vite/frontend environment variables
- never return the key through an API
- never log the key
- sender must be a verified Brevo sender
- do not hard-code sender identity in application code

A personal verified email is acceptable for the current portfolio project. A custom domain is not required by this task.

---

# 18. Brevo Service Architecture

Do not call Brevo directly from controllers.

Required conceptual boundary:

```text
Controller
    ↓
Application Service
    ↓
EmailService
    ↓
BrevoProvider
    ↓
Brevo API
```

Suggested structure:

```text
apps/backend/src/
├── services/
│   ├── auth.service.ts
│   ├── otp.service.ts
│   └── email.service.ts
│
└── integrations/
    └── brevo/
        ├── brevo.client.ts
        └── brevo.provider.ts
```

The agent MUST inspect the existing backend structure before creating files.

Do not blindly create duplicate service directories.

Choose either:

- official Brevo Node SDK, or
- a small HTTPS client

and use the chosen approach consistently.

Do not mix multiple Brevo client approaches.

---

# 19. Email Catalog

Authentication email types:

```text
ACCOUNT_VERIFICATION
PASSWORD_RESET
PASSWORD_CHANGED
EMAIL_CHANGED
SECURITY_ALERT
```

Future commerce emails may include:

```text
ORDER_CREATED
ORDER_CONFIRMED
PAYMENT_RECEIVED
PAYMENT_FAILED
ORDER_SHIPPED
ORDER_DELIVERED
ORDER_CANCELLED
```

Do not implement commerce emails in 02.4 unless explicitly required by a later approved commerce task.

---

# 20. Email Delivery Flow

Expected:

```text
Auth Service
    ↓
EmailService
    ↓
Create QUEUED EmailDelivery
    ↓
BrevoProvider
    ↓
POST /v3/smtp/email
    ↓
Brevo messageId
    ↓
Persist providerMessageId
    ↓
Mark SENT
```

If the provider fails:

```text
FAILED
```

with a safe internal failure reason.

Do not expose provider secrets or sensitive provider responses to customers.

---

# 21. Brevo Webhook

Create a dedicated webhook boundary:

```text
Brevo
   ↓
POST /api/webhooks/brevo
   ↓
validate/secure webhook
   ↓
process event
   ↓
EmailDelivery
```

The implementation must use an appropriate webhook verification/security mechanism supported by the configured Brevo integration.

Never trust arbitrary webhook input.

Webhook handling must be:

- authenticated/verified as appropriate
- validated
- idempotent
- safe to retry
- protected from malformed payloads
- prevented from mutating unrelated records

Delivery events should update metadata such as:

```text
SENT
DELIVERED
BOUNCED
BLOCKED
FAILED
```

---

# 22. Stage 02.4-A — Email + OTP Foundation

## Backend

Implement:

- Brevo configuration
- Brevo provider/client
- `EmailService`
- email catalog
- secure OTP generation
- OTP hashing
- OTP verification utility/service
- expiration
- attempt limits
- resend throttling
- challenge consumption/locking
- `EmailDelivery` persistence
- safe logging
- provider failure handling

Do not implement the complete customer recovery UI here.

## Database

Begin schema evolution with:

```text
User.emailVerifiedAt
OtpChallenge
EmailDelivery
```

Add `SecurityEvent` here only if required by the implementation architecture; otherwise it may be introduced before finalization.

Do not add:

```text
Stripe
OrderStatusHistory
Shipment
AIInteraction
RecommendationEvent
AnalyticsEvent
```

## Frontend

Create a reusable OTP component/foundation.

Required behavior:

- six digits
- one logical OTP value
- auto-advance
- paste
- backspace
- delete
- arrow navigation
- numeric-only
- `inputmode="numeric"`
- loading
- error
- expired
- locked
- resend countdown

The component must not contain business-specific API logic.

## Testing

Unit/API tests for:

- OTP randomness
- hashing
- verification
- expiry
- attempt count
- lock
- consume
- replay prevention
- resend throttle
- email service/provider contract
- provider failure handling
- delivery persistence

---

# 23. Stage 02.4-B — Customer Security Workflows

This is the largest UI stage.

## 23.1 Customer registration

Flow:

```text
Create Account
    ↓
Create account
    ↓
emailVerifiedAt = null
    ↓
Generate OTP
    ↓
Store hash
    ↓
Send via Brevo
    ↓
Verify your email
    ↓
OTP
    ↓
Verified
    ↓
Authenticated customer session
```

The registration flow should remain seamless.

After successful verification, establish the authenticated customer session without requiring an unnecessary manual second login.

Unverified accounts must not receive full customer access.

---

# 24. Registration UI

Customer auth remains inside the existing reusable customer authentication modal.

Registration form:

```text
Create Account

First Name
Last Name
Email
Password
Confirm Password

[ Create Account ]
```

After successful creation:

```text
Verify your email

We've sent a 6-digit code to
o***@gmail.com

[ _ _ _ _ _ _ ]

Didn't receive the code?

Resend code
Resend available in 42s

Change email
```

Do not use:

```text
Back to Login
```

as the primary action here.

The user came from registration.

Use:

```text
Change email
```

or an equivalent return-to-registration action that matches the final UX.

---

# 25. OTP UI Behavior

The six visual boxes represent **one logical OTP input**.

Expected:

```text
type 1 → focus 2
type 2 → focus 3
...
```

Paste:

```text
483921
```

becomes:

```text
[4][8][3][9][2][1]
```

Backspace should naturally move to the previous position.

Only digits:

```text
0–9
```

Mobile:

```html
inputmode="numeric"
```

Do not implement six independent form fields.

---

# 26. OTP UI States

## Initial

```text
Verify your email
Enter the 6-digit code
```

## Verifying

```text
Verifying...
```

Disable duplicate submission while the request is active.

## Wrong code

```text
Invalid verification code.
Please check the code and try again.
```

Do not expose backend implementation details.

## Expired

```text
This code has expired.

[ Send a new code ]
```

## Too many attempts

```text
Too many incorrect attempts.

Please request a new code.
```

## Success

```text
Email verified!

Your account is ready.
```

Then continue to the authenticated customer experience.

---

# 27. Resend Behavior

UI:

```text
Didn't receive the code?

Resend code in 42s
```

Then:

```text
Resend code
```

During request:

```text
Sending...
```

Restart the countdown only after the backend confirms successful resend.

The backend independently enforces:

- resend throttling
- challenge limits
- account/IP protection
- expiration

The UI timer is not security.

---

# 28. Login and Unverified Email

Recommended product behavior:

```text
Email + Password
      ↓
credentials valid?
      ↓
emailVerifiedAt?
   /          \
 yes           no
 ↓             ↓
login       verification flow
```

An unverified customer must not silently receive full authenticated access.

The API should communicate the verification-required state in a controlled manner.

Do not expose unnecessary account information.

---

# 29. Forgot Password

Flow:

```text
Forgot Password
      ↓
Enter email
      ↓
Generic response
      ↓
If account exists:
    create PASSWORD_RESET OTP
      ↓
Brevo
      ↓
OTP UI
      ↓
Verify
      ↓
New Password
      ↓
Invalidate reset credential
      ↓
Invalidate existing refresh sessions
      ↓
Password changed
```

## Enumeration protection

Never return:

```text
Email doesn't exist
```

Use the same external response for known and unknown addresses.

Example:

```text
If an account exists, we've sent password
reset instructions.
```

Do not leak whether an account exists through:

- response message
- HTTP status differences
- timing differences where reasonably avoidable
- email-delivery API behavior
- logs exposed to users

---

# 30. Forgot Password UI

Initial:

```text
Forgot password?

Enter your email address and
we'll send you a verification code.

Email
[________________________]

[ Send Code ]

← Back to Login
```

OTP:

```text
Verify your email

Enter the 6-digit code sent to
o***@gmail.com

[ _ ][ _ ][ _ ][ _ ][ _ ][ _ ]

[ Verify ]

Didn't receive the code?
Resend code

← Back to Login
```

New password:

```text
Create new password

New Password
[________________]

Confirm Password
[________________]

[ Reset Password ]
```

Success:

```text
Password changed successfully.

[ Continue to Login ]
```

---

# 31. Password Change While Logged In

Use:

```text
POST /api/auth/change-password
```

Do not use a generic profile PATCH for password changes.

Require:

- authenticated user
- current password
- new password
- password policy
- confirmation at UI level
- appropriate re-authentication/security checks
- refresh-session invalidation as defined by the auth architecture
- security event
- safe transactional email notification

UI:

```text
Change Password

Current Password
[________________]

New Password
[________________]

Confirm New Password
[________________]

[ Change Password ]
```

Success:

```text
Your password has been changed.
```

---

# 32. Account/Profile Security Boundary

Existing account profile updates must not silently become password-management APIs.

The profile update endpoint should continue to whitelist ordinary profile fields only.

Password changes use:

```text
POST /api/auth/change-password
```

Email changes, if implemented, must have their own controlled workflow.

Phone functionality is not part of this phase.

---

# 33. Sensitive Account Changes

02.4 establishes architecture for sensitive customer operations such as:

```text
Change password
Change email
Verify new email
Disable account
Delete account
Add OAuth provider
Remove OAuth provider
```

Do not automatically implement all of these.

Only implement the ones explicitly approved for 02.4-B.

Use the common security foundation:

```text
OtpChallenge
SecurityEvent
EmailService
```

rather than creating another authentication system.

---

# 34. Optional Email-Change Workflow

If email change is implemented in 02.4-B:

```text
Authenticated user
       ↓
request email change
       ↓
send verification OTP/link to NEW email
       ↓
verify
       ↓
change email
       ↓
invalidate sessions if required
       ↓
security notification to OLD email
```

Do not immediately replace the email before the new address is verified.

Store the intended destination in:

```text
OtpChallenge.destination
```

---

# 35. Stage 02.4-C — Google OAuth

Do not mix Google OAuth into the first OTP implementation.

02.4-C owns:

- Google OAuth backend
- provider configuration
- OAuth callback/state handling as applicable
- identity validation
- `OAuthAccount`
- secure account creation
- secure account linking
- login/register UI
- linking states
- error handling

---

# 36. Google UI

Customer Login/Register should support:

```text
Continue with Google
```

with:

```text
──────── OR ────────
```

The exact placement must follow the existing ElectroHub design system/Figma source of truth.

Do not duplicate the Google button across unrelated screens.

---

# 37. Google UI States

Handle:

```text
Google authentication loading
Google authentication success
Google authentication failure
Google account already linked
Existing password account
Account linking required
Account linking success
Account linking failure
User cancellation
Provider/network failure
```

Never display raw provider errors or secrets.

---

# 38. Customer Auth UI Architecture

Do not create six unrelated authentication UIs.

Use the existing customer authentication modal/workflow:

```text
Customer Auth Modal
        │
        ├── Login
        ├── Register
        ├── Verify Email
        ├── Forgot Password
        ├── Verify Reset OTP
        └── Set New Password
```

Account settings can host:

```text
Change Password
```

Google authentication is shared between Login/Register according to the approved Figma UX.

---

# 39. Expected Frontend Structure

The agent MUST inspect the actual repository first.

A possible structure is:

```text
apps/frontend/src/
├── components/
│   └── auth/
│       ├── CustomerAuthModal.tsx
│       ├── LoginForm.tsx
│       ├── RegisterForm.tsx
│       ├── OtpVerification.tsx
│       ├── ForgotPasswordForm.tsx
│       ├── ResetPasswordForm.tsx
│       ├── ChangePasswordForm.tsx
│       └── GoogleAuthButton.tsx
│
├── contexts/
│   └── AuthContext.tsx
│
└── pages/
    └── admin/
```

Do not create duplicates if equivalent components already exist.

Reuse the existing UI foundation.

---

# 40. Figma / UI Source of Truth

The OTP screenshot/Figma Make screen is a **generic starting point**, not the final ElectroHub workflow.

Adapt it to the actual product.

Preferred wording:

### Title

```text
Verify your email
```

not:

```text
Verify Your Account
```

### Email text

```text
We sent a 6-digit code to
o***@gmail.com
```

Do not unnecessarily expose the complete address.

Use the existing ElectroHub:

- typography
- spacing
- buttons
- inputs
- modal behavior
- tokens
- animations
- validation patterns

Do not introduce random visual redesigns.

---

# 41. UI Validation Rules

Respect the existing touched/dirty validation behavior.

Do not show field errors on the first keystroke or before the user meaningfully interacts with the field.

Use the existing loading UX.

Do not add artificial delays merely to make requests "feel" slower.

During active requests:

- prevent duplicate submission
- preserve form state
- show the established loading state
- prevent destructive modal closure where appropriate

---

# 42. Admin Authentication Boundary

Admin authentication remains:

```text
/admin/login
      ↓
email + password
      ↓
role === ADMIN
      ↓
JWT session
```

**Admin OTP is NOT part of 02.4.**

Do not add:

- admin OTP login
- admin email verification workflow
- admin invitation system
- admin MFA
- admin recovery OTP

unless explicitly approved by a later task.

Seeded development admin accounts remain ordinary email/password accounts provisioned through the DEV seed.

---

# 43. Development Seed Updates

02.4-D may update the DEV seed to support testing.

The seed must remain:

- deterministic
- idempotent
- development-only
- safe
- free of real secrets

Existing seeded admin accounts must remain valid and usable.

Expected development admin identities include the existing project-approved admin fixtures.

Do not seed:

- OTP codes
- active reset credentials
- real Brevo keys
- production credentials

A development customer fixture may be pre-verified if needed for deterministic testing, but registration-created users must start with:

```text
emailVerifiedAt = null
```

If credentials are seeded, store only development password hashes.

---

# 44. Migration Strategy

## During A/C

Schema design may evolve in:

```text
prisma/schema.prisma
```

but do not prematurely apply incomplete migrations to production.

## During D

Generate/finalize the approved Prisma migration from the actual current schema.

Then:

```text
Prisma migration
      ↓
DEV database
      ↓
verify schema
      ↓
seed
      ↓
run tests
      ↓
verify data/integrity
      ↓
PRODUCTION migration
```

Never:

```text
schema.prisma
   ↓
prisma db push
```

for the authoritative workflow.

Never manually create tables in Supabase to "make it work."

---

# 45. Migration Safety Requirements

Before migration:

- inspect current `develop`
- inspect actual current Prisma schema
- inspect existing migration history
- inspect current DEV state
- verify existing auth data assumptions
- verify existing `PasswordResetToken`
- verify seeded users
- verify no conflicting table names

Migration must be reviewed for:

- data loss
- destructive column changes
- nullability changes
- foreign-key behavior
- unique constraints
- index duplication
- enum changes
- migration ordering
- rollback/recovery implications

Production migration must be controlled.

Do not automatically seed production.

---

# 46. Production Migration

Production must receive only the required schema migration.

Do not run:

```text
npm run seed
```

against production.

Production must contain:

```text
schema
+
real application data
```

not development fixtures.

Production migration evidence must include:

- target environment
- migration name/hash
- success result
- schema verification
- no unintended data mutation
- no secret leakage

---

# 47. Testing Requirements — Backend

Required tests include:

## OTP

- secure generation
- hash verification
- wrong-code rejection
- expiration
- maximum attempts
- lock
- successful consumption
- replay prevention
- resend throttling
- concurrent verification safety where relevant

## Email

- Brevo request contract
- template/parameter handling
- sender configuration
- provider message ID persistence
- provider failure
- delivery status transitions

## Registration

```text
register
→ account created
→ emailVerifiedAt null
→ OTP created
→ email sent
→ verify
→ emailVerifiedAt set
→ authenticated session
```

## Login

- valid verified customer
- invalid credentials
- unverified customer
- disabled account
- admin login compatibility
- role authorization

## Password recovery

- generic response
- no email enumeration
- OTP verification
- password update
- reset credential invalidation
- refresh-session invalidation
- expired/locked OTP

## Change password

- authentication required
- current password required
- wrong current password
- password policy
- session invalidation
- security event
- notification email

## OAuth

- valid Google identity
- existing OAuthAccount
- new OAuth account
- identity uniqueness
- secure linking
- refusal of unsafe automatic linking
- provider failure
- user cancellation
- invalid state/token handling

## Webhook

- valid webhook
- invalid/malformed webhook
- idempotent processing
- duplicate provider event
- safe delivery status update

---

# 48. Testing Requirements — Frontend

Verify:

- registration workflow
- verification transition
- OTP entry
- paste
- backspace
- delete
- numeric-only behavior
- mobile keyboard
- resend countdown
- resend loading
- expired state
- locked state
- wrong-code state
- forgot-password workflow
- reset-password workflow
- change-password workflow
- success states
- Google loading
- Google error
- account-linking state
- modal transitions
- no horizontal overflow
- responsive behavior
- existing design-system consistency

Do not rely only on unit tests.

Browser/E2E verification is required before final approval where the environment permits it.

---

# 49. Swagger / API Documentation

All new APIs must be documented.

At minimum document the applicable endpoints for:

```text
email verification
OTP verification
OTP resend
forgot password
password reset
change password
email change (if implemented)
Google OAuth
OAuth callback/linking
Brevo webhook
```

Documentation must specify:

- request schema
- response schema
- error responses
- authentication requirements
- rate-limit behavior where relevant
- security behavior
- cookie/token behavior

Swagger must match the real implementation.

---

# 50. API Compatibility

Before completion verify that 02.4 does not break:

- existing customer login
- existing admin login
- refresh-token flow
- logout
- `/api/auth/me`
- protected routes
- RBAC
- frontend auth provider
- existing API client 401 refresh behavior
- existing backend error contract
- existing rate limiting
- existing logger

Do not silently rename or remove existing auth endpoints.

If an endpoint changes, document compatibility/migration.

---

# 51. Security Review

Final review must explicitly check:

### Authentication

- JWT claims remain minimal
- access tokens remain short-lived according to existing architecture
- refresh tokens remain protected
- refresh cookies remain HttpOnly
- secure cookie settings remain correct for environment
- refresh replay/rotation behavior remains intact

### Passwords

- bcrypt/password hashing remains secure
- no plaintext passwords
- password policy enforced
- OAuth-only users do not receive fake passwords

### OTP

- cryptographically secure generation
- hash at rest
- expiry
- max attempts
- lock
- single-use
- resend throttle
- no logging

### Email

- Brevo key server-only
- sender configuration server-only
- no secret logging
- generic password-recovery response
- no sensitive email body persistence

### OAuth

- provider identity verified
- state/CSRF protections where applicable
- no unsafe email-only auto-linking
- provider credentials not leaked

### Database

- migrations are controlled
- no `db push`
- no manual schema bypass
- no unauthorized tables
- no production seed
- no destructive migration without explicit justification

---

# 52. Rate Limiting

Existing authentication rate limits must remain intact.

Do not remove security limits merely because the frontend is inconvenient.

OTP must additionally enforce:

```text
per-challenge attempt limit
resend throttle
reasonable account/IP protection
```

The frontend must not hard-code backend limits as the source of truth.

---

# 53. Logging

Reuse the existing centralized logger.

Recommended security events include:

```text
AUTH_REGISTER_SUCCESS
AUTH_REGISTER_FAILURE
AUTH_LOGIN_SUCCESS
AUTH_LOGIN_FAILURE
AUTH_REFRESH_SUCCESS
AUTH_REFRESH_FAILURE
AUTH_LOGOUT_SUCCESS
AUTH_LOGOUT_FAILURE

AUTH_EMAIL_VERIFIED
AUTH_PASSWORD_RESET_REQUEST
AUTH_PASSWORD_RESET_SUCCESS
AUTH_PASSWORD_RESET_FAILURE
AUTH_PASSWORD_CHANGED

AUTH_GOOGLE_CONNECTED
AUTH_GOOGLE_LOGIN_SUCCESS
AUTH_GOOGLE_LOGIN_FAILURE

EMAIL_SEND_SUCCESS
EMAIL_SEND_FAILURE
EMAIL_DELIVERY_UPDATED
```

Do not include:

```text
OTP
password
JWT
refresh token
reset token
Brevo API key
OAuth secret
database URL
```

---

# 54. Repository Hygiene

Before completion:

- remove unused authentication files
- remove dead auth code
- remove duplicate OTP/recovery implementations
- remove unused dependencies
- remove obsolete password-reset paths if fully migrated
- remove scratch implementation files
- remove temporary debug code
- remove generated runtime logs from Git
- remove accidental local secrets
- inspect `.gitignore`

Do not commit:

- personal/local screenshots
- scratch files
- generated QA images
- local runtime logs
- `.env.local`
- real Brevo API keys
- OAuth secrets
- database credentials

Keep local scratch/QA assets locally when useful.

Do not delete required product/design assets that are intentionally part of the repository.

---

# 55. Explicitly Out of Scope — Authentication

Do not implement unless a separate approved task requires it:

- admin OTP
- admin invitation
- admin MFA
- customer login OTP
- phone authentication
- SMS OTP
- passwordless login
- FIDO2/WebAuthn
- passkeys
- cryptocurrency/wallet authentication
- wallet signatures
- private keys/seed phrases

---

# 56. Explicitly Out of Scope — Commerce

Do not add advanced commerce persistence in 02.4:

```text
ProductVariant
ProductAttribute
ProductSpecification
InventoryMovement
OrderStatusHistory
Shipment
ShipmentEvent
```

The existing 02.2 commerce foundation remains untouched unless a 02.4 dependency genuinely requires a minimal compatibility change.

---

# 57. Explicitly Out of Scope — Payments

Do not add:

```text
PaymentAttempt
Refund
PaymentWebhookEvent
PaymentMethod
Stripe-specific persistence
```

Do not implement Stripe UI.

Payment architecture belongs to its own later task.

---

# 58. Explicitly Out of Scope — AI

Do not add:

```text
AIInteraction
RecommendationEvent
RecommendationResult
UserBehavior
AIEmbedding
```

Do not implement AI UI or recommendation persistence.

AI belongs to a later phase.

---

# 59. Explicitly Out of Scope — Analytics

Do not add:

```text
AnalyticsEvent
event aggregation
reporting
analytics dashboards
```

Analytics gets its own boundary later.

---

# 60. Final Logical Database Architecture

The long-term logical architecture is:

```text
AUTH
├── User
├── RefreshToken
├── OtpChallenge
├── PasswordResetToken   ← only if still required
├── OAuthAccount
└── SecurityEvent

EMAIL
├── EmailDelivery
└── EmailWebhookEvent    ← if later separated from webhook handling

COMMERCE
├── Product
├── ProductImage
├── Inventory
├── Cart
├── CartItem
├── Wishlist
├── WishlistItem
├── Order
├── OrderItem
├── OrderStatusHistory   ← later
└── Shipment             ← later

PAYMENTS
├── Payment
├── PaymentAttempt       ← later
├── Refund               ← later
└── PaymentWebhookEvent  ← later

AI
├── AIInteraction
├── RecommendationEvent
└── RecommendationResult

ANALYTICS
└── AnalyticsEvent
```

02.4 owns the AUTH + EMAIL boundary only.

---

# 61. Final Architecture Diagram

```text
                    ELECTROHUB AUTH 02.4+
                           │
          ┌────────────────┼────────────────┐
          ↓                ↓                ↓
       OTP/Email        Password          OAuth
          │             Security            │
          ↓                ↓                ↓
   OtpChallenge     Password Reset     OAuthAccount
          │          Change Password
          │                │
          └────────┬───────┘
                   ↓
                  User
                   │
        ┌──────────┼──────────┐
        ↓          ↓          ↓
 EmailDelivery SecurityEvent RefreshToken
        │
        ↓
      Brevo
```

---

# 62. Stage 02.4-D — Finalization Gate

02.4-D is not where the implementation should suddenly begin.

It is the final gate.

Required sequence:

```text
02.4-A
   ↓
02.4-B
   ↓
02.4-C
   ↓
02.4-D
```

Then:

```text
Finalize Prisma schema
        ↓
Generate migration
        ↓
Apply to DEV
        ↓
Verify schema
        ↓
Run DEV seed
        ↓
Verify seeded accounts
        ↓
Run backend tests
        ↓
Run frontend tests
        ↓
Run integration/E2E
        ↓
Verify Swagger/API compatibility
        ↓
Verify Brevo delivery
        ↓
Security review
        ↓
Browser QA
        ↓
Cleanup
        ↓
Documentation
        ↓
CI/CD
        ↓
Production migration
        ↓
Final architect review
```

---

# 63. DEV Verification Requirements

After migration:

Verify:

```text
tables
columns
foreign keys
indexes
unique constraints
enum values
nullable fields
migration metadata
```

Verify application behavior:

```text
register
verify email
login
refresh
logout
forgot password
reset password
change password
Google login/linking
admin login
```

Verify no unrelated data changed.

---

# 64. Seed Verification

The development seed must be run and verified.

At minimum verify:

```text
ADMIN role exists
CUSTOMER role exists
seeded admin accounts exist
seeded development customer exists if required
existing product/category foundation remains intact
```

If the seed is intended to be idempotent, prove it by executing it more than once and comparing expected final state.

Do not seed production.

---

# 65. Brevo Verification

Do not mark Brevo complete because the SDK/client compiles.

Evidence must demonstrate:

```text
API request accepted
messageId returned
EmailDelivery persisted
email delivered or provider result verified
```

Where provider delivery is not available in CI, use mocked integration tests plus an explicit real-environment verification report.

Never expose the API key in evidence.

---

# 66. Browser / E2E Verification

Verify the real browser workflow:

### Registration

```text
Header
→ Account
→ Create Account
→ Register
→ Verify email
→ OTP
→ Authenticated
```

### Login

```text
Account
→ Login
→ credentials
→ authenticated
```

### Recovery

```text
Login
→ Forgot Password
→ email
→ OTP
→ new password
→ success
```

### Change password

```text
Account
→ settings
→ Change Password
→ success
```

### Google

```text
Login/Register
→ Continue with Google
→ provider flow
→ authenticated/linking state
```

### Admin

```text
/admin/login
→ email/password
→ ADMIN role
→ admin console
```

No admin OTP.

---

# 67. CI/CD Requirements

All repository CI checks must pass.

At minimum:

```text
Frontend typecheck
Frontend build
Frontend tests
Frontend lint

Backend typecheck
Backend build
Backend tests
Backend lint

Security checks
AI service tests where part of repository CI
```

If a CI job fails:

> Do not declare the task complete.

Investigate the root cause.

Do not weaken security thresholds or disable tests merely to obtain a green build without explicit architectural approval.

---

# 68. Documentation Requirements

Update appropriate documentation for:

- Brevo configuration
- local environment variables
- email sender configuration
- OTP behavior
- password recovery
- password change
- Google OAuth setup
- account-linking behavior
- migration workflow
- DEV seed workflow
- production migration
- webhook behavior
- security decisions
- API/Swagger
- testing
- known limitations

Never document real secrets.

---

# 69. Definition of Done

TASK 02.4+ is complete only when all applicable gates are PASS.

```text
Architecture
[ ] 02.4 boundary respected
[ ] AUTH/EMAIL separated from commerce/payment/AI/analytics
[ ] no duplicate authentication/token systems
[ ] actual current schema evolved rather than recreated

Backend
[ ] Brevo provider implemented
[ ] EmailService implemented
[ ] OTP service implemented
[ ] verification/recovery/change-password workflows complete
[ ] Google OAuth complete
[ ] account linking secure
[ ] existing auth compatibility preserved

Database
[ ] User.emailVerifiedAt
[ ] OtpChallenge
[ ] EmailDelivery
[ ] SecurityEvent where approved
[ ] OAuthAccount
[ ] PasswordResetToken decision documented
[ ] migration reviewed
[ ] DEV migration successful
[ ] DEV seed successful
[ ] production migration successful
[ ] no production seed

Frontend
[ ] reusable OTP component
[ ] registration verification
[ ] forgot password
[ ] reset password
[ ] change password
[ ] Google login/register
[ ] account-linking states
[ ] loading/error/expired/locked states
[ ] responsive/browser QA
[ ] Figma/design-system consistency

Security
[ ] OTP hashed
[ ] OTP expiration
[ ] OTP attempt limit
[ ] OTP resend throttle
[ ] OTP replay prevention
[ ] no secrets logged
[ ] generic password-recovery response
[ ] refresh sessions invalidated appropriately
[ ] secure OAuth linking
[ ] Brevo key protected
[ ] webhook secured
[ ] admin OTP not introduced

API
[ ] Swagger updated
[ ] API contracts verified
[ ] existing auth endpoints remain compatible
[ ] frontend API client compatibility verified

Testing
[ ] backend tests pass
[ ] frontend tests pass
[ ] integration tests pass
[ ] E2E/browser verification pass
[ ] CI/CD pass
[ ] real Brevo verification evidence or approved mock/evidence strategy

Repository
[ ] unused/dead auth code removed
[ ] duplicate recovery path removed or explicitly deprecated
[ ] scratch/debug artifacts removed
[ ] local secrets excluded
[ ] generated runtime artifacts excluded
[ ] docs updated

Final
[ ] implementation summary produced
[ ] changed files reviewed
[ ] migration reviewed
[ ] security review completed
[ ] final architectural review completed
```

---

# 70. Required Evidence Before Approval

The implementation agent must provide evidence, not assertions.

Required evidence should include:

1. Branch and commit SHA
2. Changed-file list
3. Prisma schema diff
4. Migration name/hash
5. DEV migration output
6. DEV schema verification
7. Seed output
8. Seed idempotency evidence
9. Backend test results
10. Frontend test results
11. CI run URL/ID and results
12. Swagger verification
13. Brevo verification
14. OTP security test evidence
15. Password recovery enumeration test
16. Google OAuth test evidence
17. Browser/E2E evidence
18. Security review results
19. Production migration evidence
20. Documentation updates

Never declare completion based only on:

```text
"implemented"
"tested locally"
"works for me"
```

---

# 71. Principal Architect Review Gate

Before merge, review:

### Architecture
- Are AUTH and EMAIL cleanly separated?
- Are future commerce/payment/AI/analytics models excluded?
- Are duplicate token systems avoided?
- Is Brevo isolated behind `EmailService`?

### Security
- Can OTPs be brute-forced?
- Can OTPs be replayed?
- Can password recovery enumerate accounts?
- Can OAuth linking cause account takeover?
- Are refresh sessions invalidated appropriately?
- Are secrets absent from logs/database/email metadata?

### Database
- Is migration additive/safe?
- Are nullability changes safe?
- Are indexes appropriate?
- Are foreign keys correct?
- Is migration history clean?
- Was DEV verified before production?

### API
- Are contracts backward-compatible?
- Is Swagger accurate?
- Are error states consistent?

### Frontend
- Does the workflow use the existing auth modal?
- Is the OTP a single logical input?
- Are loading/validation states correct?
- Does the UI match the existing design system?
- Are there any regressions in login/admin auth?

### Operations
- Is Brevo configuration documented?
- Is webhook handling secure/idempotent?
- Does CI pass?
- Is browser verification complete?

---

# 72. Approval Rule

The task is eligible for approval only if:

```text
Architecture PASS
AND
Security PASS
AND
Database PASS
AND
Backend PASS
AND
Frontend PASS
AND
Testing PASS
AND
CI/CD PASS
AND
Documentation PASS
AND
Production migration evidence PASS
```

Any critical security issue, unsafe migration, duplicate active authentication mechanism, secret leakage, broken existing authentication, unauthorized future schema expansion, or unverified critical behavior blocks completion.

---

# 73. Final Scope Freeze

## 02.4 owns

✅ Brevo  
✅ EmailService  
✅ OTP generation  
✅ OTP hashing  
✅ OTP delivery  
✅ Email verification  
✅ Password recovery  
✅ Password change  
✅ Approved security-sensitive customer account changes  
✅ Authentication transactional emails  
✅ Email delivery persistence  
✅ Brevo delivery webhook  
✅ Google OAuth foundation  
✅ Google authentication  
✅ Secure account linking  
✅ Required Prisma schema evolution  
✅ DEV seed updates  
✅ DEV migration  
✅ Production migration  
✅ Tests  
✅ Swagger  
✅ Security review  
✅ Browser/E2E verification  
✅ Documentation  
✅ CI/CD verification

## Later commerce phases own

⏭ Product expansion  
⏭ Product variants/specifications  
⏭ Cart evolution  
⏭ Orders  
⏭ Advanced order state machine  
⏭ Payments/Stripe  
⏭ Refunds  
⏭ Shipments  
⏭ Payment webhooks

## Later AI phase owns

⏭ Recommendation persistence  
⏭ AI interactions  
⏭ Behavioral events  
⏭ Recommendation results  
⏭ AI embeddings

## Later analytics phase owns

⏭ AnalyticsEvent  
⏭ Event aggregation  
⏭ Reporting  
⏭ Dashboards

---

# 74. Final Architecture Principle

ElectroHub should evolve as:

```text
02.4
AUTH + EMAIL SECURITY
        ↓
Later
COMMERCE
        ↓
Later
PAYMENTS
        ↓
Later
AI
        ↓
Later
ANALYTICS
```

not:

```text
02.4
AUTH
+ OTP
+ Stripe
+ Orders
+ AI
+ Analytics
+ every future table
```

The objective is a **clean, secure, migration-reviewable architecture** where each domain owns its persistence and workflows.

**Do not approve architectural shortcuts merely because they make the current feature faster to implement.**
