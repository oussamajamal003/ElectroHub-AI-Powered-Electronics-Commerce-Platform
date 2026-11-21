# Task 06.3 Prompt 2 Handoff Checklist

## Status: NOT AUTHORIZED / BLOCKED

This checklist records gates for a later operator-approved deployment task. It grants no permission to purchase, register DNS, provision a host, issue a public certificate, access/mutate PROD, configure providers, enable dispatch, expose a service, or deploy.

### Architecture and hostname

- [ ] Principal reviewer approves or returns the repository design decision in `TASK_06.3_SINGLE_ORIGIN_VPS_DESIGN.md`.
- [ ] Operator confirms whether implemented Google customer OAuth is required for this release.
- [ ] If keeping the no-purchase constraint, operator separately approves an exact hostname/account investigation. Google authorized-domain and Search Console proof succeeds on that exact hostname.
- [ ] Canonical HTTPS origin and DNS ownership/lifecycle are recorded; no IP OAuth callback is used.
- [ ] Browser testing proves exact origin and no third-party-cookie dependency.

### Capacity and host

- [ ] Candidate host size is selected only after capacity evidence; $6 / 1 GiB is not approved and is assessed infeasible for the current full stack.
- [ ] A separately approved host experiment measures idle/startup/model load/inference/API/browser, memory, swap, CPU, disk, logs, failures and stop criteria.
- [ ] Resource limits are based on measurements and retain safe operating headroom.
- [ ] Host firewall, OS patching, SSH identity, Docker daemon, user/group permissions and backups are reviewed.

### TLS, release and rollback

- [ ] Staging ACME/bootstrap, public certificate installation, renewal, expiry/failure alert, reload rollback and first-boot recovery are tested on a controlled host.
- [ ] External alerting exists; local `logger` output alone is not operational notification evidence.
- [ ] GitHub `electrohub-production-deploy` Environment reviewers, secret scopes and exact-SHA workflow permissions are inspected read-only.
- [ ] Immutable base image digests/provenance and artifact retention/storage plan are reviewed.
- [ ] Initial deployment path is documented and separately approved. Current script requires a prior healthy release and cannot perform first install.
- [ ] A recent PROD backup record and restore evidence exist; database migration is separately approved/executed by its own gate.

### Application and data safety

- [ ] Exact public browser matrix passes for Chromium, Firefox and WebKit/Safari-equivalent: customer/admin login, expiry refresh, concurrent/tab refresh rotation/reuse, reload, logout, protected paths, CSRF/untrusted Origin, OAuth, socket WebSocket/polling/reconnect and delivery namespace.
- [ ] Nginx syntax, production Compose config, image builds, network exposure, process identity, readiness and rollback are runtime-tested.
- [ ] Stripe Test Mode endpoint and raw-body signature are proven with fixtures or separately authorized provider setup.
- [ ] Brevo canonical links verified without sending real messages; dispatch remains explicitly gated.
- [ ] AI artifact bytes, PROD project/region, applied vector schema, active compatible index and readiness are verified through separately authorized read-only/controlled procedures. No DEV data is copied.
- [ ] Admin bootstrap/one-time migration is reviewed and tested on a disposable database; any PROD migration/bootstrap requires a separate written authorization.
- [ ] Security scan and exact-SHA CI are successful; no secrets or customer data appear in image layers, bundles, logs or artifacts.

### Explicit authorization required before any operator action

After the above evidence is reviewed, the operator must separately approve each required action: hostname registration/account, public DNS, public certificate issuance, VPS/resource creation or extension, protected GitHub secrets/environment setup, PROD read access, migrations, admin bootstrap, provider changes, worker dispatch and deployment. Approval of this checklist or the repository design alone is not deployment approval.
