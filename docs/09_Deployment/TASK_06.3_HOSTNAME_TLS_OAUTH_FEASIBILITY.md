# Task 06.3B — Hostname, TLS and OAuth Feasibility

**Reviewed:** 2026-11-17. No hostname was registered, no DNS was changed, no certificate was issued, and Google OAuth configuration was not accessed.

## Decision

**Hostname outcome: CONDITIONAL.** A no-cost DNS name can plausibly support HTTPS and may permit DNS ownership verification, but no exact candidate/account was selected and Google Cloud OAuth authorized-domain acceptance has not been tested. The implemented Google sign-in callback remains a product feature; it cannot be dropped or redirected to a raw IP just to avoid this gate.

| Candidate | Cost / stability | HTTPS | Google OAuth ownership and redirect | Commercial/operational risk | Result |
|---|---|---|---|---|---|
| DuckDNS delegated subdomain (example shape only; none selected) | Provider describes its dynamic DNS service as free. An account can update its A/AAAA mapping over HTTPS. It is a provider subdomain and depends on continued account/service availability; exact persistence/reclamation terms were not established. | Standard ACME DNS name is compatible in principle. HTTP-01 can use the provided hostname and fixed Droplet IP; DNS-01 is also possible, but provider TXT support is one shared TXT record for the name and subdomains. No Certbot/DuckDNS automation was run. | Google requires HTTPS callback URI, exact URI match and an authorized domain. DuckDNS exposes a TXT API that could attempt Search Console DNS ownership verification for the delegated name, but the Google Cloud OAuth consent-screen acceptance of this provider subdomain and exact callback is **NOT VERIFIED**. | Terms do not expressly bar lawful commerce in the reviewed text, but provider provides no availability guarantee; DNS account/token compromise, suspension, record outage or hostname reclamation can redirect or strand the origin. | **Conditional candidate.** Only consider after operator-approved account/hostname selection and real Google verification. |
| EU.org delegated subdomain | Registration is free but requires configured nameservers and human validation that may take days; approval time and name availability are not guaranteed. | Delegated DNS can support ACME once approved and pointed to the server. No registration or certificate was made. | Nameserver control plausibly permits DNS ownership proof, but Google Cloud OAuth verification and consent-screen acceptance of the exact delegated hostname remain unverified. | EU.org says small commercial sites are accepted but strongly asked to use it only as a last resort; registration grants no legal rights. Manual approval and registry continuity are risks. | **Conditional candidate; not preferred for a commerce site.** |
| Raw VPS IPv4/IPv6 address | No DNS service needed; address lifecycle is tied to the VPS. | Let’s Encrypt now supports IP SANs using the `shortlived` profile. The shortlived certificate is 160 hours (~6.7 days); Certbot 5.4+ has webroot IP issuance, but Certbot does not install these automatically. Our edge hostname contract intentionally rejects IP literals and the candidate installer is DNS-hostname-oriented. | Google production web-server OAuth callback rules reject raw-IP redirect hosts (apart from localhost development). It cannot support the implemented Google callback. | A Droplet replacement can change the address; OAuth, Stripe webhooks, email URLs, allowlists and TLS all become coupled to that address. Renewal failure can break all browser access within days. | **NO-GO while Google OAuth is a required feature.** |
| Cloudflare Pages `*.pages.dev` + same-origin Pages Function/Worker proxy to a VPS | Static Pages can use a provider-generated hostname with free static requests; Pages Functions share Workers Free limits (100,000 combined daily requests). No custom domain is needed for a Pages hostname. | Cloudflare manages TLS for Pages hostname. The worker would proxy API and Socket.IO to a separate VPS origin. No code or route was deployed. | The browser could see one origin if the Pages function forwards REST, cookies and Engine.IO traffic on that hostname. The hostname is provider-controlled; the operator cannot set DNS TXT on `pages.dev`, and Search Console/OAuth authorization has not been proven. | Additional trust boundary and release/failure domains. Worker free plan has daily request/CPU/subrequest limits; exhaustion can fail closed. WebSocket proxying is supported by Workers APIs in general but Pages-function path and raw webhook/cookie/reconnect behavior are untested. The VPS capacity problem remains. | **Conditional topology only; not a presently proven full-feature alternative.** |

