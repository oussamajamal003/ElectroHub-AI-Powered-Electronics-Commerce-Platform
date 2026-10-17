# ElectroHub — Agent Coordination & Integration Protocol

> **Status:** Effective policy. 
> **Applies to:** Codex, Claude Code, ChatGPT, other AI agents, and human developers.  
> **Authority:** Project Owner → Principal Architect → Workstream Owner → Agent.  
> **Principle:** Parallelize independent coding; serialize shared-state changes, integration, and release.

## 1. Mandatory rules

1. Each agent must have an assigned task, owner, and clearly defined file ownership and scope.
2. Only one agent owns a protected shared file at a time.
3. Never modify another workstream's protected files without a Cross-Workstream Change Request (CCR).
4. No unapproved remote DB mutations, migrations, real Stripe operations, live auth-session mutations, worker runs, CI triggers, commits, pushes, merges, or deployments.
5. Offline tests, typechecks, lint, builds, and source edits are allowed within assigned scope.
6. Tests and claims require reproducible evidence. Mock tests do not prove live PostgreSQL or Stripe behavior.
7. Preserve security, payment idempotency, backward compatibility, and customer data.
8. Stop on unexpected uncommitted changes, ambiguous scope, or unsafe infrastructure access.
9. No agent may declare a task merged or deployed without verification.
10. **Implementation-complete ≠ approved ≠ integrated ≠ released.**

## 2. Workstream ownership

| Workstream | Responsibilities | Shared dependencies |
|---|---|---|
| AUTH | Refresh rotation, logout, sessions, cookies, password reset, middleware | Refresh-token schema, API auth contracts |
| PAYMENT | PaymentAttempt, PaymentWork, Order, Stripe, webhooks, reconciliation | DB transactions, cart ownership, auth |
| FRONTEND | Cart, Stripe Elements, checkout, skeletons, payment recovery | API contracts, auth hydration, payment states |
| PERFORMANCE | Query latency, Prisma relation strategies, profiling | Prisma Client, DB pool, transactions |
| DATABASE | Prisma schema, migrations, indexes, connection roles | All backend workstreams |
| OBSERVABILITY | Logs, request IDs, metrics, error reporting | Middleware, error handlers, redaction |
| INTEGRATION | Architectural review, branch integration, regression gates | All workstreams |

**Protected hotspots:** `schema.prisma`, Prisma generator/client, auth middleware/repository, shared API interceptors, payment services, CartProvider, checkout/recovery state, connection pools, transaction settings. Verify actual paths in Git; do not infer them from this policy.

### Task registry

Every active task records: `task_id`, `workstream`, `owner`, `base_sha`, `owned_files`, `protected_files_requested`, `dependencies`, `status`, `approval_reference`, `last_updated`.

Statuses: `PLANNED → ACTIVE → BLOCKED / REVIEW_READY → APPROVED / CHANGES_REQUESTED → INTEGRATED → RELEASED`.

## 3. Shared workspace coordination

Agents may operate in the existing project workspace. Before editing, check the current file state, active ownership, and any uncommitted changes. Coordinate changes to shared files through the approval matrix below.

Do not overwrite another agent's edits, run destructive resets, or apply broad formatting unrelated to the assigned task.

At handoff report the current revision, working-tree status, changed files, tests, and outstanding approvals.

## 4. Protected change approval matrix

| Change | Required reviewers | Extra gate |
|---|---|---|
| Prisma schema, generator, version | DATABASE + affected owners + Architect | Regeneration coordination and broad regressions |
| Migration SQL / indexes / constraints | DATABASE + Architect | Separate environment execution approval |
| Refresh tokens, cookies, auth middleware | AUTH + Architect | Security concurrency tests |
| Payment states, services, webhooks | PAYMENT + Architect | Idempotency/state-machine tests |
| Shared API types and interceptors | All affected consumers + Architect | Compatibility tests |
| Connection pools, isolation, timeouts | DATABASE + AUTH + PAYMENT + PERFORMANCE + Architect | Load/concurrency evidence |
| Logging middleware and redaction | OBSERVABILITY + affected owners | Sensitive-data audit |
| CI, secrets, deployment | Architect + Owner | Explicit operational approval |

Approval to **edit code** never authorizes **running it against DEV/PROD**.

### Cross-Workstream Change Request (CCR)

```text
CCR ID:
REQUESTING WORKSTREAM / TASK:
AFFECTED OWNERS:
PROTECTED FILES / CONTRACTS:
PROBLEM AND EVIDENCE:
PROPOSED CHANGE:
SECURITY / PAYMENT / API / DB IMPACT:
COMPATIBILITY AND MIGRATION PLAN:
TEST PLAN AND ROLLBACK:
REQUIRED APPROVAL:
```

Stop before protected edits → submit CCR → obtain approval → update task registry → implement within approved file scope.

## 5. Prisma and database governance

