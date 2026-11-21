# Task 06.3C — Remediation Report

**Review date:** 2026-11-19  
**Branch/HEAD:** `feature/06.3-production-infrastructure` / `053a271ba36ebcf436720bdc6aa87c7bb79cf149`  
**Scope:** Source-level remediation and isolated local checks only. No deployment, host bootstrap, certificate issuance, provider setting, external message or database action was performed.

## Summary

The single-origin candidate is structurally coherent in source: Nginx serves Vite output and proxies REST and Engine.IO traffic; Express remains the commerce/auth boundary; FastAPI is private; Supabase remains external. Three concrete repository defects were corrected: browser Origin was not checked on refresh/logout routes; TLS service scripts referenced uninstalled host paths; and the release workflow called a host deployment command for which no installer existed. A separate AI candidate verification now fails on mismatched/missing relevance artifacts. Deployment remains **NO-GO**.

## Actionable findings

| Severity | Location and defect | Consequence | Correction and focused verification |
|---|---|---|---|
| **HIGH** | `apps/backend/src/routes/auth.routes.ts` — `/admin/refresh`, `/customer/refresh`, `/admin/logout`, and `/customer/logout` previously relied on browser cookie behavior/CORS without exact Origin enforcement. Same-site sibling origins can issue credentialed requests; SameSite=Lax is not a substitute for a CSRF boundary. | Cross-origin session refresh/logout could be triggered from an untrusted same-site origin, weakening session/CSRF guarantees. | Added `requireFrontendOrigin` against the exact configured frontend origin and mounted it on the four cookie-bearing endpoints. Added direct unit cases for missing/malformed/untrusted Origin. 4/4 pass. HTTP route test exists but Supertest cannot bind localhost in this sandbox (`EACCES`), so endpoint integration remains unverified. |
| **HIGH** | `infrastructure/production/tls/renew.sh`, `certbot-deploy-hook.sh`, `bootstrap-staging.sh`, `bootstrap-staging-certificate.sh`, and the renewal/expiry unit templates — commands referenced `/usr/local/sbin` files that were not installed, while the staging bootstrap did not reliably consume configured environment/installer paths. | Renewal/first-certificate setup could fail at runtime despite apparently present unit templates; failed lifecycle handling can leave HTTPS unavailable or stale. | Scripts/units now resolve repository-installed scripts at the release path or adjacent script directory; staging bootstrap explicitly opts in and installs only staging output. The focused static lifecycle suite passes 5 TLS checks. Certbot/systemd/Nginx execution and recovery remain unverified. |
| **HIGH** | `.github/workflows/deploy-production.yml` calls `/usr/local/sbin/electrohub-deploy-release`, but the prior candidate had no source installer for that privileged command. | A reviewed workflow could reach the deployment step and fail because the host entrypoint does not exist, or tempt an unsafe ad-hoc host install. | Added root-only `infrastructure/production/install-deploy-command.sh`, fixed destination, root ownership/mode, atomic creation and refusal to overwrite a different existing command. Static policy test passes. It was not run on a host. |
| **BLOCKER** | `docs/09_Deployment/AI_MODEL_ARTIFACT_CANDIDATE.json` versus `apps/ai-service/models/relevance-siglip2-d1` — declared `relevance.json` size/hash differ; manifest also requires `family_gate.safetensors`, absent from that artifact directory. | Exact-SHA release artifact verification exits 1; the required AI release cannot be validated or safely activated. | No artifact or manifest was rewritten. Preserve fail-closed behavior; obtain/produce the correct approved artifact set, validate checksums and compatibility identity, then rerun the verifier and affected AI tests before any release review. |
| **HIGH** | `infrastructure/production/deploy-release.sh` refuses a first deployment without an existing release and requires a backup evidence record, while the workflow only installs later releases. | There is no fully documented/verified first-host bootstrap path; the first release cannot be performed by this workflow. A reference string is not itself proof of recoverable backup. | Kept first deployment separate from automatic release and updated the workflow documentation to require a separately approved bootstrap. An operator-approved bootstrap and actual backup/restore evidence are still required; none was attempted. |

## Reviewed areas without a demonstrated defect

