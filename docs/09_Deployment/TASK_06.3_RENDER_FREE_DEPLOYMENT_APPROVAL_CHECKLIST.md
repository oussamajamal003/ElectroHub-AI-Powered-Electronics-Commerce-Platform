# Render Free Deployment Approval Checklist

This checklist does not authorize deployment. Each item requires separate explicit operator approval.

## Deployment gate

- [ ] Operator confirms Render Hobby/Hobby-equivalent account and workspace eligibility.
- [ ] Operator confirms no payment method, paid upgrade, persistent disk, paid datastore or domain purchase is required.
- [ ] Operator authorizes applying `render.yaml` to create or change only the two named Free web services.
- [ ] Operator confirms exact repository branch and immutable source SHA; `render.yaml` pins `feature/06.3-production-infrastructure` and `npm run validate:render` passes.
- [ ] Operator confirms `electrohub-api` and `electrohub-ai` names do not collide with existing resources.
- [ ] Operator confirms intended Render region from measured Supabase and external-service latency.
- [ ] Operator confirms no automatic deploy is enabled before review.

## Database gate

- [ ] Existing PROD Supabase project identity and region are verified without mutation.
- [ ] Prisma runtime and migration connection methods are verified.
- [ ] TLS and CA requirements are verified.
- [ ] Pending migrations are listed and separately approved.
- [ ] pgvector and restricted AI role state are verified.
- [ ] Required backup/export availability is verified.
- [ ] Restore test is separately approved and witnessed.

## Secret gate

- [ ] `FRONTEND_URL` is the exact HTTPS public origin.
- [ ] `DATABASE_URL`/`DIRECT_URL` point only to approved PROD Supabase targets.
- [ ] JWT, refresh and OTP secrets are independently generated and strong.
- [ ] `PAYMENT_SHARED_MUTATIONS_APPROVED` is set only after the exact observed PROD Supabase target identity is independently approved.
- [ ] Stripe variables are Test Mode only.
- [ ] Brevo sender/API variables are verified without real delivery.
- [ ] OAuth callbacks and WebAuthn origins match the exact public origin.
- [ ] AI service key is unique and shared only between Express and FastAPI.
- [ ] Supabase Storage secrets are restricted and never placed in `VITE_*` variables.
- [ ] Admin MFA and seed-administrator controls remain disabled or absent as required.

## AI gate

- [ ] Model, relevance and manifest hashes are verified against approved release evidence.
- [ ] Model artifacts can be distributed without baking them into the repository or public image.
- [ ] Read-only PROD vector role and index coverage are verified.
- [ ] AI startup RSS/cold-start/CPU are measured on the exact 512 MB service.
- [ ] AI public service authentication and Express timeout behavior are verified.
- [ ] AI activation is separately approved.
- [ ] AI rollback returns the service to an honest unavailable state or a verified prior release.

## Integration gate

- [ ] Stripe hosted webhook endpoint is approved and uses Test Mode.
- [ ] Stripe live publishable/secret keys are absent.
- [ ] Brevo sender is verified and recipient allowlist is bounded.
- [ ] No real email is sent during smoke testing.
- [ ] Google OAuth provider callback is approved and exact.
- [ ] Supabase Storage public/private policies preserve product media.
- [ ] Maps use approved HTTPS tile configuration and attribution.
- [ ] Socket.IO CORS, credentials and reconnection behavior are verified.

## Hosted verification gate

- [ ] Public HTTPS and SPA routes pass.
- [ ] Customer and admin authentication pass.
- [ ] Commerce, Test Mode checkout, order and recovery flows pass.
- [ ] AI behavior is measured or honestly unavailable.
- [ ] WebSocket reconnect and cold-start behavior are measured.
- [ ] Browser and mobile matrix is completed.
- [ ] Low-concurrency load test is separately approved and bounded.
- [ ] Rollback is tested without destroying data or provider configuration.

## Explicit decision

Only after every mandatory gate passes may an independent reviewer choose GO or CONDITIONAL GO. Until then the decision remains **STRICT NO-GO**.
