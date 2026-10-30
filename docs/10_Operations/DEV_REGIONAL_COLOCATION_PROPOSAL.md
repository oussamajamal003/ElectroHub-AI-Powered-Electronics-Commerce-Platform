# DEV Regional Colocation: Infrastructure Proposal

Status: **PROPOSAL, awaiting owner approval. No infrastructure was changed.**
Date: 2026-10-30. Related evidence: `docs/tasks/Phase-04/TASK_04.4_IMPLEMENTATION_EVIDENCE.md` (not repeated here).

## 1. Executive summary

Authenticated Home takes about 11-12 s to show "Recommended for You" after a hard refresh. Query execution on the database is sub-millisecond to a few milliseconds; the time is the **number of sequential database round trips multiplied by the cross-region round-trip time** between the developer machine (where Express and FastAPI run in DEV) and Supabase in `ap-northeast-2` (Seoul). Session refresh (about 5-7 s) is the largest single stage, the personal recommendation chain (about 4 s) the next.

**Recommendation: Option A.** Run the DEV Express backend and FastAPI service in or next to `ap-northeast-2`, keep the same Supabase project, keep the session-pooler route. Nothing in the code, token rotation, consent order or TLS has to change. Expected effect is an **estimate**, not a measurement (section 4).

## 2. Verified topology (unknowns marked)

```text
Developer machine (location NOT determined)
  Browser -> Vite :3000 (same-origin /api proxy) -> Express :5000 -> [pg adapter, pool max 5, verified TLS + CA]
                                                      |                         |
                                                      |                         v
                                                      |            Supabase Supavisor SESSION pooler, :5432
                                                      |            ap-northeast-2 (Seoul)  -> PostgreSQL
                                                      v
                                       FastAPI :8000 [psycopg AsyncConnectionPool 1-4, TLS required,
                                       read-only session, statement timeout 2 s, connect timeout 15 s]
                                                      |
                                                      v
                                       AI_VECTOR_DATABASE_URL -> host type / port / region: UNVERIFIED
```

| Item | Express | FastAPI |
|---|---|---|
| Source | `DB_RUNTIME_URL_SOURCE=direct` in `.env.local`, so `DIRECT_URL` | `AI_VECTOR_DATABASE_URL` (read-only role) |
| Host type / port | Supabase session pooler, 5432 (VERIFIED, config class only) | UNVERIFIED |
| Region | ap-northeast-2 (VERIFIED from hostname) | UNVERIFIED (likely the same project, not confirmed) |
| TLS | verified chain and hostname, CA bundle (VERIFIED in code and runbook) | `sslmode` require/verify-* enforced for remote hosts by config validation; whether the hostname is verified is UNVERIFIED |
| Pool | max 5 dev / 10 production; empty pool is not pre-warmed | min 1 / max 4; acquire timeout 10 s |

The FastAPI environment file is protected and was not read; the DSN in `.ai-vector/dev.json` is a credential and was not opened. **Exact action to close this unknown:** the owner (or an authorized run) prints only `scheme://host-class:port` and `sslmode` for `AI_VECTOR_DATABASE_URL` (no user, password or full host).

Correction carried forward: earlier plain-Prisma timings used `DATABASE_URL` (transaction pooler, 6543) and are not Express runtime measurements.

## 3. Latency baseline and confidence

| Measurement | Value | Source | Confidence |
|---|---|---|---|
| Browser hard refresh, cards visible | p50 11.6 s, p95 12.2 s (n=4) | Chromium, DEV | Medium (small sample) |
| `/api/auth/refresh` | 5.3-6.9 s (n=4) | Chromium | Medium |
| Consent / personal API | 1.0-1.8 s / 3.7-4.6 s (n=4) | Chromium | Medium |
| Warm Home navigation | immediate from cache, 0 requests | Chromium | Good |
| **Live Express route, 1-2 query public endpoints** (new) | `/api/categories` p50 0.59 s, p95 1.77 s, min 0.39 s; `/api/products?pageSize=1` p50 0.59, p95 1.15, min 0.44; `/api/recommendations/popular` p50 0.61, p95 2.68, min 0.44 (n=12 each, unauthenticated, read-only, localhost to Express) | curl-equivalent timing through the real session route | Medium-good; includes some app work |
| App overhead without database | `/api/auth/me` 401 p50 0.01 s | same | Good |

