# Task 05.2 — Implementation Evidence

Single evidence record for Task 05.2 (decisions and contracts: `TASK_05.2_IMPLEMENTATION_PLAN.md`; ADR-011). Everything below was
executed in this working tree on 2026-11-05 on base `581726eff055db1dca4778c6e17ce86228509a1f` (`develop`), **uncommitted** — no commit,
push, PR, merge, deploy or PROD access happened. "Disposable" = fresh loopback PostgreSQL 18 cluster per run (no pgvector: the four
vector migrations are skipped and logged, exactly as `scripts/recommendation-fbt-pg.cjs` does).

## Commands and results

| Gate | Command | Result |
|---|---|---|
| Backend typecheck | `apps/backend: npx tsc --noEmit` | exit 0 |
| Backend lint | `apps/backend: npm run lint` | exit 0 |
| Backend CI suite (`test:ci`) on disposable PG | `node scripts/admin-security-pg.cjs --suite=ci` | 2063 passed, 7 failed, 134 skipped → after fixes the remaining failures are environmental (below) |
| 05.2 security + business gate on disposable PG | `npm run test:admin-security:pg` | **18/18** (security 12, settings/analytics/recommendations 6) |
| Frontend typecheck | `apps/frontend: npx tsc -b` | exit 0 |
| Frontend lint | `apps/frontend: npx eslint .` | 0 errors, 4 warnings (react-refresh export hints in new security components) |
| Frontend unit suite | `apps/frontend: npx vitest run` | 1213/1219 in the parallel run; the 5 non-layout failures pass in isolation (124/124); `AdminLayout` nav test updated → 8/8 |
| Frontend build | `npx vite build` | exit 0; all new pages are lazy chunks; main bundle contains no WebAuthn/QR code (verified by grep) |
| Storybook build | `npm run build-storybook` | exit 0 |
| Browser, disposable stack | `npm run qa:task05-2:browser-stack` + `npm run test:visual:task05-2` | **6/6** (Chromium, headless) |
| Browser, live DEV | `npm run test:visual:task05-2-live-dev` (localhost:3000 → local Express → DEV) | **2/2** |
| DEV migration | `node scripts/admin-security-migrate.cjs pre` / `deploy` | identity `pzxekjybdiulzmssalfo` verified on both URLs; ledger 29→30; `pending: none`; `migrate status` up to date |

Environmental failures in the local `test:ci` run (not code defects): `tests/swagger.test.ts` first request exceeds 5 s only under the
parallel local run (passes alone, 4/4; CI runs single-worker); `src/lib/db-request-metrics.test.ts` targets a separate pre-existing local
cluster (`.isolated/env.json`) that is not running on this machine (skipped in CI). Payment suites must not run against `.env` (shared DEV):
the payment-mutation gate refuses them by design; they pass on the disposable cluster.

## Defects found and fixed during verification

| Found by | Defect | Root cause / fix |
|---|---|---|
| Disposable PG suite | Loser of a concurrent TOTP submission got `429 too many attempts` | Attempt counter ran on an already-consumed transaction → now `401 MFA_CHALLENGE_INVALID` |
| Lane review | Pinned items in organic rails credited to the engine's strategy | Signed token carries `featuredProductIds`; events stored as `MERCHANDISED_PIN` (old tokens still verify) |
| Lane review | "Invitation accepted" preference had no sender (fake setting) | Inviter notification implemented, preference-governed, after commit |
| Lane review | Retry review showed the seed shipping price after a configured change | Uses the attempt's immutable `shippingCost` |
| Lane review | Bulk audit failure after committed rows → 500, truthful results lost | Audit failure logged, results returned |
| Lane review | Security UI DTO mismatches (sessions/login history/profile/team/delivery enum) | Backend DTOs aligned to the UI contract |
| Lane review | Image-search result selection never sent | Signed, keepalive, fire-and-forget event from the result click |
| Frontend build | Admin login (WebAuthn/QR) eagerly in the storefront bundle | Route made lazy |
| Browser 390px | Recommendations overview overflowed the page by 346 px | Tables wrapped in a focusable horizontal scroll region |
| Visual comparison | Analytics period control under the description; revenue as a spiky line | Control on the title row (reference); bar chart (reference) |
| Visual comparison | Category table clipped in a half-width card at 1440; dead space in stretched panels | Pair side-by-side only ≥1600 px; `align-content: start` |
| CI-equivalent run | Route tests minted session-less ADMIN tokens | Tests use a live-session fixture; session-less behaviour asserted separately |