### Schema and generated client

- One coordinated generator/schema change is integrated at a time.
- Record pinned Prisma CLI/client versions and exact schema diff.
- Coordinate Prisma Client regeneration with affected agents; never overwrite another agent's artifacts.
- Do not edit generated files manually.
- `relationJoins` can change relation-loading defaults globally. Inventory auth, payment, order, inventory, and cart queries; explicitly select `relationLoadStrategy` where needed.
- Verify response shape, SQL round trips, query plans, typecheck, build, and regressions.
- Keep performance optimization separate from authentication security migrations.

### Migrations

1. Prepare offline by default.
2. Review locks, index-build strategy, table size, backfills, constraints, legacy sessions, mixed-version rollout, and rollback.
3. Prefer **expand → dual-write/read if needed → backfill → switch → contract**.
4. Do not call PostgreSQL `ALTER TABLE` or ordinary `CREATE INDEX` lock-free.
5. Coordinate migration names/order across workstreams.
6. Remote migrations, schema pushes, fixtures, seeds, cleanup, and writes require explicit owner approval.
7. Dropping populated lineage columns loses lineage data; rollback must acknowledge this.
8. Local disposable PostgreSQL tests do not replace DEV acceptance.

### Concurrency

Document isolation, lock order, transaction timeout, pool budget, retries, and idempotency. Test exact interleavings using barriers, not only sleeps. Cover post-commit failures, restarts, and multi-instance behavior.

**Transaction-scoped advisory locks end at commit. Publishing process-local lineage after commit is not atomic with that transaction.**

## 6. Authentication invariants

- Refresh, logout, password reset/change, and global revocation must use a provably safe synchronization protocol.
- Successful logout must meet its documented descendant-session revocation guarantee.
- Do not depend on process-local lineage for correctness across commits, restarts, or instances.
- Do not leak tokens in logs or weaken auth to remove frontend loading delays.
- Prevent auth-refresh loops; use deliberate 401/403/5xx handling.
- Preserve secure cookie semantics and replay detection.

**Open gate:** Persistent refresh-token lineage migration is proposed, not deployed or production-proven; commit-to-publication safety still requires proof.

## 7. Payment and checkout invariants

- Submitted PaymentAttempt is an immutable snapshot.
- Payment A must never hijack Cart B or Checkout B, even for the same SKU or Buy Now.
- Preserve PaymentAttempt, PaymentWork, Order, Stripe identifiers, and idempotency relationships.
- `PAID` and `DECLINED` require authoritative evidence; `UNKNOWN` remains recoverable.
- Webhook, polling, and reconciliation must handle duplication, reordering, and retries.
- Timeout or HTTP 500 must not automatically trigger a duplicate charge.
- Preserve CheckoutProcessing UI, saved purchases, recovery, and accessibility.

**Open gate:** Checkout setup 500 and slow recovery need correlated backend evidence; cart benchmarks alone do not prove payment correctness.

## 8. Performance and loading states

For every optimization measure before/after SQL round trips, warm/cold connection time, p50/p95, failure rate, transaction duration, and DB resource impact when available. Use comparable data and sufficient samples.

Verify API response equivalence and UI completion for success, failure, cancellation, timeout, and genuinely unknown payment outcomes. Avoid hidden retries, blanket timeout increases, and unreviewed global Prisma switches.

## 9. Observability

Use UTC structured logs and correlation IDs. Log sanitized operations, durations, transitions, errors, and retry counts. Never log raw JWTs, refresh tokens, cookies, authorization headers, Stripe client secrets, card data, or sensitive personal data.

If the proposed logging policy is adopted:

| Log | Rotation | Archive retention |
|---|---|---|
| `app.log` | 20 MiB or UTC midnight | 14 days / 500 MiB |
| `error.log` | 20 MiB or UTC midnight | 30 days / 1 GiB |

Require safe append, cleanup, graceful flush, and sanitized fallback. For ephemeral cloud environments prefer centralized structured stdout/stderr.

## 10. Environment and execution safety

| Operation | Offline/local | DEV | PROD |
|---|---|---|---|
| Source review, mock tests, lint, builds | Within task scope | N/A | N/A |
| Read-only diagnostics | With appropriate access | Authorized scope/credentials | Explicit approval |
| Migrations, fixtures, DB writes | Specific authorization | **Explicit owner approval** | **Separate PROD approval** |
| Real Stripe / live session mutation | Not by default | **Explicit owner approval** | **Separate PROD approval** |
| Commits, pushes, CI, merges, deploys | Task-specific authorization | Task-specific authorization | Separate release approval |

Known references, verify before use:

- DEV: `electrohub-dev`, project `pzxekjybdiulzmssalfo`, `ap-northeast-2`.
- PROD: `electrohub`, project `yepfgjehdstlxbpespun`, `ap-northeast-1`.

A project reference or existing credential is **not permission**.

