# Task 06.3C — Hostname and Google OAuth Decision

**Access date:** 2026-11-19  
**Decision:** **CONDITIONAL**  
**Scope:** Public documentation research only. No hostname was claimed, no account was created, and no Google Cloud or Search Console setting was changed.

## Decision summary

There is a credible $0 hostname candidate for Option B: a user-controlled DuckDNS subdomain. DuckDNS documents free dynamic DNS and a TXT update API over HTTPS; the current Public Suffix List includes `duckdns.org` in its private section. That makes a subdomain such as `chosen-name.duckdns.org` appear structurally eligible for Google's hostname and ownership flow. It does **not** prove that Google will accept that exact shared-provider name for ElectroHub's production OAuth consent screen. The operator still needs to claim an available name, verify it in Search Console as an owner associated with the Google API project, and confirm the exact authorized domain and callback in Google's console.

The host provider's terms allow account/domain suspension or takeover without notice and provide no production SLA in the reviewed material. Commercial-use permission and free sign-up/payment-method requirements were not conclusively established. Therefore the candidate is not a production hostname decision.

## Candidate assessment

| Candidate | $0 / hostname lifecycle | Google OAuth evidence | HTTPS | Decision |
|---|---|---|---|---|
| DuckDNS subdomain for the VPS | DuckDNS describes its DDNS service as free and supports HTTPS A/AAAA and TXT updates. No name was checked or registered. Terms permit termination/suspension without notice; no SLA or stable-renewal guarantee was found. | `duckdns.org` is in the PSL private section, and DuckDNS exposes a TXT update API. Google's rules require an HTTPS redirect URI, a PSL-recognized host suffix, an exact registered callback, and domain ownership verification. Exact provider-hostname acceptance is untested. | DNS-based HTTP-01 is technically compatible with the existing candidate flow; actual challenge reachability and public renewal were not tested. | **CONDITIONAL; best fit for B if operator verification succeeds.** |
| Cloudflare Pages `*.pages.dev` + Pages Function/Worker proxy | Cloudflare assigns a unique `pages.dev` subdomain; static asset requests are listed as free and unlimited. Pages Functions count against Workers Free quotas. `pages.dev` is listed in the PSL private section. No account or project was created. | A Search Console URL-prefix property can be verified through site content methods, but Google OAuth's acceptance of a shared `pages.dev` hostname as the authorized top-private domain remains unverified. The project hostname cannot be changed in place per current Pages documentation. | Cloudflare manages TLS for the provided Pages hostname. The VPS origin still needs a secure authenticated transport; the current repository design has no Worker proxy, origin credential, or IP-certificate flow. | **Conditional alternative topology; not selected or implemented.** |
| Raw VPS IP | No purchased domain is needed. | Google explicitly disallows raw IP redirect hosts except localhost. This does not satisfy required production Google OAuth. | Let's Encrypt supports IP certificates using the short-lived profile and Certbot 5.4+ webroot support. Current repository scripts are DNS-only and do not implement that flow. | **NO-GO as the complete required product origin.** |

## Documented facts and interpretation

### DuckDNS

- DuckDNS calls the service free dynamic DNS and documents HTTPS record updates, including a TXT API. The token appears in the update URL and must be treated as a secret if an operator later enables automated DNS changes. The TXT value is shared across sub-subdomains under the same DuckDNS name.
- DuckDNS's reviewed terms, last updated 2018-12-14, state the provider may remove, lock, take over, terminate, or suspend an account/domain with or without notice. A durable production hostname or service-level availability commitment is therefore not established.
- The PSL snapshot dated 2026-11-17 lists `duckdns.org` under the private section. **Inference:** a user-controlled immediate subdomain may be treated as its own registrable/top-private domain. Only Google Search Console and OAuth console acceptance can confirm this for the actual name.
- No payment-method requirement, name availability, commercial-use permission, automated renewal commitment, DNS propagation time, or provider support guarantee was verified. Do not interpret “free service” as a production SLA.

### Google OAuth

