# Dependencies

## 1. Purpose

This document defines the operational dependency-management policy for ElectroHub.

Dependency management covers:

```text
Frontend Dependencies
Backend Dependencies
AI Service Dependencies
Docker Base Images
GitHub Actions
Infrastructure Components
```

The objective is to keep dependencies secure, reproducible, maintainable, and compatible with the project architecture.

---

# 2. Dependency Sources

Primary dependency ecosystems include:

```text
npm
Node.js
Python / pip
Docker Images
GitHub Actions
```

Dependencies should come from trusted and well-maintained sources.

---

# 3. Frontend Dependencies

The frontend stack includes:

```text
React
TypeScript
Vite
SCSS
CSS Modules
Framer Motion
React Query
React Router
React Hook Form
Zod
Radix UI
Lucide React
TanStack Table
Leaflet
Socket.IO Client
```

Dependencies must serve an identified project requirement.

Avoid adding libraries when the same functionality can be implemented cleanly with the existing stack.

---

# 4. Backend Dependencies

The backend stack includes:

```text
Node.js
Express.js
Prisma
JWT
Socket.IO
Stripe
Brevo Integration
Cloudinary Integration
PDF Generation
```

Backend dependencies must respect the service's security and architecture boundaries.

---

# 5. AI Service Dependencies

The AI service uses:

```text
Python
FastAPI
```

Additional ML or image-processing dependencies may be introduced when required by the approved AI implementation.

Each AI dependency should be evaluated for:

```text
Compatibility
Resource Usage
Security
License
Maintenance
Container Size
```

---

# 6. Version Management

Dependency versions must be controlled through committed lockfiles.

Examples:

```text
package-lock.json
```

and the appropriate Python dependency lock/constraint mechanism where used.

Do not rely on uncontrolled floating dependency versions in production.

---

# 7. Adding a Dependency

Before adding a dependency, evaluate:

1. Why is it required?
2. Is the functionality already available?
3. Is it actively maintained?
4. Is it compatible with the project stack?
5. Does it introduce security risk?
6. Does it increase bundle or container size significantly?
7. Does it create architectural coupling?
8. Is its license acceptable?
9. Is it required in production or only development?

---

# 8. Dependency Approval

Important or architectural dependencies should be reviewed before adoption.

Examples:

```text
Database Libraries
Authentication Libraries
Payment Libraries
AI Frameworks
UI Libraries
Infrastructure Libraries
```

Significant architectural dependency decisions should be recorded in an ADR.

---

# 9. Security Updates

Dependencies must be checked for known vulnerabilities.

Security updates should be prioritized according to severity:

```text
Critical
High
Medium
Low
```

Critical vulnerabilities require immediate investigation.

---

# 10. Dependency Updates

Dependency updates should follow:

```text
Identify Update
 ↓
Review Changelog
 ↓
Check Breaking Changes
 ↓
Update
 ↓
Run Tests
 ↓
Build
 ↓
Review
 ↓
Merge
```

Do not update large numbers of unrelated dependencies blindly.

---

# 11. Major Version Updates

Major updates require additional review because they may introduce breaking changes.

Before a major update:

```text
Read Migration Guide
 ↓
Identify Breaking Changes
 ↓
Update Code
 ↓
Run Unit Tests
 ↓
Run Integration Tests
 ↓
Run E2E Tests
 ↓
Review Performance
```

---

# 12. Lockfiles

Lockfiles must be committed.

Lockfiles provide:

```text
Reproducible Installs
Deterministic Dependency Resolution
CI Consistency
Production Consistency
```

Do not manually edit lockfiles unless there is a specific reason and the package manager can validate the result.

---

# 13. Transitive Dependencies

Direct dependencies can introduce transitive dependencies.

Security reviews should therefore consider the complete dependency tree.

Use the appropriate package-manager audit tooling to identify vulnerable transitive packages.

---

# 14. npm Dependency Security

