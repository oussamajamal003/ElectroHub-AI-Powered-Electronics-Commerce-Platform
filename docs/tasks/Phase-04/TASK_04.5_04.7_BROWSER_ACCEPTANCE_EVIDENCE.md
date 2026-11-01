# Tasks 04.5–04.7 — Browser acceptance evidence

**Tested state:** `feature/04.7-socketio-delivery` at `c42e048` plus **uncommitted** working-tree changes (hook fix B-1, poll fix B-2, new tests, QA stack/spec tooling; see Bugs). Nothing committed, pushed, merged or deployed.
**Stack:** isolated QA stack from `apps/backend/scripts/delivery-qa-stack.cjs` (frontend `:3310`/`:3311`, API `:5310`/`:5311`, never 3000/5000), disposable loopback PostgreSQL `electrohub_disposable_delivery_qa_*`, local tile stub, no Stripe or Brevo keys configured, `DELIVERY_SIMULATION_ENABLED` on that database only.
**Method:** real Chromium (Playwright, `playwright.delivery.config.ts`). Existing suites live 7, map 9, tracking 8, plus the gap-closure spec `apps/frontend/tests/visual/delivery-gaps.visual.spec.ts` (8 tests). Screenshots: `apps/frontend/screenshots/delivery-gaps/`.

## Shared DEV (read-only, nothing written)
- Project `pzxekjybdiulzmssalfo` = `electrohub-dev`, region ap-northeast-2, ACTIVE_HEALTHY (PROD is `electrohub`, a different project).
- `_prisma_migrations`: 29 rows, 0 unfinished or rolled back; `20261031000000_delivery_tracking` finished, 1 step. Newest rows follow the earlier recommendation migrations, so the AI/recommendation migrations remain applied; schema `ai` exists.
- Schema vs `schema.prisma`: `deliveries` 16 columns and `delivery_events` 15 columns equal the model fields; enums `DeliveryStatus`, `DeliveryEventType`, `DeliveryEventChange`, `DeliveryEventSource`, `DeliveryLocationSource` present; indexes `delivery_events_deliveryId_revision_key`, `_deliveryId_occurredAt_idx`, `_type_occurredAt_idx`, `_pkey`; CHECKs `delivery_events_coordinates_pair_check`, `_coordinates_range_check`, `_revision_positive_check`. Constraints on `deliveries` itself and RLS were not re-inspected.
- Result: **DEV MIGRATION: VERIFIED APPLIED** (record and schema agree). The earlier "BLOCKED, pending" statement was stale. No migration applied, generated or recorded by me; no shared-DEV simulation or destructive write.

## 26 scenarios
| Group | Result | Evidence |
|---|---|---|
| 04.5 Foundation | 6/6 | B01–B05 from the tracking suite (15/15 live+tracking re-run on final code); B06 = gap test **P1** |
| 04.6 Leaflet | 6/6 | map suite 9/9 from the earlier clean run; its source and the map code are untouched by B-1/B-2 so it was not re-run |
| 04.7 Realtime/Simulation | 8/8 | B01, B03, B04, B08 from the live suite (re-run on final code); B02 = **P2**; B05 = **P3**; B06 = **P4**; B07 = **M1** |
| Final UI/A11y/Regression | 6/6 | B01–B03 from tracking/live suites (axe, responsive, keyboard); B04 = **P5 + P5b**; B05 = **P6**; B06 = **M2** (same database comparison as P4) |
| **Total** | **26/26** | partial/not executed/blocked: none |

