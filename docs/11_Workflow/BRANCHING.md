# Branching

## 1. Purpose

This document defines the branch structure and branch-management rules for ElectroHub.

---

# 2. Branch Model

The project uses:

```text
main
develop
feature/*
fix/*
hotfix/*
```

---

# 3. main

`main` represents production-ready code.

Requirements:

- Production-ready changes only.
- Protected branch.
- No direct unreviewed changes.
- Required CI checks must pass.

---

# 4. develop

`develop` is the primary integration branch for completed development work.

Feature and fix branches normally target:

```text
develop
```

---

# 5. Feature Branches

Feature branches are created for new functionality.

Examples:

```text
feature/authentication
feature/product-catalog
feature/image-search
feature/recommendations
feature/checkout
feature/payment-receipts
feature/order-invoices
feature/delivery-tracking
```

A feature branch should represent one coherent task or feature.

---

# 6. Fix Branches

Use `fix/*` for normal bugs that are discovered during development.

Examples:

```text
fix/cart-calculation
fix/search-pagination
fix/otp-expiration
fix/order-status
```

---

# 7. Hotfix Branches

Use `hotfix/*` for urgent production issues.

Examples:

```text
hotfix/payment-failure
hotfix/authentication-bypass
hotfix/production-crash
```

Hotfixes require expedited but still documented review and testing.

---

# 8. Branch Creation

Start from the current integration branch:

```bash
git fetch origin
git switch develop
git pull origin develop
git switch -c feature/<name>
```

---

# 9. Keeping Branches Updated

Long-running branches should periodically incorporate current `develop`.

Before updating:

```bash
git fetch origin
```

Then use the project's approved integration approach.

The resulting branch must pass all relevant tests.

---

# 10. Branch Scope

Avoid combining unrelated work.

Bad:

```text
feature/store
```

containing:

```text
Authentication
Payment
AI
Deployment
```

Prefer separate focused branches.

---

# 11. Branch Naming Rules

Use:

```text
<type>/<short-description>
```

Types:

```text
feature
fix
hotfix
```

Use lowercase and hyphens.

---

# 12. Pull Request Targets

Normal development:

```text
feature/* → develop
fix/* → develop
```

Production release:

```text
develop → main
```

Urgent production fixes follow the approved hotfix/release process.

---

# 13. Branch Protection

Protected branches should require:

```text
Pull Request
Required CI
Code Review
```

Direct pushes should be restricted.

---

# 14. Stale Branches

After a branch is merged, it should be deleted when no longer required.

This keeps the repository manageable.

---

# 15. Definition of Done

Branching is compliant when:

- [ ] Correct branch type is used.
- [ ] Branch name is descriptive.
- [ ] Work is focused.
- [ ] Branch is based on the correct source branch.
- [ ] Required checks pass.
- [ ] PR targets the correct branch.
- [ ] Merged branches are cleaned up.

---

# 16. Branching Principle

> **Branches isolate focused work while protected integration branches preserve stable, reviewable project states.**
