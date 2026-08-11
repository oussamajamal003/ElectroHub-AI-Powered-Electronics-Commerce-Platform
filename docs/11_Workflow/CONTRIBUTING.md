# Contributing

## 1. Purpose

This document defines how contributors work on ElectroHub.

All contributors are expected to follow the project's architecture, engineering standards, workflow, and security requirements.

---

# 2. Before Starting

Before beginning work:

```text
Read Project Vision
 ↓
Read Project Structure
 ↓
Read Relevant Architecture
 ↓
Read Relevant Feature Documentation
 ↓
Read Engineering Standards
 ↓
Read Task
```

Do not begin implementation without understanding the task scope.

---

# 3. Task-Based Development

All implementation work should correspond to a defined task.

A task should include:

```text
Objective
Scope
Requirements
Acceptance Criteria
Testing
Documentation
```

---

# 4. Branching

Create a focused branch:

```text
feature/<name>
fix/<name>
hotfix/<name>
```

Start from the correct current integration branch.

---

# 5. Development Standards

Contributors must follow:

```text
CODING_STANDARD.md
TYPESCRIPT_STANDARD.md
SCSS_STANDARD.md
COMPONENT_GUIDELINES.md
API_GUIDELINES.md
SECURITY_STANDARD.md
```

and all relevant architecture documentation.

---

# 6. Frontend Contributions

Frontend contributions must respect:

```text
Figma
Design System
SCSS Architecture
CSS Modules
Accessibility
Responsive Design
Component Guidelines
```

The project does not use:

```text
Tailwind CSS
shadcn/ui
Bootstrap
Material Design UI
```

---

# 7. Backend Contributions

Backend contributions must respect:

```text
API Contracts
Authentication
Authorization
Validation
Business Logic
Prisma
Error Handling
Logging
Security
```

The backend owns commerce business logic.

---

# 8. AI Contributions

AI contributions must preserve the boundary:

```text
Backend
 ↓
FastAPI
 ↓
AI Processing
 ↓
Validated Result
 ↓
Backend
```

AI output must not bypass authorization, pricing, inventory, payment, or order rules.

---

# 9. Database Contributions

Database changes must:

- Use Prisma.
- Include appropriate migrations.
- Consider relationships.
- Consider indexes.
- Preserve data integrity.
- Be tested before merge.

---

# 10. External Services

External integrations include:

```text
Supabase
Stripe
Brevo
Cloudinary
DigitalOcean
```

Credentials must never be committed.

Stripe remains in Test Mode for development and demonstration.

---

# 11. Testing

Contributors must add or update appropriate tests.

Possible levels:

```text
Unit
Integration
E2E
Accessibility
Performance
```

Testing should focus on actual behavior and important failure cases.

---

# 12. Error Handling

New functionality must define appropriate:

```text
Loading
Success
Failure
Empty
Unauthorized
Forbidden
Not Found
Validation
```

states where applicable.

---

# 13. Security

Contributors must:

- Validate external input.
- Enforce authorization server-side.
- Protect secrets.
- Avoid sensitive logging.
- Protect customer data.
- Validate uploads.
- Protect payment and document access.

---

# 14. Documentation

Update documentation when the implementation changes:

```text
Architecture
Features
Database
AI
Security
Deployment
Workflow
ADR
Changelog
```

Do not leave documentation knowingly inconsistent with implementation.

---

# 15. Pull Requests

Pull requests should clearly explain:

```text
What Changed
Why
How It Was Tested
Architecture Impact
Known Limitations
```

Include relevant evidence.

---

# 16. Code Review

All changes are subject to code review.

Reviewers may request changes for:

```text
Bugs
Security
Architecture
Testing
Performance
Maintainability
Documentation
```

Contributors should resolve review findings before merge.

---

# 17. Dependencies

Before adding a dependency:

```text
Check Existing Stack
 ↓
Evaluate Necessity
 ↓
Check Security
 ↓
Check Maintenance
 ↓
Check License
 ↓
Check Performance
```

Significant dependencies may require an ADR.

---

# 18. Commit Standards

Use clear commits such as:

```text
feat: add image search
fix: prevent duplicate orders
docs: update deployment architecture
test: add checkout integration tests
refactor: simplify product service
```

Avoid unrelated changes in one commit.

---

# 19. Definition of Done

Before marking work complete:

- [ ] Requirements implemented.
- [ ] Acceptance criteria satisfied.
- [ ] Tests pass.
- [ ] Security reviewed.
- [ ] Documentation updated.
- [ ] Code review complete.
- [ ] CI passes.
- [ ] No unresolved critical issues.

---

# 20. Prohibited Practices

Do not:

- Commit secrets.
- Bypass authentication.
- Trust client-controlled business values.
- Directly modify production data without authorization.
- Merge failed CI.
- Ignore critical review findings.
- Introduce unapproved architectural changes.
- Claim completion without evidence.

---

# 21. Getting Help

When blocked:

```text
Describe Problem
 ↓
Provide Error / Evidence
 ↓
Identify What Was Tried
 ↓
Ask for Specific Guidance
```

Do not hide failures or silently work around architectural constraints.

---

# 22. Contribution Principle

> **Contributions should improve the system while preserving its architecture, security, quality, and long-term maintainability.**