Inference (labelled estimate): about 0.4 s per sequential round trip floor, so refresh is roughly 12-15 round trips and the personal chain roughly 8-10. FastAPI stage timing (pool acquire, candidate retrieval, scoring) was **not** measured here: it requires the service key and a personalized call, which this task does not authorize. Baseline status: **PARTIAL**.

## 4. Options

| | A. Colocate Express + FastAPI in/near Seoul | B. Move DEV Supabase near the developers | C. Connection routing | D. Fewer round trips |
|---|---|---|---|---|
| Bottleneck addressed | Round-trip time for every DB-touching request (refresh, consent, personal, Account, Cart) | Same, for developer-hosted services | Pool/mode overhead only; not distance | Count of round trips |
| Estimated benefit (estimate) | Per-trip 0.4 s to roughly 0.01-0.03 s in-region. Refresh and personal chain would fall from seconds to a few hundred ms each. Plus browser-to-host latency for the few requests that remain (developer-to-Seoul, unmeasured) | Same magnitude if a region next to the developers exists | Small; session mode is already intended, transaction mode refused by design | Hundreds of ms at most per request; consent-before-history and rotation transactions limit it |
| Evidence quality | Mechanism strong (RTT-bound, execution ms); magnitude not benchmarked | Same | Weak | Weak |
| Implementation cost | Low-medium: two small services, secrets, URL wiring | High: migration of schema, data, auth, storage, pgvector, role grants | Low | Medium, risk of regressions |
| Operating cost | Estimate: small VM or container pair, order of tens of USD per month (verify provider pricing) | Supabase project change, possible plan cost | none | none |
| Security risk | New host holds DEV secrets; mitigated by secret manager, firewall, no PROD credentials | Data move, identity and RLS drift | Low | Auth, replay, consent regressions if careless |
| Deployment risk | Low; the database is untouched | High: downtime, integrity | Low | Medium |
| Rollback | Point Vite proxy and AI URL back to the local processes | Restore from backup; hard | revert env | revert code |
| Approvals | New billable resource, secrets provisioning, network rules | Owner and data-protection sign-off, Supabase change | pool/routing change approval | code review |

Option D candidates found so far: none independently safe. Consent and history reads must stay sequential; refresh rotation is a transaction and is out of scope.

**Primary strategy: Option A.** It is the only option that attacks the measured cause, leaves the database, schema and token protocol untouched, and is reversible by changing two URLs.

## 5. Recommended architecture

```text
Browser -> Vite (local, same-origin /api proxy, cookies unchanged)
             |  HTTPS to a single regional host
             v
   Regional host in/near ap-northeast-2  [firewalled, secrets from a manager]
     Express :5000 --session pooler :5432, verified TLS--> Supabase (same project)
        |  private/loopback call, service key
     FastAPI :8000 --read-only role, TLS--> Supabase (same project, pgvector)
     models/ (D3 SigLIP2 artifacts, relevance artifacts) on the host's disk
```

Why keep the local frontend proxy: the browser still talks same-origin to `localhost:3000`, so HttpOnly refresh cookies, SameSite and CORS behavior are unchanged; only the proxy target changes. Colocating Express and FastAPI on one host keeps the internal service key off the public network. Realistic caveat: the browser-to-host leg (developer to Seoul) remains for each request; a refresh plus consent plus personal call is three or four requests, so expect hundreds of ms of extra network but not seconds.

