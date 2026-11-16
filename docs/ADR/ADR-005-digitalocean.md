# ADR-005: DigitalOcean Production VPS

- **Status:** Accepted
- **Date:** 2026-08-10

## Decision

ElectroHub will use a **DigitalOcean Cloud VPS** as the planned production application server.

The server will run Ubuntu and host the Dockerized application services behind Nginx and HTTPS.

## Context

The completed application requires a production environment capable of running:

```text
Frontend
Backend
AI Service
Docker
Nginx
SSL
```

The production server is intentionally deferred until the final project phase.

## Alternatives

### Local-only deployment

The project could remain local and never use a production server.

### Other cloud VPS providers

Other VPS providers could host the application.

### Platform-as-a-Service

A managed application platform could host the services.

### DigitalOcean VPS

A relatively simple cloud VPS provides direct control over the application runtime.

## Rationale

DigitalOcean was selected because:

- It provides a straightforward VPS environment.
- Ubuntu and Docker can run the complete application stack.
- Nginx can serve as the reverse proxy and TLS termination point.
- The infrastructure is appropriate for a student portfolio/academic project.
- The server can be provisioned only during the final deployment phase.

## Consequences

### Positive

- Full control over the application runtime.
- Supports Docker-based deployment.
- Supports Nginx and SSL.
- Suitable for hosting multiple services on one server.
- Deployment can be automated through GitHub Actions.

### Trade-offs

- Server administration becomes the project's responsibility.
- Resource limits must be monitored.
- Security updates and firewall configuration must be maintained.
- AI workloads may compete for VPS resources.
- Production hosting introduces an ongoing infrastructure cost.

## Architectural Rule

Production services run in Docker on the DigitalOcean VPS. Internal services should not be unnecessarily exposed to the public internet.