## Acceptance summary (A01–K12)

| Group | Status | Evidence |
|---|---|---|
| A01–A06 repository/architecture | PASS | baseline table in plan; session-issuance audit; screenshots opened (Analytics, Settings, Login); lanes with disjoint ownership |
| B01–B04, B06 schema/migrations | PARTIAL | migration `20261105000000` (additive, CHECKs, partial unique index, RLS); disposable SQL upgrade over legacy rows (B03 test); original DEV gate results reported above. The disposable harness uses psql with four pgvector-dependent migrations skipped: it does NOT prove Prisma ledger/checksum integrity or a repeat-deploy no-op. Full-chain migration verification remains a CI/release gate. |
| B05 encryption/retention/cutover | PASS | versioned AES-GCM key ring, fail-closed 503, operator CLI, 90-day login-history window, analytics 400-day purge, ADR-011 release order |
| C01–C06 invitations | PASS (API, disposable) | C01–C05 test; bootstrap/enrollment window via CLI |
| C07 team UI | PARTIAL | page renders at 390–1920 with real data; create/resend/revoke UI not clicked in the browser run |
| D01–D07 MFA | PASS | disposable API tests + browser enrollment/wrong-code/recovery-codes journey; live DEV shows no session from a password |
| D08 login UI vs reference | PASS | login captured at 390/768/1440/1920 vs `Admin login.png`; MFA step/enrollment states captured |
| E01–E02 passkeys | PASS (virtual authenticator) | browser registration + passkey sign-in with Chromium virtual authenticator; physical device NOT VERIFIED |
| E03–E07 sessions/history/profile | PASS | revocation ends access+refresh (API); two sessions listed in browser; password change revokes all; last factor 409 |
| F01–F06 settings/shipping/notifications | PASS | nav; store save+reload (browser); shipping changes new quotes, revision changes, history untouched, 409 on stale version (disposable); maintenance/digest omitted |
| F07–F08 settings visual/states | PARTIAL | four tabs captured; Store/Shipping compared with references; 200 % real browser zoom NOT VERIFIED; settings Storybook stories not written |
| G01–G09 recommendations | PASS | pin featured/dedupe/archive/expiry/preview-no-events on real PG; config 409; FastAPI outage fallback covered by existing suites |
| G10 recommendations UI | PARTIAL | all four tabs captured and overflow-checked; pin dialog not driven in the browser |
| H01–H08 analytics pipeline | PASS | signed image-search selection, dedupe, no image/identity columns, consent-only attribution, server-authoritative outcomes |
| I01–I09 analytics page | PASS | revenue/orders/AOV/CTR/conversion reconciled on real PG; 7/30/90/12m in browser |
| I10 analytics visual | PASS | compared with `Analytics page.png`/`Analytics_page.png`; 390/768/1440/1920 captures |
| J01–J03 bulk | PASS (API/unit) | per-item outcomes, bounded, shared policy; browser selection only rendered, not executed |
| J04–J10 UX/a11y/perf | PARTIAL | overflow checks at 4 widths on 14 pages, keyboardable radiogroup/tabs, lazy chunks; real 200 % zoom, reduced-motion and screen-reader passes NOT VERIFIED |
| K01–K08, K10 | PARTIAL | commands above; security/financial paths and lane diffs inspected. Full independent review of every changed file is not certified; browser/a11y gaps remain as recorded. |
| K09 CI on PR head, K11 release, K12 Architect | PENDING EXTERNAL STAGE | no commit/push/PR by instruction |

## Live DEV status and the remaining operator step

DEV has the migration and the local backend runs this branch. Five seeded DEV administrators exist, **no owner, none enrolled**, so the
console is intentionally closed until an operator runs (from `apps/backend`, DEV only):

```
npx tsx scripts/admin-security.ts grant-owner admin@electrohub.com --confirm-target=pzxekjybdiulzmssalfo
npx tsx scripts/admin-security.ts authorize-enrollment admin@electrohub.com --hours=24 --confirm-target=pzxekjybdiulzmssalfo
```