- **Nginx/frontend:** Candidate config uses a configurable canonical authority, rejects unknown Host values, serves SPA fallback after API/socket locations, proxies `/api/` and `/socket.io/`, supports Engine.IO upgrade and polling, preserves raw request bytes for webhook routes, and applies static asset caching/security headers. The edge image builds from the repository root/lockfile and copies runtime assets. No hostname was hardcoded by this review. Nginx syntax and runtime behavior were not tested because Nginx/Docker are unavailable.
- **Authentication/config:** Existing production cookie policy remains host-only, Secure, HttpOnly and SameSite=Lax with existing paths and refresh rotation/reuse handling. This task did not alter cookie settings, CORS policy, OAuth protocol, CSRF token logic, or role separation. New exact-Origin middleware only adds a route guard. Browser behavior is not proven.
- **Socket.IO:** `/delivery` is a namespace; Engine.IO transport uses `/socket.io`. Client configuration uses same-origin URL, both WebSocket and polling, and auth middleware/ownership checks remain in source. No live upgrade, reconnect or browser unauthorized-access test was run.
- **OAuth and email/payment URLs:** Candidate callback is constrained to the frontend origin and `/api/auth/google/callback`; state/nonce/PKCE checks remain. Single-origin routing can carry callbacks, Stripe webhook and server-side Brevo links, but public provider configuration and real callbacks were not tested. No live provider setting changed.
- **Workers:** Payment, email, push and media dispatch are operator-enabled and default disabled in the candidate configuration. Existing target/ownership/lease/idempotency controls remain. No worker was enabled and no external job was processed.
- **Admin bootstrap/migrations:** Source implements operator-controlled one-time admin bootstrap and does not add a public admin registration route or default production password. The disposable PostgreSQL bootstrap and migration integration path was not available; no migration ran.
- **Release workflow:** The candidate is manual `workflow_dispatch` on `develop`, validates a full SHA against the workflow run SHA, checks required exact-SHA status, emits a content-addressed bundle/image tags, separates deployment from migration, requires the named GitHub Environment, serializes releases, and retains the artifact briefly. YAML alone cannot prove account-level Environment reviewers/branch protections. Actions and base images are version tags rather than immutable SHAs/digests; pinning is a supply-chain improvement to complete before production. No image was built or published.

## Verification and limitations

- Focused middleware unit test: **4/4 passed**.
- TLS/deploy-command policy tests: **6/6 passed**.
- Targeted ESLint on the changed backend middleware, routes, controller tests and admin API helper: **passed**, exit 0.
- `npm run typecheck` (`apps/backend`): **passed**, exit 0 after the middleware test was added.
- HTTP-level auth route test: blocked before assertions by sandbox `EACCES` while binding `127.0.0.1` for Supertest.
- `git diff --check`: passed; Git emitted only LF-to-CRLF working-copy warnings.
- Offline AI artifact verifier: **failed as expected**, with `artifact mismatch: relevance.json`.
- Docker, Nginx, browser matrix, DB integrations, migration, public OAuth/TLS, remote CI, host backup/restore, and VPS capacity: **NOT VERIFIED**.
- No prior 43-infrastructure-test or 4-AI-test result is reused. The exact source/file identity of those historical results was not established for this final worktree.

## Residual release blockers

1. Resolve and verify the complete AI model/relevance artifact set and vector-index compatibility without activating a production index.
2. Obtain operator verification that a $0 hostname is acceptable to Google OAuth; current DNS candidate remains conditional.
3. Prove public TLS bootstrap/renewal/expiry alert and rollback on an authorized staging endpoint.
4. Provide the first-host bootstrap and backup/restore procedure with real isolated evidence.
5. Complete focused auth HTTP/browser checks, including invalid Origin, refresh rotation/reuse, logout revocation, customer/admin boundaries, socket polling/upgrade/reconnect and deep links.
6. Verify GitHub Environment reviewers/protections and pin workflow actions/base images; run exact-SHA CI only when separately authorized through the normal repository process.
7. Measure the required stack on an explicitly authorized larger host; 4 GiB and 8 GiB are candidates only.

**Recommendation:** `REQUEST CHANGES` for repository remediation/release review. **Deployment status: NO-GO.** This report is not purchase, provisioning, provider-setting, public exposure, production mutation, or deployment authorization.
