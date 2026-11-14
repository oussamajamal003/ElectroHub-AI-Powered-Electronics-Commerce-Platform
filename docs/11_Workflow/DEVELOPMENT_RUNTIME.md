# Supervised local development session

Run these commands from the repository root in Windows PowerShell, macOS or Linux (Node 22.19.0, installed workspace dependencies). This is a foreground development session, not a service installation or production deployment.

```powershell
npm run dev:stack:supervised
npm run dev:stack:doctor
npm run dev:stack:status
npm run dev:stack:stop
```

Keep the first command running. Open `http://localhost:3000`; API, Swagger (`http://localhost:5000/api/docs/`), customer/admin routes, signed Stripe webhooks and Socket.IO all use backend port 5000. Route navigation does not start, stop or replace a backend. Vite HMR affects only frontend code.

## Prerequisites and approval boundaries

- Configure the existing backend development environment (`apps/backend/.env.local`) with its approved DEV database identity, verified TLS CA, JWT/auth/storage settings and Stripe Test Mode credentials. Install/authenticate the Stripe CLI using the existing payment-runtime instructions. No secrets belong in source control.
- The existing supervisor still verifies the exact DEV dataset, migration names/checksums, canonical Stripe account, payment backlog, database connection reserve and available port. It activates the compiled API only through its existing private IPC handshake. The wrapper grants no additional authority.
- Checkout mode starts **no general payment-recovery worker** and explicitly disables in-process recovery. Startup never captures, cancels, refunds, replays old jobs or changes an order. Unresolved work can block a later restart and needs the existing owner-reviewed, exact-attempt recovery workflow. Do not add recovery flags to this stack command.
- Optional providers do not gate ordinary backend liveness. The *supervised checkout profile* does require the payment preflight; it refuses to substitute an unsupervised backend if that preflight fails. A watched backend remains available through the existing separate development commands, with shared payment mutations denied.

## Email and push

The default stack leaves commerce dispatch disabled. To request the existing approved allowlist worker:

```powershell
npm run dev:stack:supervised:email      # same as: npm run dev:stack:supervised -- --allow-email-allowlist
npm run dev:stack:restart:email         # switch an already running stack to the email-enabled profile
npm run notifications:doctor            # read-only: producer, dispatch, send mode, queue counts, push configuration
```

**`npm run dev` and the plain `npm run dev:stack:supervised` never send commerce email.** They still *enqueue* welcome, order and out-for-delivery events, which then wait as `READY` rows. `npm run dev:stack:status` says so on the `Commerce email worker` row (`disabled-by-default: events are still queued but NOT sent`) and names the command above. Rows older than 24 hours are never sent automatically (`staleNeedingReview`), and rows for recipients outside `COMMERCE_EMAIL_ALLOWED_RECIPIENTS` stay queued by design (`allowlistExcluded`); neither is replayed by starting the worker. Five separate claims must not be merged: *event enqueued* (outbox row), *worker ready* (status row / `email_worker_ready`), *provider accepted* (`ACCEPTED` row), *provider delivered* (Brevo transactional log) and *inbox received* (seen in the mailbox).

The backend environment must already have `COMMERCE_EMAIL_ENQUEUE_ENABLED=true`, `COMMERCE_EMAIL_DISPATCH_ENABLED=true`, `COMMERCE_EMAIL_SEND_MODE=allowlist`, approved `COMMERCE_EMAIL_ALLOWED_RECIPIENTS`, a valid frontend origin and authorized Brevo configuration. The supervisor rejects any **sendable backlog for those allowlisted recipients** before starting a worker. It never enables unrestricted/live email. Producer configuration is independent of dispatch; a worker with its producer disabled is reported DEGRADED.

The email worker owns durable email and (when independently configured/authorized) push dispatch. It restarts auxiliary crashes with the existing bounded backoff, tracks actual per-process readiness/heartbeats, and drains its current batch after IPC disconnect. Five crashes in five minutes exhaust its restart budget. Exit 78 is not restarted. Provider acceptance, inbox delivery and OS push presentation remain separate evidence; READY is not a delivery claim. See the [commerce runbook](../10_Operations/COMMERCE_EMAIL_RUNBOOK.md).