The agent did not run these: the permission system classified granting an owner on the shared environment as a permission grant. Until
then, authenticated admin journeys on DEV are NOT VERIFIED (they are verified on the disposable stack). Authenticated customer journeys on
DEV are NOT VERIFIED (customer credentials in `.env` were not read).

## Owner-authorized review corrections (2026-11-05)

After Stage 1 returned Request Changes (provisional 76/100), the owner authorized continuing the remaining stages, including corrections
and Git/PR finalization. This does not retroactively turn the earlier review into independent approval. Publication is as a draft until
the final CI and independent acceptance gates are resolved; no merge, deployment or PROD migration is authorized or performed.

All six reported defects were corrected:

- Single-session revocation disconnects the account's existing delivery sockets after commit (valid other sessions reconnect). ADMIN
  subscription requests also recheck their live MFA session; a real Socket.IO regression covers revocation after handshake.
- Recovery verification computes candidate digests using retained key-ring entries; new codes still use the active key. No schema or
  migration rewrite is needed. Real-PG tests prove pre-rotation codes remain single-use after active-key rotation.
- Analytics formats fractional growth as a percentage. Story/test fixtures now use the backend ratio contract.
- Store, Shipping and Notification drafts retain the version they were opened against until explicit save/reload remounts the form.
  Rerender regressions prove a background refetch cannot silently authorize an old draft with a new version.
- Admin login checks `response.user.role`, with customer-denial mocks updated to the real response envelope.
- Invitation password validation/help matches server policy and displays server field errors inline.

Correction validation: frontend focused suites 51/51; backend crypto/socket suites 30/30; disposable security/business suites 19/19;
root typecheck passed; root lint passed with four Fast Refresh warnings. Broader tests/build/browser results and the actual PR head CI
must be recorded separately when completed. The local SQL harness comments have been corrected to remove unsupported Prisma-ledger claims.

### Finalization validation (current correction delta)

| Command / scope | Actual result |
|---|---|
| Root `npm run typecheck` | PASS, frontend and backend |
| Root `npm run lint` | PASS, four Fast Refresh warnings |
| Root `npm run build` | PASS, frontend and backend; existing Sass division and bundle-size warnings remain |
| Focused frontend Login / Invite / Settings / Analytics | 51 passed |
| Backend crypto / Socket.IO | 30 passed |
| `node scripts/admin-security-pg.cjs` | 19 passed, real disposable PostgreSQL; includes retained-key recovery and session revocation |
| Root `npm run test:frontend` | 1,224 passed, 2 failed (routing lazy-home heading and unsaved-changes dialog timeouts) |
| Isolated frontend rerun of both failing files, `--maxWorkers=1` | 6 passed; no source or test weakening |
| Backend `CI=true node scripts/admin-security-pg.cjs --suite=ci` | 2,074 passed, 5 failed, 134 skipped. Four failures were logging/OpenAPI timeouts; the real-adapter metrics test reads a separate pre-existing `.isolated/env.json` target rather than the harness database |
| Isolated backend `--suite=ci --files=tests/logging-continuity.test.ts,tests/swagger.test.ts` | 27 passed on a fresh disposable database; no timeout overrides |
| Frontend `npm run test:visual:task05-2` | 6 passed on disposable API/PostgreSQL, synthetic identities, Chromium virtual authenticator |

Browser verification now executes second-session revocation and confirms the revoked browser returns to login. Invitation verification
executes password-policy rejection, acceptance, TOTP enrollment, recovery acknowledgement and console entry. The run also covers settings
save/reload and page-overflow assertions at 390/768/1440/1920. Updated invitation (390) and analytics (1440) screenshots were opened;
the repository Analytics reference was inspected. This is rendered-flow evidence, not a new certification of exact Figma parity or all
accessibility criteria. Physical passkeys, actual 200% browser zoom and screen-reader/reduced-motion acceptance remain NOT VERIFIED.
An initial restricted browser run was stopped because its frontend was unreachable; the permission-enabled rerun above passed.

Full-suite results remain recorded as failures despite successful isolated reruns. The separate metrics-database target was not changed
or written to. Shared DEV provisioning, PROD migrations, deployment and merge were not performed in this finalization run.
Actual remote CI and review status belong to the draft PR's exact head; this document does not assert them before execution.
