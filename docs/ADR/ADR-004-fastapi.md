# ADR-004: FastAPI AI Service

- **Status:** Accepted
- **Date:** 2026-08-10

## Decision

ElectroHub will isolate AI functionality in a dedicated **FastAPI service** implemented in Python.

The Node.js backend communicates with the AI service through defined API contracts.

## Context

ElectroHub includes AI-related capabilities such as:

- Image-based product discovery.
- Recommendation processing.
- AI-specific image/model processing.

These workloads have different runtime and dependency requirements from the commerce backend.

## Alternatives

### Implement AI inside the Node.js backend

AI logic could be implemented directly within the main backend.

### Separate Node.js AI service

AI functionality could be placed in a separate Node.js service.

### FastAPI service

AI functionality can be isolated in a Python/FastAPI service.

## Rationale

FastAPI was selected because:

- Python provides a strong ecosystem for AI and image-processing workloads.
- FastAPI provides a lightweight HTTP API framework.
- AI dependencies remain isolated from the Node.js commerce backend.
- The architecture allows the AI service to evolve independently.
- The backend remains the owner of commerce business rules.

## Consequences

### Positive

- Clear separation between AI and commerce logic.
- Access to Python AI tooling.
- Independent AI service lifecycle.
- Easier future model replacement or expansion.

### Trade-offs

- There is an additional service to develop and deploy.
- Inter-service communication introduces network and failure boundaries.
- Python dependencies require separate management.
- AI resource usage must be controlled.

## Architectural Rule

The AI service must not own core commerce business logic.

The backend remains authoritative for:

```text
Authorization
Pricing
Inventory
Payment State
Order State
```

AI output must be validated by the backend before affecting application behavior.
