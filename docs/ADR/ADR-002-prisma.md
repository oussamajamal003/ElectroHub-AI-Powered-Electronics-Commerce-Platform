# ADR-002: Prisma ORM

- **Status:** Accepted
- **Date:** 2026-08-10

## Decision

ElectroHub will use **Prisma ORM** as the database access layer for the Node.js backend.

The primary database is PostgreSQL hosted by Supabase.

## Context

The backend requires reliable access to:

- Users.
- Products.
- Categories.
- Inventory.
- Carts.
- Wishlists.
- Orders.
- Payments.
- Delivery information.
- Administrative data.

The project also requires explicit database schema management and migrations.

## Alternatives

### Raw SQL

The backend could access PostgreSQL directly through SQL queries.

### Other ORMs

Alternatives include other Node.js ORM/database abstraction libraries.

### Prisma

Prisma provides a typed schema, generated client, migrations, and strong TypeScript integration.

## Rationale

Prisma was selected because:

- The backend uses TypeScript.
- Generated database types improve type safety.
- The Prisma schema provides a clear representation of the data model.
- Prisma migrations provide structured schema evolution.
- It integrates naturally with PostgreSQL.
- It reduces repetitive database-access code.

## Consequences

### Positive

- Strong TypeScript integration.
- Centralized schema definition.
- Structured migrations.
- Easier developer experience.
- Reduced risk of common query-typing mistakes.

### Trade-offs

- Prisma adds an abstraction layer over PostgreSQL.
- Some advanced database operations may require raw SQL.
- Prisma version changes must be managed carefully.
- Generated client code becomes part of the development workflow.

## Architectural Rule

Prisma is the standard database-access layer. Raw SQL should only be used when there is a justified requirement that Prisma cannot reasonably satisfy.