No option receives GO until exact Google Cloud authorization, hostname control and browser callback are proven for the selected hostname. Cloudflare’s temporary `trycloudflare.com` Quick Tunnels are explicitly for testing/development; the URL is random and stops with the process, so they are not a production hostname candidate.

## Google OAuth contract

Current repository code and production validation require:

- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REDIRECT_URI` configured as a complete set if OAuth is enabled.
- `FRONTEND_URL` is the canonical HTTPS origin.
- Callback is exactly `${FRONTEND_URL}/api/auth/google/callback`.
- Google transaction flow uses state, nonce, PKCE S256 and a short-lived host-only, HttpOnly, production-Secure, SameSite=Lax transaction cookie.
- OAuth browser return, callback cookie and provider-configured redirect URI use the same selected origin.

Google's official web-server OAuth rules require secure redirect URIs (except localhost development), exact redirect matching, and disallow raw IP production redirect hosts. OAuth policy requires an authorized domain; production readiness checks require verification of applicable domains. Google Search Console domain-property verification uses DNS TXT control and Google OAuth branding/consent configuration has its own requirements. DNS API capability alone does not prove Google OAuth acceptance.

## TLS lifecycle and operational readiness

The repository candidate in `infrastructure/production/tls/` is for a DNS hostname. It provides:

1. An ACME-only HTTP bootstrap edge; no app fallback is served before a certificate exists.
2. A staging-only Certbot webroot bootstrap script; it refuses by default and has no public-certificate issuance path.
3. Certificate host/key/expiry checks and root-owned, group-readable versioned files outside images/source.
4. An atomic `current` symlink switch, Nginx syntax test, graceful reload and pointer rollback on rejection.
5. A six-hour Certbot renewal timer and 72-hour local expiry check.
6. Six-hour systemd candidate timers with `OnFailure` logger units and a manual recovery description in [the TLS lifecycle runbook](TLS_LIFECYCLE.md).

The local alert is only in host logs. No email, paging or external monitor has been configured; a host-wide outage can hide the alert. The scripts and units were not installed or executed. First boot, certificate issuance, renewal, timer failure, stale pointer, reload rollback and outage recovery are therefore **NOT VERIFIED**. There is no user-authorized public certificate request in this task.

For an IP certificate, the 160-hour lifetime requires a separate Certbot flow (`--ip-address` and `--preferred-profile shortlived`) and explicit install/reload automation; the current scripts reject IP names and do not claim support. The routine six-hour schedule would provide frequent retries only after the client considers the cert renewable; it is not proof that the short-lived lifecycle is reliable.

## Official references (accessed 2026-11-17)

- [Google OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server?hl=en)
- [Google OAuth policy](https://developers.google.com/identity/protocols/oauth2/policies)
- [Google OAuth production readiness / policy compliance](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance?hl=en)
- [Google domain verification](https://support.google.com/cloud/answer/13804266?hl=en)
- [Google OAuth branding configuration](https://support.google.com/cloud/answer/15549049?hl=en)
- [DuckDNS API and TXT record API](https://www.duckdns.org/spec.jsp), [DuckDNS terms](https://www.duckdns.org/tac.jsp), and [service description](https://www.duckdns.org/why.jsp)
- [EU.org registration instructions](https://nic.eu.org/register.html) and [EU.org general policy](https://nic.eu.org/policy.html)
- [Let's Encrypt IP/six-day Certbot support](https://letsencrypt.org/2026/03/11/shorter-certs-certbot) and [shortlived profile details](https://letsencrypt.org/docs/profiles/)
- [Cloudflare Pages Function routing](https://developers.cloudflare.com/pages/functions/routing/), [Functions pricing](https://developers.cloudflare.com/pages/functions/pricing/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Worker WebSockets](https://developers.cloudflare.com/workers/runtime-apis/websockets/) and [Quick Tunnel limits](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)