Capture-mode email remains available in the existing **disposable** `dev:isolated` workflow; this shared-DEV checkout wrapper does not widen capture/send permissions or replay old queued mail. Contact mail and administrator security/operational mail use their existing independent provider paths; commerce-worker readiness does not prove those paths succeeded.

## Ownership, reuse and conflicts

The root session and payment supervisor each create an exclusive, git-ignored control record under `.cache/` with a random local capability. Commands authenticate to a loopback-only control endpoint; the secret never appears in status output. Browser Origin requests are rejected. No command kills a PID read from a file.

An already running **new-protocol** checkout supervisor is reusable only after authenticated owner status plus the private API diagnostic prove its child PID, parent PID, DEV identity/TLS/readiness and live payment authority. A reused supervisor stays with its original owner; stopping the borrowing stack stops only its frontend. Stop the original foreground supervisor with Ctrl+C when it is no longer needed.

An existing healthy root session is reused without starting more processes. A concurrently starting/degraded session is refused. An unmanaged frontend/backend, a legacy supervisor without the control protocol, an unavailable owner or a stale record causes an actionable conflict. Unknown processes are never terminated; ports are never silently changed. Windows checks both owner inventory and IPv4/IPv6 accepting sockets before attempting a bind.

**One-time upgrade from an older runtime:** stop that runtime using Ctrl+C in its original owning terminal, then run the new stack command. The new launcher cannot safely adopt an older runtime that lacks process/authority attestation. Do not delete its live lock or kill `node.exe` broadly.

If a control/lock file remains after a crash, inspect its recorded PID *and process creation/command identity*, descendants and port owners. PID reuse is possible. Archive a stale file only after proving that its owner and every recorded child have stopped. The launcher deliberately never guesses that a stale lock is safe to remove.

## Backend updates and shutdown

```powershell
npm run dev:stack:restart
# With the separately approved allowlist profile:
npm run dev:stack:restart -- --allow-email-allowlist
```

Restart requests the owning session to drain, waits for its control record to disappear, ensures Prisma Client is current, builds backend code and re-runs payment preflight before starting a replacement. If a reused external supervisor remains, it is reused; to load backend changes it must first be stopped by its own session. An old unresolved payment blocks startup rather than being silently recovered. This is controlled interruption, not zero-downtime payment hot reload.

Stop sends an authenticated request to the live owner. Owned API/financial children receive revocation and IPC disconnect, invoking their existing graceful shutdown. Email stops new claims and finishes its active batch before closing its pool; a bounded forced fallback retains durable leases. Vite closes through its own IPC channel. Unconfirmed shutdown retains ownership records for inspection. Root monitoring reports lost/recovered readiness; it never auto-replaces a financial supervisor or reactivates stale payment authorization.

## Reading status accurately

`status` and `doctor` are read-only and produce sanitized JSON. Nonzero exit means the required frontend/backend/database/supervisor was not verified READY. Status distinguishes process liveness, a database `SELECT 1`, private supervisor/process binding, Vite, Swagger, public product/store reads and an Engine.IO handshake. It uses `localhost` for Vite because Vite may bind only IPv6 loopback on Windows.

Workspace free space is reported independently: below 256 MiB blocks a fresh build/start, and below 2 GiB is DEGRADED for broad QA. This prevents a new session from building into an already exhausted disk; it does not remove user data or promise sufficient headroom for every browser/container workload. Stop unnecessary test runs and reclaim only reviewed disposable artifacts when capacity is low.

Authentication/MFA, private profile storage reads, cart/order ownership, customer payment-capability responses, completed Stripe purchases, email provider acceptance/inbox delivery and real browser push require authenticated acceptance tests. They are deliberately NOT VERIFIED by unauthenticated health probes. An absent control record on a legacy runtime is NOT VERIFIED, not proof that its payments are disabled.

## Repeatable checks

```powershell
npm run test:runtime
npm run typecheck
npm run lint
npm run build
```

Runtime tests cover authentication, stale/conflicting ownership, duplicate startup, safe reuse, fixed ports, financial child failure, stop during preflight, email drain/restart/readiness and secret-free control responses. Development CI runs this suite after backend build. Isolated browser journeys use the existing release E2E infrastructure; their synthetic provider/capture results do not prove shared-DEV financial or email completion.