- Google's web-server documentation requires the redirect URI to exactly match an authorized URI. Production redirect URIs require HTTPS, cannot use raw IP hosts, and must use a host whose TLD is on the Public Suffix List.
- Google's brand-verification documentation requires the top private domains used in app homepage, privacy, terms, JavaScript origins, and redirect URIs to be listed as authorized domains and ownership verified through Search Console.
- The repository validates `GOOGLE_REDIRECT_URI` against `FRONTEND_URL` and `/api/auth/google/callback`. For the single-origin design, the eventual URI must be `https://<operator-approved-host>/api/auth/google/callback`. The `state`, nonce, PKCE and callback checks remain required. None were relaxed or disabled.
- **Interpretation:** DuckDNS can expose a DNS TXT update mechanism that may satisfy Search Console domain ownership, but Google does not document an endorsement of DuckDNS or guarantee acceptance of shared-provider hostnames. This remains an operator/provider test.

### Cloudflare same-origin alternative

A Pages site can serve the SPA at a provider-generated hostname while a Pages Function/Worker forwards `/api/*` and `/socket.io/*` to a VPS. If implemented correctly, the browser sees one origin; host-only cookies set by Express through the proxy would be scoped by the browser to the Pages hostname. WebSocket proxying is supported by the Workers runtime, but close-frame handling and long-lived connection behavior need implementation and testing. Free Workers documentation currently lists 100,000 requests/day and 10 ms CPU per invocation; every dynamic Pages Function request counts against that quota. Static asset requests are free and unlimited.

The current backend would need a pinned and authenticated origin path, trusted-forwarded-header handling, Stripe raw-body preservation, Socket.IO upgrade/polling support, exact `FRONTEND_URL`/OAuth/email callback configuration, and browser-origin verification. This repository has none of that Worker code. The origin TLS route also remains unresolved: the generated Pages hostname is not a DNS zone ElectroHub controls, and the current TLS scripts accept only DNS names. An IP-certificate origin is possible per current Let's Encrypt/Certbot documentation but expires after 160 hours and is not implemented here.

## Required operator verification before selecting a hostname

After separate approval for account/provider interaction (not included here):

1. Confirm a chosen provider's free-plan eligibility, terms for the intended production use, account recovery, hostname retention, and payment-method requirements.
2. Claim a candidate name only after explicit authorization. For DuckDNS, confirm record updates and controlled ownership TXT verification; store the update token outside the repository with restrictive permissions.
3. Add the candidate site's public homepage, privacy policy and terms, and verify the exact top-private domain in Search Console using an account associated with the Google API project.
4. In a separately approved Google Cloud review, confirm the exact authorized domain, JavaScript origin, and `https://<host>/api/auth/google/callback` redirect URI are accepted. Do not change credentials or provider settings as part of this report.
5. Reconfirm DNS resolution, account recovery, name stability, and TLS renewal alert/recovery with an isolated staging challenge.

If Google rejects the free shared hostname, the safe choices are to approve an already-owned or purchased domain and its ongoing cost, or request a formal specification decision. Google OAuth remains required; this report does not authorize removing it.

## Official sources (reviewed 2026-11-19)

- [Google OAuth web-server application and redirect URI rules](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Google OAuth production domain and ownership verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)
- [Google OAuth policies on domains the app owns or is authorized to use](https://developers.google.com/identity/protocols/oauth2/policies)
- [DuckDNS API specification](https://www.duckdns.org/spec.jsp)
- [DuckDNS terms of use](https://www.duckdns.org/tac.jsp)
- [Public Suffix List](https://publicsuffix.org/list/public_suffix_list.dat) — version `2026-11-17_16-14-34_UTC`; `duckdns.org` and `pages.dev` are listed in the private section.
- [Cloudflare Pages provided hostname](https://developers.cloudflare.com/pages/framework-guides/deploy-anything/)
- [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/)
- [Cloudflare Workers Free plan limits and pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Cloudflare Workers WebSocket proxying](https://developers.cloudflare.com/workers/runtime-apis/websockets/)
- [Let's Encrypt certificate profiles](https://letsencrypt.org/docs/profiles/) and [IP certificate Certbot support](https://letsencrypt.org/2026/03/11/shorter-certs-certbot)

