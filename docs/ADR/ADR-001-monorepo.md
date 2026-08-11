# ADR-001: Monorepo Architecture

- **Status:** Accepted
- **Date:** 2026-08-10

## Decision

ElectroHub will use a **single monorepo** containing the frontend, backend, AI service, documentation, infrastructure configuration, and CI/CD configuration.

The primary application services are:

```text
apps/
├── frontend/
├── backend/
└── ai-service/
```

## Context

ElectroHub consists of multiple coordinated services:

- React/TypeScript frontend.
- Node.js/Express backend.
- FastAPI AI service.
- Shared project documentation.
- Docker and infrastructure configuration.
- GitHub Actions CI/CD.

These services are part of one product and need coordinated development, testing, and releases.

## Alternatives

### Separate repositories

Each service could be maintained in its own repository.

### Monorepo

All services could remain in one repository while preserving service boundaries.

## Rationale

A monorepo was selected because:

- All services belong to the same product.
- Cross-service changes are easier to coordinate.
- Architecture and documentation remain centralized.
- CI/CD can validate the complete system.
- Shared development conventions are easier to maintain.
- A single repository simplifies project management for the academic project.

The monorepo does **not** mean services may directly import each other's internal implementation.

## Consequences

### Positive

- Centralized source control.
- Easier cross-service changes.
- Unified documentation.
- Unified CI/CD.
- Easier project-wide code review.

### Trade-offs

- The repository can become larger over time.
- CI configuration must account for multiple services.
- Clear service boundaries are required.
- Poor organization could create unnecessary coupling.

## Architectural Rule

Services communicate through defined contracts and APIs rather than importing another service's internal source code.
