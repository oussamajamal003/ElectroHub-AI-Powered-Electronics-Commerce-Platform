# ElectroHub Task 02.2 — Latest Implemented Database Foundation

> This document is synchronized to the current Task 02.2 baseline. Prisma is the schema/migration source of truth. The implemented application model set is 15 models; `_prisma_migrations` is Prisma metadata.

## Environments

- Development: `electrohub-dev` — Supabase project ref `pzxekjybdiulzmssalfo`
- Production: Supabase project ref `yepfgjehdstlxbpespun`
- Development seed: allowed only on `electrohub-dev`
- Production development seed: forbidden

## Implemented Application Models

`Role`, `User`, `Address`, `Category`, `Product`, `ProductImage`, `Inventory`, `Cart`, `CartItem`, `Wishlist`, `WishlistItem`, `Order`, `OrderItem`, `Payment`, `Delivery`.

## Explicitly Out of Task 02.2 Core Schema

`RefreshToken`, `OTP`, `RecommendationEvent`, `RecommendationResult`, `UserBehavior`, `AuditLog`, `ShipmentHistory`, `StripeWebhookEvent`, `EmailDelivery`, `PDFDocument`, and other future feature-specific models unless separately approved.

## Authoritative Flow

```text
Task 02.2
   ↓
apps/backend/prisma/schema.prisma
   ↓
Prisma migration
   ↓
Supabase PostgreSQL
```

Do not use `supabase db push` as a competing migration source of truth.

# Migrations — Current Baseline

# Database Migrations

## 1. Purpose

This document defines the database migration strategy for ElectroHub.

Database schema changes are managed through:

```text
Prisma Schema
      ↓
Prisma Migration
      ↓
Supabase PostgreSQL
```

Migrations provide a versioned and reproducible history of database changes.

---

# 2. Migration Source of Truth

The intended database model is represented by:

```text
docs/06_Database/ERD.md
        ↓
prisma/schema.prisma
        ↓
prisma/migrations/
        ↓
Supabase PostgreSQL
```

All schema changes must be reflected consistently across these layers.

---

# 3. Migration Principles

Migrations must be:

- Version controlled.
- Reviewable.
- Reproducible.
- Tested.
- Forward-compatible where practical.
- Safe for the target environment.

A migration must never be treated as an unreviewed generated artifact.

---

# 4. Development Workflow

Typical development workflow:

```text
Modify Prisma Schema
        ↓
Review Schema
        ↓
Generate Migration
        ↓
Review SQL / Migration
        ↓
Apply Locally
        ↓
Run Tests
        ↓
Update Documentation
        ↓
Commit Schema + Migration
```

---

# 5. Creating a Migration

Conceptually:

```bash
npx prisma migrate dev --name descriptive_change
```

Migration names should describe the actual schema change.

Examples:

```text
add_product_inventory
add_order_payment
add_delivery_tracking
add_recommendation_relationships
```

---

# 6. Migration Files

Migration files belong under:

```text
prisma/migrations/
```

Each migration must remain committed to Git.

Never manually delete historical migrations from the repository simply because the current schema no longer needs them.

---

# 7. Migration Review

Before merging a migration, review:

```text
Tables
Columns
Constraints
Foreign Keys
Indexes
Unique Constraints
Defaults
Nullable Changes
Delete Behavior
Data Preservation
```

The reviewer must verify that the migration matches the intended architectural change.

---

# 8. Production Deployment

Production migrations should use the production-safe Prisma command:

```bash
npx prisma migrate deploy
```

Production must not use:

```bash
npx prisma migrate dev
```

Production schema changes must be executed through the controlled deployment workflow.

---

# 9. Migration Testing

Every migration should be tested against an appropriate development/test database.

Verify:

```text
Migration Applies
Migration Does Not Fail
Existing Data Is Preserved
Constraints Work
Indexes Exist
Application Starts
Queries Work
Tests Pass
```

---

# 10. Data-Preserving Changes

Changes involving existing data require additional care.

Examples:

```text
Adding Required Column
Renaming Column
Changing Data Type
Changing Nullability
Changing Relationship
Adding Unique Constraint
```

A direct destructive change may break existing records.

Where appropriate, use an expand-and-contract approach.

---

# 11. Expand-and-Contract

For risky schema changes:

