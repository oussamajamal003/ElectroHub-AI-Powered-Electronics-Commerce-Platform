# Production Administrator Bootstrap

This is a one-time operator procedure for a PROD project with **zero** administrator accounts. It does not create default credentials and does not expose a public admin-registration route. It reuses the existing hashed, short-lived, single-use admin invitation flow and mandatory first-factor/MFA enrollment.

## Safety contract

- Verify the exact PROD project identity and region using the approved read-only preflight. The CLI separately pins both PostgreSQL URLs and Storage project identifiers to `yepfgjehdstlxbpespun`.
- Verify the administrator count and inspect identities using the approved safe read-only procedure. Never delete an account based on a guessed address; do not bootstrap if any ADMIN already exists.
- Do not invite `admin@electrohub.com`, `admin1@electrohub.com`, `admin2@electrohub.com`, or another DEV/test identity. The service rejects the known seed addresses.
- Obtain explicit operator authorization and record its ticket/change reference. The CLI prompts for this reference and requires typed confirmation of the PROD project and recipient.
- Confirm `FRONTEND_URL` and `COMMERCE_EMAIL_ORIGIN` resolve to the approved public HTTPS storefront origin. The invitation link uses the existing email origin. The Task 06.3 browser-origin gate must be GO before any public sign-in or production email is enabled.
- Use the production runtime DB role only; never provide a migration, owner or service-role DB credential to this command.
- The one-hour invitation token is random, stored only as a SHA-256 digest, delivered to the explicitly entered recipient, and never printed. A bootstrap invitation cannot be accepted if any ADMIN appears after issuance. The accepting account becomes the initial Owner and must complete first-factor enrollment before sign-in.
- `admin_invitations.isBootstrap` preserves the one-time completion marker. A second bootstrap is refused even if the initial account is later deactivated or deleted. No PROD account is created by merely building or starting the application.

## Operator steps

1. Complete the read-only PROD identity, region, administrator-count, migration and backup preflight. If any administrator exists, stop and use the existing owner-managed invitation flow.
2. Confirm the approved storefront/email HTTPS origin and browser/session release gate. Confirm the exact-SHA image/release that contains the bootstrap CLI and schema.
3. Load only the protected runtime environment and Compose interpolation file on the authorized host. Keep `ADMIN_BOOTSTRAP_ENABLED=false` in the persistent runtime template.
4. From the repository/runtime release directory, run a one-off API container with no dependencies or published ports. Example (use the host's protected, untracked Compose env file):

   ```sh
   docker compose -f infrastructure/production/compose.yaml \
     --env-file /etc/electrohub/compose.env \
     run --rm --no-deps --interactive --tty \
     -e ADMIN_BOOTSTRAP_ENABLED=true api node dist/admin-bootstrap.cli.js
   ```

   The service uses the pinned release image, the existing backend API runtime env file, and the private application network. It does not start the normal API service, publish ports, run migrations or enable payment/email/push workers.
5. Enter the approved recipient and authorization reference only at the interactive prompts. Type the exact confirmation shown. The script prints only the invitation ID, delivery state, expiry and pinned project reference. It never prints the token, full URL, recipient, DB URL or provider error.
6. Confirm delivery through the recipient mailbox without forwarding or logging the invitation URL. The recipient sets their own password, then completes the required MFA enrollment. Do not send test/bulk invitations.
7. After acceptance, verify the bootstrap audit record and Owner/MFA state using an approved read-only check. Set `ADMIN_BOOTSTRAP_ENABLED=false` again in any operator shell/environment and retain only redacted evidence. The accepted marker remains in the DB and prevents another bootstrap.

If delivery fails or the invitation expires before acceptance, the record remains auditable. A retry requires a new operator authorization reference and typed confirmation; the previous pending record is revoked before the new one is issued. Do not manually edit invitation rows or tokens.

## Status for Task 06.3

Repository implementation is present, but no PROD identity/count query, migration, invitation, email, account creation or MFA operation was performed. The migration adding `isBootstrap` is additive and has not been applied to PROD. The procedure remains unusable until its normal database migration is separately reviewed/approved and the production browser-origin gate is GO.