For Node.js projects:

```text
npm audit
```

may be used as part of dependency security review.

Audit results must be evaluated rather than blindly applying automatic fixes, because automatic fixes may introduce breaking changes.

---

# 15. Python Dependency Security

Python dependencies should be reviewed using appropriate dependency and vulnerability-scanning tools.

The project should maintain a reproducible Python dependency set for the FastAPI service.

---

# 16. Docker Base Images

Docker base images are dependencies and must also be maintained.

Review:

```text
Base Image Version
OS Vulnerabilities
Runtime Version
Image Size
Support Lifecycle
```

Production images should use maintained base images.

---

# 17. GitHub Actions Dependencies

Third-party GitHub Actions should be reviewed before use.

Where practical, actions should be pinned to stable versions or commit references according to the project's security policy.

Avoid adding unnecessary actions.

---

# 18. Development vs Production Dependencies

Dependencies should be classified appropriately.

```text
Production Dependency
Development Dependency
Testing Dependency
Build Dependency
```

Development-only packages should not unnecessarily increase production images.

---

# 19. Dependency Removal

Unused dependencies should be removed.

Before removal:

```text
Search Usage
 ↓
Remove Dependency
 ↓
Update Lockfile
 ↓
Run Tests
 ↓
Build
```

Removing unused packages reduces:

```text
Bundle Size
Attack Surface
Maintenance Cost
```

---

# 20. Compatibility

Before updating a dependency, verify compatibility with:

```text
Node.js Version
Python Version
TypeScript
React
Vite
Prisma
FastAPI
Docker
```

The dependency must remain compatible with the approved project stack.

---

# 21. Performance Impact

Dependency changes should consider:

```text
Frontend Bundle Size
Build Time
Runtime Memory
Container Size
Startup Time
AI Resource Usage
```

A dependency that adds significant overhead requires justification.

---

# 22. License Review

Dependencies should use licenses compatible with the project's intended use.

Unclear or incompatible licensing must be reviewed before adoption.

---

# 23. Dependency Monitoring

The project should periodically review:

```text
Security Advisories
Outdated Packages
Deprecated Packages
Runtime Support
Docker Base Images
GitHub Actions
```

The goal is proactive maintenance rather than waiting for production failures.

---

# 24. CI Dependency Checks

CI should verify dependency integrity and security where configured.

Typical checks include:

```text
Install from Lockfile
Audit / Vulnerability Scan
Build
Tests
```

A dependency vulnerability must be assessed based on actual exploitability and project impact.

---

# 25. Emergency Security Update

For a critical vulnerability:

```text
Identify Vulnerability
 ↓
Assess Exposure
 ↓
Select Safe Version
 ↓
Update
 ↓
Run Critical Tests
 ↓
Deploy Fix
 ↓
Verify
```

The update should be documented.

---

# 26. Dependency Documentation

Important dependencies should be represented in:

```text
TECH_STACK.md
DEPENDENCIES.md
ADR/
```

when they materially affect the architecture.

---

# 27. Dependency and Release Process

A dependency update that changes behavior must pass the normal engineering workflow:

```text
Task
 ↓
Implementation
 ↓
Tests
 ↓
Code Review
 ↓
CI
 ↓
Release
```

Security emergencies may use an expedited process while retaining verification evidence.

---

# 28. Definition of Done

Dependency management is complete when:

- Dependency versions are controlled.
- Lockfiles are committed.
- Security advisories are reviewed.
- Major updates are evaluated for breaking changes.
- Unused dependencies are removed.
- Production dependencies are separated from development dependencies.
- Docker base images are maintained.
- GitHub Actions dependencies are reviewed.
- Important dependency decisions are documented.
- Dependency-related CI checks pass.

---

# 29. Dependency Principle

> **Every dependency is part of the system's attack surface, maintenance burden, and runtime environment; dependencies should therefore be intentional, controlled, reviewed, and kept reproducible.**