## Gap closure results (gap spec, single clean run 8/8; final-code re-run of live+tracking 15/15)
- **P1 owner isolation:** customer B opens A's tracking URL → "Order not found" alert, no ETA/history text; REST `GET /api/orders/{A}/delivery` → 404, identical to an unknown order, body has no coordinates/revision/ETA; real browser Socket.IO (the app's own bundled client): subscribing A's order → `{ok:false,code:"NOT_FOUND"}`, B's own order → `ok:true`; an admin ETA change to A afterwards produced zero `delivery:updated` events at B.
- **P2 live ETA/location:** admin ETA change reaches the customer without refresh: overview ETA changes, exactly one announcement and exactly one toast (ETA); two location patches move the marker/route, no extra toast or announcement, timeline grows by at most one event each with no duplicate rows; after reload ETA and history are identical and the stored last admin location matches. (ETA and location are sent through the real admin API, as in the other suites; the admin form was not driven for these two.)
- **P3 stale ack / reconcile:** subscribe ack held at a Chromium WebSocket route → page never shows "Live updates on"; connection cut, the held ack replayed (original id) into the new connection, REST made to fail with 500 → page still not live; REST restored → the 60 s poll completes reconciliation and the pill returns to live (about 60 s later in the log). This test found **B-2**.
- **P4 + M2 database integrity:** whole-table md5/count fingerprints of `orders`, `order_items`, `payments`, all outbox/inventory/stock tables identical before vs after admin ETA, admin location and a UI-driven simulation (Start/Stop buttons, ≥2 persisted ticks); events added: contiguous revisions, STARTED, ≥2 SIMULATION location events, one ADMIN location, last = STOPPED; `locationSource` = SIMULATED; dashed route; customer shows "Simulated demo". No Stripe/Brevo call is possible (no keys on the stack) and the outbox is unchanged.
- **M1 stop during a tick:** after the first persisted tick a second psql session held `FOR UPDATE` on the delivery row; `pg_stat_activity` showed a lock-waiting backend (tick in flight); Stop clicked in the admin UI did not respond for 3 s and recorded no STOPPED; after the lock was released Stop returned 200, STOPPED revision > the last location revision, location count grew by at most the held tick, nothing changed in the next 7 s, reload kept the same path, a repeated Stop returned 200 with no new event. The unit tests (A1–A3) remain the exact-ordering proof.
- **P5 session expiry:** a test-only access token signed with the stack's own throw-away secret (12 s lifetime, injected into the first refresh response; production JWT code untouched) → server emitted `session:expired`, the client refreshed (≥2 refresh calls), reconnected, re-read REST and showed "Live updates on" again on the same tracking URL. **P5b:** refresh rejected with 401 → the page shows "Sign In Required", no live pill, no order data.
- **P6 console/network:** across customer/admin scenarios: 0 page errors, 0 external hosts (tile stub only), 0 sensitive query strings, no failed writes; 21 GET requests cancelled by the browser (reloads and deliberate in-flight read restarts) counted and not treated as failures; deliberately injected 404 (P1) and 500 (P3), and the P5b 401, excluded as expected. Reads per tracking page ≤ 6 in the representative scenarios.

## Bugs
| ID | Severity | Cause | Fix | Retest |
|---|---|---|---|---|
| B-1 | Medium | A failed reconcile read left the page non-live until Refresh/reconnect | `useDeliveryLiveUpdates.ts`: a later successful REST read of the same query settles the pending, connected, acknowledged generation (idempotent; stale generations discarded); test C3 | hook tests 17/17; live suite 7/7 incl. offline test |
| B-2 | Medium | `refetchInterval` returned `false` whenever the query was in an error state, so after a failed reconciliation nothing re-read automatically and the page stayed "Reconnecting…" (found by P3) | `queries.ts` `snapshotPollInterval`: keep the 60 s fallback after transient errors (5xx/429/network), stop on 401/403/404; unit test `queries.test.ts` | P3 passes (poll at ~60 s completes reconcile); delivery unit tests 44/44 |

## Gates
- Gap spec: 8/8 in one clean run on a fresh stack. Live+tracking suites re-run on final code: 15/15. Map suite 9/9 from the earlier clean run (unchanged code path).
- Frontend: typecheck clean, eslint clean on `src/features/delivery` and the new spec, full vitest 125 files / 1090 tests passed. `git diff --check` clean. Frontend `npm run build` not run in this pass.
- Rate limits were respected, not disabled; repeated reruns on one stack exhausted the 30 per 15 min login limit, so final evidence uses fresh stacks. Backend source was not changed in this pass.

## Remaining caveats
- Admin ETA/location edits and the courier hold use the admin API and a PostgreSQL row lock rather than admin form fields or a source fault hook.
- Stripe/Brevo "no calls" rests on no keys being configured on the QA stack plus the unchanged outbox.
- Constraints on `deliveries` and RLS in DEV were not re-inspected; build and CI status on the pushed head not verified here.
