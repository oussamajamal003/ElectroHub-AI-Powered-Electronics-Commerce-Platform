# Coding Standard

## 1. Purpose

This document defines the coding standards for ElectroHub.

The goal is to keep the codebase:

- Consistent.
- Readable.
- Maintainable.
- Testable.
- Secure.
- Reviewable.
- Scalable.

These standards apply to the frontend, backend, and AI service where relevant.

---

## 2. General Principles

Code should follow:

- Single Responsibility Principle.
- Separation of concerns.
- Clear ownership.
- Explicit dependencies.
- Small focused functions.
- Reusable abstractions where justified.
- Evidence-based optimization.

Avoid adding abstraction merely for theoretical reuse.

---

## 3. Naming

Use descriptive names.

Prefer:

```text
createOrder()
calculateTotal()
validateCheckout()
```

Avoid:

```text
doStuff()
processData()
handleThing()
```

Use consistent naming conventions:

```text
camelCase      variables and functions
PascalCase     classes, React components, types
UPPER_SNAKE_CASE constants where appropriate
kebab-case     file names where project convention requires it
```

Names should communicate intent rather than implementation details.

---

## 4. Functions

Functions should:

- Have one clear responsibility.
- Be reasonably small.
- Avoid excessive nesting.
- Avoid hidden side effects.
- Receive explicit dependencies.
- Return predictable results.

If a function requires extensive explanation, consider whether it should be split.

---

## 5. Components

React components should remain focused.

Prefer:

```text
Page
 ↓
Feature Component
 ↓
Reusable Component
```

Avoid large components containing:

- API calls.
- Complex business logic.
- Validation logic.
- Large styling blocks.
- Multiple unrelated responsibilities.

Business logic should live in appropriate hooks/services.

---

## 6. Backend Code

Backend code should follow:

```text
Route
 ↓
Controller
 ↓
Service
 ↓
Repository / Prisma
```

Controllers should not contain complex business logic.

Business rules belong in services.

Database access should be centralized through Prisma/repository patterns.

---

## 7. Error Handling

Errors must be handled intentionally.

Avoid try/catch blocks that silently ignore failures.

Errors should:

- Be logged where appropriate.
- Be converted into safe user-facing responses.
- Preserve useful diagnostic information internally.
- Avoid exposing secrets or stack traces.

---

## 8. Async Code

Use consistent asynchronous patterns.

Prefer:

```text
async / await
```

Avoid unnecessary promise nesting.

Handle rejected promises explicitly.

Do not create unhandled background promises.

---

## 9. Imports

Keep imports:

- Minimal.
- Organized.
- Free of unused dependencies.
- Consistent with project conventions.

Remove dead imports immediately.

Avoid importing internal implementation details from another service.

---

## 10. Comments

Comments should explain why, not simply repeat what the code does.

Good:

```text
// Keep this transaction atomic so inventory cannot be updated without the order.
```

Avoid:

```text
// Update inventory.
```

Remove obsolete comments.

Do not leave commented-out production code.

---

## 11. Configuration and Secrets

Do not scatter important configuration values throughout the codebase.

Prefer configuration, environment variables, and constants.

Never hardcode:

```text
API keys
JWT secrets
Database credentials
Stripe secrets
Brevo credentials
Cloudinary credentials
```

Never commit production secrets.

---

## 12. Security

Code must follow secure-by-default principles.

Required practices include:

- Validate untrusted input.
- Enforce authorization server-side.
- Never trust frontend state for security decisions.
- Avoid sensitive data in logs.
- Protect secrets.
- Use ORM/parameterized database access.
- Use HTTPS in production.

---

## 13. External Integrations

External services must be accessed through appropriate integration/service abstractions.

Examples:

```text
Stripe
Brevo
Cloudinary
FastAPI
```

Business logic should not become tightly coupled to provider-specific implementation details.

---

## 14. Database Code

Use Prisma for PostgreSQL access.

Database queries should:

- Be intentional.
- Select only required data where practical.
- Avoid N+1 patterns.
- Use pagination for large collections.
- Use transactions where business consistency requires them.

---

## 15. API Code

API responses should be consistent.

Endpoints should provide:

- Predictable status codes.
- Consistent response structures.
- Safe error messages.
- Request validation.
- Authentication/authorization where required.

Avoid exposing internal implementation details.

---

## 16. Frontend State

Separate:

```text
Server State
Local UI State
Form State
```

React Query manages server state.

React local state manages UI state.

React Hook Form manages form state.

Avoid duplicating the same state across multiple systems without a clear reason.

---

## 17. Styling

The frontend uses:

```text
SCSS
CSS Modules
```

Do not introduce:

```text
Tailwind CSS
shadcn/ui
Bootstrap
```

without an approved architectural decision.

Styles should follow the documented 7-1 SCSS architecture.

---

## 18. Accessibility

Code should support:

- Semantic HTML.
- Keyboard navigation.
- Focus management.
- Accessible names.
- Form labels.
- Screen-reader compatibility.
- Appropriate contrast.
- Reduced motion.

Accessibility should be considered during implementation rather than added only during final QA.

---

## 19. Performance

Avoid premature optimization.

Optimize when evidence shows a problem.

Consider:

- Efficient database queries.
- Pagination.
- Lazy loading.
- Code splitting.
- Image optimization.
- Avoiding unnecessary React renders.
- Efficient list rendering.
- Appropriate caching.

---

## 20. Testing

New behavior should have appropriate tests.

Testing levels include:

```text
Unit
Component
Integration
E2E
```

Critical business workflows require stronger coverage.

Examples:

```text
Authentication
Checkout
Payments
Orders
Inventory
Delivery
Admin Authorization
```

---

## 21. Dead Code

Do not leave:

- Unused files.
- Unused imports.
- Unused variables.
- Obsolete helpers.
- Debug code.
- Commented-out implementation.
- Temporary scripts.

Generated test artifacts should remain excluded from source control unless intentionally required.

---

## 22. Logging

Logs should provide useful operational information.

Never log:

```text
Passwords
JWT secrets
API keys
Payment secrets
Sensitive personal information
```

Remove temporary debugging logs before production.

---

## 23. Git and Review

Code should be reviewed before merging.

Pull requests should:

- Have a clear purpose.
- Include relevant tests.
- Avoid unrelated changes.
- Update documentation when required.
- Pass CI checks.

---

## 24. Definition of Quality

Code is production-ready when it is:

- Correct.
- Tested.
- Secure.
- Readable.
- Maintainable.
- Documented where necessary.
- Free from known critical defects.
- Consistent with the architecture.

---

## 25. Coding Principle

> **Prefer clear, explicit, maintainable code over clever or unnecessarily complex code.**