The payment PostgreSQL A–J suite has separate DEV-only isolation, capacity, observer, and owner-approval requirements. This policy does not authorize running it, starting global workers, or replaying historical PaymentWork.

## 11. Start-of-task declaration

```text
TASK ID / WORKSTREAM / OWNER:
GOAL AND ACCEPTANCE CRITERIA:
BASE SHA / CURRENT REVISION:
EXPECTED CHANGED FILES:
PROTECTED FILES AND CCRS:
DEPENDENCIES / API / DB CONTRACTS:
TEST AND BENCHMARK PLAN:
OPERATIONAL ACTIONS REQUESTED:
EXPLICIT OUT-OF-SCOPE FILES:
```

## 12. Integration and merge gates

**Parallel implementation; serialized integration.**

1. **Scope:** No unexplained files or unauthorized edits.
2. **Source review:** Architect inspects actual diff, not merely the implementation summary.
3. **Security:** Auth, tokens, authorization, secrets, replay, races, payment idempotency.
4. **Architecture:** API compatibility, Prisma/migrations, transaction contracts, mixed-version behavior.
5. **Quality:** Targeted tests, typechecks, lint, builds, `git diff --check`, relevant browser/visual tests.
6. **Combined regression:** Test the integrated branch, not only individual agent branches.
7. **Runtime:** DEV/real PostgreSQL/Stripe verification only with separate authorization; otherwise mark NOT VERIFIED.
8. **Documentation:** API docs, migrations, architecture notes, runbooks, task status.
9. **Release:** Owner approves exact commits, environment, commands, monitoring, and rollback.

### Scoring /100

| Category | Points |
|---|---:|
| Correctness and requirements | 20 |
| Security | 20 |
| Architecture and compatibility | 15 |
| Concurrency and database safety | 15 |
| Tests and evidence | 15 |
| Performance and reliability | 10 |
| Documentation and operations | 5 |

**Verdicts:** ✅ APPROVE only when all mandatory gates for the stated scope pass; ⚠ REQUEST CHANGES for fixable defects or missing required evidence (no merge); ❌ REJECT for fundamental unsafe design, contract violation, or unauthorized action.

**Unresolved P0/P1 blocks merge regardless of score. Approval never implies deployment authorization.**

## 13. Conflict resolution

1. Freeze conflicting edits and preserve all affected changes.
2. Identify authoritative shared-interface owner.
3. Approve a focused compatibility-preserving shared change.
4. Integrate that change first.
5. Rebase dependent branches and rerun combined regressions.
6. Never blindly choose one side of a merge conflict.

### Current suggested integration order

1. Prove auth refresh/logout invariants; prepare durable lineage offline.
2. Review Prisma generator/performance changes with AUTH/PAYMENT owners.
3. Integrate measured read-path improvements without changing financial semantics.
4. Integrate payment lifecycle and frontend loading against stable contracts.
5. Request separate DEV runtime/concurrency authorization after readiness gates.

This sequence does not authorize remote mutations.

## 14. Stop-work triggers

Stop on protected-file conflicts, unapproved remote writes, incorrect environment identity, secret exposure, financial/auth invariants failing, pool/lock exhaustion, unexpected generated output, unexpected uncommitted changes, or tests weakened to pass.

```text
STOPPED — APPROVAL REQUIRED
TASK / WORKSTREAM:
EXACT BLOCKER:
EVIDENCE (file:line / request ID / command output):
RISK IF CONTINUED:
SAFE OPTIONS:
OWNER DECISION REQUESTED:
ACTIONS NOT PERFORMED:
```

## 15. Completion report template

```text
TASK / WORKSTREAM / OWNER:
BASE SHA / CURRENT REVISION:
IMPLEMENTATION SUMMARY:
CHANGED FILES (EXACT PATHS):
REQUIREMENTS MET / UNMET:
ARCHITECTURE / API IMPACT:
SECURITY / PAYMENT INVARIANTS:
DATABASE / MIGRATION IMPACT:
PERFORMANCE BEFORE / AFTER:
TEST COMMANDS / COUNTS / EXIT CODES:
RUNTIME EVIDENCE OR NOT VERIFIED:
VISUAL QA / SCREENSHOTS:
DOCUMENTATION UPDATED:
UNRESOLVED RISKS:
OPERATIONAL ACTIONS AND AUTHORIZATION:
ROLLBACK PLAN:
SCORE /100:
VERDICT:
MERGE STATUS:
```

## 16. Definition of done

- **Implementation-complete:** Code and offline evidence ready for review.
- **Review-approved:** Principal Architect reviewed actual source and verified scope-specific gates.
- **Integrated:** Authorized integrator combined branches and cross-workstream tests passed.
- **Released:** Separately authorized runtime checks and deployment completed.

> **Final principle:** Protect ownership, contracts, evidence, and reproducibility. A fast isolated fix is not a success if it breaks another layer.