Hosting availability must be verified, not assumed: the Supabase pooler runs on AWS, so an AWS Seoul instance is the natural candidate; confirm that the chosen provider offers a Korea region (the repository's DigitalOcean plan does not record a region, and DigitalOcean's regional list should be checked before assuming Seoul). FastAPI needs enough memory and CPU for the D3 model and the model artifacts transferred to the host.

## 6. Performance goals (targets, not promises)

- Warm Home navigation: keep cached cards, 0 requests.
- Hard-refresh session restoration: aim well below the current 5-7 s.
- Personal API: aim for roughly 1 s or less, dominated by the AI call.
- Recommended for You total initial load: target under 3 s; **not guaranteed**, as developer-to-region latency, AI retrieval, rendering and image loading remain. If the benchmark shows otherwise, report the real figure.

## 7. Implementation plan

**Phase 1 - Preparation (needs approval).** Choose provider and instance in or near ap-northeast-2; budget; create a DEV-only secret store; allow only the developer IPs and loopback; connection budget: Express dev pool 5 plus FastAPI max 4 stays within the 15-session reserve described in the DEV runbook (stop the local processes first to avoid doubling sessions); DEV credentials only, no PROD credentials.

**Phase 2 - Controlled validation (read-only; needs approval for the host).** From the host: connect with verified TLS and the CA bundle over the same session route; run `SELECT 1` x 30 (cold and warm), a small indexed lookup and the product/category reads used above, and compare p50/p95 with section 3. Run FastAPI there (`python -m app`, D3 artifact directories) and time a personalized recommendation using a test customer already used in DEV; scalar stage timings only. Do not rotate real refresh tokens from a diagnostic; read-only components only. Verify database identity checks pass unchanged.

**Phase 3 - Deployment (separate approval).** Start services on the host; point `/api` proxy and the backend's AI URL to it; keep local processes stopped (single runtime per database budget); smoke test login, refresh, consent, personal rail, cart and a Stripe test-mode path without creating purchases.

**Phase 4 - Acceptance and GO/NO-GO.** Same Chromium scenarios as the Task 04.4 baseline, at least 10 hard refreshes, p50/p95. GO when: median hard-refresh cards visible is materially lower (target under 3 s, accept a smaller verified gain and report it), no auth regression (rotation, replay protection, 10 s grace, Web Lock behavior unchanged), no personalization or privacy regression, no payment or database safety regression, no unexpected console errors. NO-GO and rollback otherwise.

## 8. Security review

Open risks (none blocking the proposal): a new host stores DEV secrets (mitigate with a secret manager, least-privilege DEV role, no PROD credentials, network allow-list); logs must not contain tokens or personal data; TLS validation stays on (no change); refresh-token rotation, replay detection and cookie flags are untouched because the browser-facing origin is unchanged; consent-before-history and identity-scoped caches are code behavior and are unaffected; payments remain DEV-guarded (`PAYMENT_MUTATIONS_DISABLED`) and no payment state is touched by benchmarking. Security review status: **OPEN RISKS** (only the new-host items above, plus the unverified FastAPI TLS hostname verification).

## 9. Rollback

Stop the regional services; restore the Vite proxy target and the backend's AI URL to the local processes; restart the local backend and FastAPI; no database, schema or token data was changed, so no data rollback exists. Delete the host and its secrets afterwards.

## 10. Approval checklist for the owner

1. Approve creating one billable DEV host (provider, region, monthly cap).
2. Approve placing DEV secrets on it and the network allow-list.
3. Approve a read-only benchmark from that host (Phase 2).
4. Provide or approve the redacted FastAPI connection class/port/sslmode readout (section 2).
5. Separately approve any future switch of the DEV runtime to the host (Phase 3).

## 11. Remaining unknowns

FastAPI host type, port and region and its TLS hostname verification; the developer machine's location and its network latency to Seoul; per-stage FastAPI timings; the proportion of the 11-12 s that browser-to-host latency would add; provider availability and prices for the chosen region; whether any in-region Express timing matches the estimates. No value above was guessed: items marked estimate are derived from the measured round-trip floor and are not benchmark results.
