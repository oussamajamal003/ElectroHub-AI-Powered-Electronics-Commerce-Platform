# ADR-003: Supabase PostgreSQL

- **Status:** Accepted
- **Date:** 2026-08-10

## Decision

ElectroHub will use **Supabase PostgreSQL** as its managed PostgreSQL database.

Prisma will provide database access from the Node.js backend.

## Context

The application requires a relational database for commerce data, including users, products, inventory, orders, payments, and delivery information.

The project should avoid managing a PostgreSQL server directly during development while still using a production-capable PostgreSQL database.

## Alternatives

### Self-managed PostgreSQL

PostgreSQL could be installed and maintained directly on the application server.

### Other managed PostgreSQL providers

A different managed PostgreSQL provider could be used.

### Supabase PostgreSQL

Supabase provides managed PostgreSQL infrastructure suitable for the project.

## Rationale

Supabase was selected because:

- It provides managed PostgreSQL.
- It reduces database-server administration.
- It works naturally with Prisma.
- It provides a practical development and deployment workflow.
- The database can remain separate from the DigitalOcean application VPS.

## Consequences

### Positive

- Managed PostgreSQL infrastructure.
- Reduced server administration.
- Clear separation between application hosting and database hosting.
- PostgreSQL remains the relational database technology.

### Trade-offs

- The project depends on an external managed service.
- Service availability and plan limitations must be considered.
- Database configuration is partly controlled by the provider.
- Recovery procedures must account for the managed environment.

## Architectural Rule

The application backend communicates with Supabase PostgreSQL through Prisma. The frontend must never connect directly to the production database.