```text
Phase 1
Add New Structure
        ↓
Phase 2
Support Old + New
        ↓
Phase 3
Migrate Existing Data
        ↓
Phase 4
Switch Application
        ↓
Phase 5
Remove Old Structure
```

This reduces deployment compatibility risks.

---

# 12. Adding Required Columns

When adding a non-nullable column to an existing populated table:

```text
Add Nullable / Default
        ↓
Populate Existing Rows
        ↓
Verify Data
        ↓
Enforce NOT NULL
```

Do not blindly add a required column without considering existing records.

---

# 13. Renaming Columns

Column renames must preserve existing data.

Avoid treating:

```text
Drop Old Column
+
Create New Column
```

as a simple rename when production data already exists.

The migration strategy must explicitly preserve or migrate existing values.

---

# 14. Changing Data Types

Data-type changes must verify:

```text
Existing Values
Precision
Range
Nullability
Application Compatibility
```

Financial fields require special care.

Money should use appropriate PostgreSQL/Prisma decimal representations.

---

# 15. Foreign Keys

Foreign-key migrations must verify existing data before adding constraints.

Example:

```text
orders.user_id → users.id
```

Existing orphan records must be resolved before the constraint is introduced.

---

# 16. Unique Constraints

Before adding a unique constraint:

```text
Detect Duplicates
        ↓
Resolve Duplicates
        ↓
Add Constraint
```

Do not assume existing production data already satisfies the new uniqueness rule.

---

# 17. Index Migrations

Indexes should be introduced when justified by query patterns.

Review:

```text
Index Purpose
Index Size
Query Benefit
Write Overhead
Deployment Impact
```

Large production index creation should be planned carefully.

---

# 18. Transactions

Where supported and appropriate, related schema/data changes should be executed safely.

However, database transactions do not make external operations atomic.

For example:

```text
PostgreSQL Migration
       ≠
Stripe Operation
       ≠
Brevo Email
```

External services require separate consistency strategies.

---

# 19. Rollback Strategy

Before applying risky production migrations, determine the recovery strategy.

Possible approaches:

```text
Backward-Compatible Migration
Restore Backup
Forward Fix Migration
Expand-and-Contract
```

A down migration should not be assumed to be safe simply because it can technically reverse the schema.

Data-destructive operations may not be reversible.

---

# 20. Backups

Production migrations must follow the backup/recovery policy documented in:

```text
docs/09_Operations/BACKUP_RECOVERY.md
```

Important migrations should have a verified recovery path before execution.

---

# 21. Migration and CI

CI should validate that:

```text
Prisma Schema Is Valid
Migrations Apply Successfully
Application Builds
Tests Pass
```

Where appropriate, CI should create a temporary database and apply migrations from scratch.

---

# 22. Migration and Deployment

The production deployment sequence should follow:

```text
Build
 ↓
Test
 ↓
Deploy Application
 ↓
Run Approved Migration
 ↓
Verify Application
 ↓
Monitor
```

The exact ordering must be compatible with the migration's backward-compatibility characteristics.

---

# 23. Migration Documentation

Significant schema changes should update:

```text
ERD.md
PRISMA_SCHEMA.md
TABLES.md
RELATIONSHIPS.md
INDEXING.md
```

An ADR should be added when the change represents a significant architectural decision.

---

# 24. Migration Naming

Migration names should be:

```text
Descriptive
Short
Specific
Lowercase / Prisma-Compatible
```

Example:

```text
add_delivery_tracking
add_order_documents
add_product_search_indexes
```

Avoid vague names such as:

```text
update_db
fix_schema
changes
```

---

# 25. Production Safety

Never execute destructive development commands against production.

Especially:

```bash
npx prisma migrate reset
npx prisma migrate dev
```

Production uses the controlled deployment process.

---

# 26. Migration Definition of Done

A database migration is complete when:

- Prisma schema is updated.
- Migration is generated.
- Migration is reviewed.
- Existing data impact is understood.
- Constraints are verified.
- Indexes are verified.
- Migration works on a clean database.
- Migration works against representative existing data.
- Application compatibility is verified.
- Tests pass.
- Relevant database documentation is updated.
- Production recovery strategy is understood.
- Migration is committed to version control.

---

# 27. Migration Principle

> **Database migrations are versioned production code: every schema change must be reviewable, tested, data-aware, and compatible with the application's deployment strategy.**
