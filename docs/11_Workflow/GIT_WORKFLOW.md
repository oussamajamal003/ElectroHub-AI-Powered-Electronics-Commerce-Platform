# Git Workflow

## 1. Purpose

This document defines the Git workflow for ElectroHub.

The workflow is designed to provide:

```text
Traceability
Code Review
Controlled Integration
Clean History
Release Safety
```

---

# 2. Repository Model

ElectroHub uses a single monorepo.

```text
electrohub/
├── apps/
├── docs/
├── infrastructure/
└── .github/
```

All application services are maintained in the same repository.

---

# 3. Main Branches

The project uses:

```text
main
develop
feature/*
fix/*
hotfix/*
```

## main

Contains production-ready code.

## develop

Contains integrated development work that has passed the required checks.

## feature/*

Used for new functionality.

## fix/*

Used for non-production bug fixes.

## hotfix/*

Used for urgent production fixes.

---

# 4. Basic Workflow

```text
Create Branch
 ↓
Implement
 ↓
Test
 ↓
Commit
 ↓
Push
 ↓
Open Pull Request
 ↓
CI
 ↓
Code Review
 ↓
Merge
```

---

# 5. Pull Before Starting

Before beginning work:

```bash
git fetch origin
git switch develop
git pull origin develop
```

Create the task branch from the current development branch.

---

# 6. Branch Naming

Use descriptive names.

Examples:

```text
feature/product-search
feature/image-search
feature/payment-receipts
feature/order-invoices
fix/cart-total
fix/otp-validation
hotfix/payment-webhook
```

Avoid vague names such as:

```text
test
new
changes
update
stuff
```

---

# 7. Commits

Commits should represent coherent changes.

Prefer:

```text
feat: add product search filters
fix: prevent duplicate order creation
docs: update payment architecture
test: add checkout integration tests
refactor: simplify order service
```

Avoid mixing unrelated changes in one commit.

---

# 8. Commit Quality

A good commit should be:

- Focused.
- Descriptive.
- Buildable where practical.
- Easy to review.
- Easy to revert.

---

# 9. Push

Push the task branch to the remote repository:

```bash
git push -u origin <branch-name>
```

Do not force-push shared branches.

---

# 10. Pull Requests

All changes intended for integration must go through the project's pull-request process.

A PR should include:

```text
Purpose
Scope
Implementation
Testing
Documentation
Known Limitations
```

---

# 11. CI

CI should validate relevant changes:

```text
Lint
Type Check
Unit Tests
Integration Tests
Build
```

Critical E2E tests should be completed before release.

---

# 12. Merge Rules

Do not merge work that:

- Fails required CI checks.
- Has unresolved critical review comments.
- Introduces known security issues.
- Does not satisfy acceptance criteria.
- Has insufficient testing evidence.

---

# 13. Conflict Resolution

When conflicts occur:

```text
Fetch Latest Changes
 ↓
Understand Both Changes
 ↓
Resolve Conflict
 ↓
Run Tests
 ↓
Review Result
 ↓
Push Updated Branch
```

Do not resolve conflicts by blindly accepting one side.

---

# 14. Protected Branches

Production branches should be protected against:

```text
Direct Unreviewed Pushes
Failed Required Checks
Unreviewed Changes
```

---

# 15. Documentation Changes

Changes that affect architecture or engineering behavior must update the relevant documentation.

Examples:

```text
Architecture
Features
Database
Security
Deployment
Workflow
ADR
```

---

# 16. Definition of Done

Git work is complete when:

- [ ] Branch follows naming conventions.
- [ ] Changes are focused.
- [ ] Tests pass.
- [ ] Documentation is updated where required.
- [ ] PR is reviewed.
- [ ] CI passes.
- [ ] Required approval is obtained.
- [ ] Changes are merged through the approved workflow.

---

# 17. Git Principle

> **Git history should make it possible to understand what changed, why it changed, and how the change was verified.**
