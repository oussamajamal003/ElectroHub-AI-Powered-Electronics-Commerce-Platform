# Task 06.3C — TLS Lifecycle Verification

**Review date:** 2026-11-19  
**Scope:** Repository changes and local static policy checks only. No certificate was requested, issued, installed on a public host, or placed in an image.

## Result

The repository's local TLS lifecycle wiring has been corrected and its policy tests pass. A complete certificate lifecycle is **UNVERIFIED**: this environment has no Docker, Nginx, Certbot, OpenSSL, systemd, public endpoint, or certificate material. Static shell text checks do not prove ACME issuance, renewal, Nginx reload, expiry alert delivery, or recovery on a host.

## Corrections made

- `infrastructure/production/tls/renew.sh` now invokes its adjacent deploy hook using `/bin/bash`; the prior `/usr/local/sbin/electrohub-certbot-deploy-hook` target was not installed by the repository.
- The deploy hook invokes the adjacent certificate installer. Renewal and expiry systemd unit templates now reference scripts under `/var/lib/electrohub/current/source/infrastructure/production/tls/` rather than nonexistent `/usr/local/sbin` paths.
- The first-certificate helper sources the configured root-owned TLS environment file, resolves its installer alongside the script, and requires the explicit staging-only setting before it starts the ACME challenge edge. It has a cleanup trap and installs only the staging result.
- The certificate installer retains validation of the configured DNS host, certificate validity and certificate/private-key match before switching the live symlink. It installs through a temporary path and validates the Nginx configuration before graceful reload; failure leaves the prior live link available for recovery.
- Renewal and expiry timers remain disabled unless an operator explicitly enables them. No production host bootstrap has been run.

Private certificate/key material is ignored by Git; reviewed TLS source files are allow-listed. The focused test confirms this ignore policy and checks staging-only behavior, script wiring, validation and disabled-by-default units. A local check does not prove host filesystem ownership/modes or Nginx behavior.

## Local evidence

Command:

```text
node --test infrastructure/production/tls/tls-lifecycle-policy.test.cjs
```

Result: **6/6 passed** (including the host deploy-command policy test when run together). `git diff --check` passed with line-ending conversion warnings only. These tests inspect repository policy/source; they do not execute Certbot or Nginx.

## Hostname and ACME implications

- The repository candidate supports a DNS hostname and DNS HTTP-01 challenge. It rejects an IP address and validates the certificate against the configured hostname.
- Let's Encrypt documentation currently describes the standard profile as 90 days and the short-lived profile as 160 hours. Its IP-certificate flow requires the short-lived profile. Certbot added IP-address support in 5.3; its webroot support requires 5.4 or later. This repository does not implement the IP-address flow.
- An IP certificate would not resolve the required Google OAuth hostname restriction. The conditional DNS hostname decision is recorded separately in `TASK_06.3C_HOSTNAME_OAUTH_DECISION.md`.
- The official rate-limit page currently lists limits including 300 new orders/account/3 hours, 50 certificates per registered domain/week, and 5 certificates per exact identifier set/7 days. Use the ACME staging service for repeatable integration checks; do not consume production issuance quota for a test.

## Lifecycle gaps and later authorized proof

1. On an approved isolated host, install the root-owned TLS environment file and scripts with restrictive ownership/modes; verify the ACME client version and the selected DNS challenge.
2. Use the ACME staging directory to test first bootstrap from an empty certificate directory, challenge cleanup, validation, atomic installation, Nginx config test, graceful reload, and preservation of the last valid certificate after a deliberately failed staging attempt.
3. Verify timer activation and next-run schedule, run a staging renewal, and confirm Nginx serves the new serial without dropping existing connections.
4. Verify expiry monitoring and an operator-visible alert channel. Current expiry scripts write a local systemd/journal failure; external alert delivery is not configured or demonstrated.
5. Exercise recovery by restoring the previous certificate symlink and config, then verify Nginx reload. Record service output without secrets.
6. Only after separate authorization, perform a public-endpoint challenge and confirm Google callback reachability. This proves hostname-specific DNS/TLS behavior, not general production readiness.

## Official sources (reviewed 2026-11-19)

- [Let's Encrypt certificate lifetimes](https://letsencrypt.org/docs/cert-lifetimes/)
- [Let's Encrypt certificate profiles](https://letsencrypt.org/docs/profiles/)
- [Let's Encrypt Certbot support for IP certificates](https://letsencrypt.org/2026/03/11/shorter-certs-certbot)
- [Let's Encrypt rate limits](https://letsencrypt.org/docs/rate-limits/)
- [Certbot documentation](https://eff-certbot.readthedocs.io/en/stable/)

**Status:** repository wiring corrected; static policy tests pass; public TLS lifecycle and alert/recovery remain **UNVERIFIED**. No public certificate or host change is authorized by this report.
