# ElectroHub Production TLS Lifecycle (Task 06.3B Candidate)

**Status: NOT AUTHORIZED / NOT VERIFIED.** This runbook describes repository-side DNS TLS preparation only. No hostname, public certificate, host, systemd unit, ACME request, or network listener was created or used. The current `tls.env.example` keeps both staging and renewal controls disabled.

## Trust and file layout

- Browser TLS terminates at the Nginx `edge` container. Express, FastAPI and workers remain on private Compose networks.
- Host TLS material lives under `/etc/electrohub/tls`; it is mounted read-only at `/etc/nginx/tls` and is absent from images/source archives.
- Versioned release directories contain `fullchain.pem` (`root:101`, mode `0644`) and `privkey.pem` (`root:101`, mode `0640`). UID/GID 101 is the non-root edge identity.
- `/etc/electrohub/tls/current` points to one immutable version directory. Renewal builds a new directory, validates certificate hostname, expiry and key match, atomically swaps the symlink, runs `nginx -t`, then reloads. A failed check/reload restores the previous pointer and attempts to reload it.
- Hostname configuration accepts a lowercase DNS FQDN only. Raw IP certificate issuance is not implemented here.

## First boot and staging

1. Obtain separate written approval for the exact hostname, public TCP/80 ACME challenge listener, and controlled staging test. This repository task grants none of those actions.
2. Install Docker Compose, Certbot, OpenSSL, systemd units/scripts and the root-owned environment file using an operator-reviewed host bootstrap procedure. Install the release source below `/var/lib/electrohub/current/source`; the units invoke scripts from that exact release path. Do not place private keys in the repository, Compose env file, image, or Actions artifact.
3. Validate DNS A/AAAA records resolve to the approved host. `bootstrap-staging-certificate.sh` starts only the `edge-acme-bootstrap` profile, serves the HTTP-01 challenge directory, requests a staging certificate, invokes the co-located guarded installer, then stops the challenge container on exit. It does not serve the app.
4. Set `ACME_STAGING_ONLY=true` in the root-owned `/etc/electrohub/tls.env` only for the approved test. The script reads that file itself and fails closed when it is missing or the opt-in is false. The resulting certificate is installed atomically but is not browser-trusted. Start the HTTPS edge only for a separately controlled test; do not use this staging certificate for public users.
5. Review Nginx configuration and first-boot behavior on a controlled host with a test certificate before considering any public certificate or app listener.

`bootstrap-staging.sh` also refuses by default, reads the root-owned TLS environment file, and can issue/install only a staging certificate against an already available challenge webroot. Both helpers use the installer adjacent to their source; `renew.sh` similarly invokes its adjacent deploy hook and installer. The systemd units call the current release's repository scripts under `/var/lib/electrohub/current/source/infrastructure/production/tls/` rather than paths that this repository never installs. No public-certificate issuance helper is included; public issuance needs a separate approval and reviewed procedure.

## Renewal and expiry monitoring

- Renewal uses `certbot renew` every six hours with a deploy hook. Certbot itself renews only eligible lineages; the installer validates each renewed lineage and atomically reloads Nginx.
- `TLS_RENEWAL_ENABLED` defaults to `false`. The systemd service's failure unit writes a `logger` event to the host journal/syslog.
- The expiry checker runs every six hours and fails when the current certificate is missing, for another hostname, or within the configured 72-hour warning window.
- Certbot's distro-provided timer should be reviewed before enabling the candidate timer to avoid overlapping schedules. `flock` prevents concurrent ElectroHub renewal runs.
- Local logging is not an external alert. External monitoring, expiry probes, failure paging, timer installation, log retention and host-outage detection remain required before production use.

## Recovery

For a failed renewal/reload, keep the old worker process available, point `current` at the previous version directory, run `nginx -t`, then reload. If both configs fail, stop public HTTPS traffic at the host firewall/load balancer and restore a known-good certificate/config from operator-controlled backup. Confirm certificate/key pairing and hostname before reopening. Never fall back to plaintext app traffic or a self-signed browser certificate.

The installer records neither ACME account credentials nor private-key bytes in logs. It retains prior certificate directories so the operator can inspect and restore a previous pointer. A bounded retention/secure deletion policy for expired private keys must be established on the host.

## Candidate files and verification limit

- `infrastructure/production/tls/bootstrap-staging.sh`
- `infrastructure/production/tls/install-certificate.sh`
- `infrastructure/production/tls/renew.sh`
- `infrastructure/production/tls/certbot-deploy-hook.sh`
- `infrastructure/production/tls/check-expiry.sh`
- `infrastructure/production/tls/electrohub-certbot-renew.{service,timer}`
- `infrastructure/production/tls/electrohub-tls-expiry-check.{service,timer}`
- `infrastructure/production/tls/electrohub-tls-alert@.service`

Static policy tests cover fail-closed defaults, staging-only bootstrap, host/key/expiry checks, atomic switch and rollback calls, and service-script path wiring. Certbot, OpenSSL against real cert fixtures, systemd, Docker, Nginx syntax/reload, public DNS/ACME, timers and notifications were not run or verified in this environment.
