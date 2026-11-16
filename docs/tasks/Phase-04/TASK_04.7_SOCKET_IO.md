# ELECTROHUB — TASK 04.7 — SOCKET.IO REAL-TIME DELIVERY

**Document status:** IMPLEMENTATION SPECIFICATION, DESIGNED / PROPOSED. Not approved and not implemented. **Starts only after 04.6 is approved.**
**Normative sources:** [Integrated architecture](TASK_04.5_04.7_DESIGN_ARCHITECTURE.md) §8–§11 · [Design handoff](TASK_04.5_04.7_DESIGN_SYSTEM_HANDOFF.md) §3 (#15–16, #23), §6.5 · artifact component `ConnectionStatusIndicator`

## Required changes

1. **Dependencies:** `socket.io@4.8.x` (backend), `socket.io-client@4.8.x` (frontend), with matching minors.
2. **Backend `src/sockets/`:**
   - `socket-auth.ts`: handshake JWT plus the `isActive`/role lookup, with a disconnect at `exp`.
   - `delivery.gateway.ts`: namespace `/delivery`; subscribe/unsubscribe with ownership checks; server-built rooms `delivery:order:<orderId>` and `user:<userId>`; limits.
   - `delivery.publisher.ts`: `afterCommit`.
   - Attach to the exported `server` in `server.ts`, and close `io` before the server on shutdown.
3. **Hooks:** the logout and account-deletion services disconnect the `user:<id>` room. Admin PATCH and the simulation runner publish after commit.
4. **Simulation:** `services/delivery-simulation/` (runner + approved fixture routes) and admin `POST/DELETE /api/admin/orders/:ref/delivery/simulation`, guarded by `DELIVERY_SIMULATION_ENABLED` and refused when `NODE_ENV === 'production'`.
5. **Frontend `features/delivery/realtime/`:** `deliverySocket.ts` (one socket per signed-in user, torn down on user change or logout, token from the existing `api.ts` holder, refresh on `session:expired`/`connect_error`), `useDeliveryLiveUpdates` (revision reconciliation §8.3, REST refetch on every (re)connect, polling disabled while subscribed), `ConnectionStatusIndicator`, a single polite live region, and the Radix Toast for status/ETA only.

**Visual source of truth:** handoff §9.3 (ConnectionStatusIndicator) and the artifact showcase's Live connection controls: icon + word pills (Live updates on, Reconnecting…, Live updates paused with a "Refresh now" banner, Back online · up to date, Updates stopped), one polite live region, and "Simulated demo" labelling.

## Out of scope

Redis adapter, multi-instance scaling, Nginx/TLS config (Phase 06 design notes only), connection-state recovery, admin live dashboards, and push notifications.

## Acceptance criteria

- **AC1.** T7-01 … T7-15 pass, with socket integration tests using real `socket.io-client` against a test server.
- **AC2.** A forced transaction failure emits nothing (T7-04).
- **AC3.** Two customers subscribed to different orders never receive each other's events, verified by event capture over a simulated run.
- **AC4.** After a 30 s offline period, the page shows the current revision within one REST round-trip of reconnecting.
- **AC5.** Simulation runs only in non-production, is labelled on every surface, and never changes payment or order data.
- **AC6.** Browser QA with two tabs and an account switch, recorded at 390 and 1440.

## Risks

A lost event between commit and emit (accepted; recovered by refetch). The single-instance assumption. Token-expiry edge cases. Simulation writes on shared DEV (D5: disallowed by default).

**STOP after 04.7 for Principal Architect review, then a final integration review.**
