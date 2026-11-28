# ElectroHub Vercel + Render Deployment Configuration

## Deployment topology

- Frontend: Vercel, repository root, Vite workspace build.
- API and Socket.IO: Render `electrohub-api`, Frankfurt, Free, Express and Node.js.
- AI gateway: Render `electrohub-ai`, Frankfurt, Free, Docker.
- Data: external Supabase PostgreSQL and private Storage.
- Provider mode: Stripe Test Mode only.

Production mutation, provider activation, and hosted deployment remain NO-GO until separate operator approval.

## Repository-verified Vercel settings

Use the repository root as the Vercel Root Directory.

| Setting | Value |
|---|---|
| Framework | Vite |
| Root Directory | `./` |
| Install Command | `npm ci` |
| Build Command | `npm run build --workspace=@electrohub/frontend` |
| Output Directory | `apps/frontend/dist` |
| Development Command | `npm run dev --workspace=@electrohub/frontend` |
| Node.js | 22.19.0 from `.nvmrc` |

The repository includes `vercel.json` and SPA fallback routing. Run `npm run validate:vercel` locally.

## Browser environment variables

Configure these only as build-time Vite variables:

- `VITE_API_BASE_URL`: exact public HTTPS origin of Render `electrohub-api`, with no `/api` path.
- `VITE_SOCKET_URL`: exact public HTTPS origin of Render `electrohub-api`, or omit it to reuse `VITE_API_BASE_URL`.
- `VITE_STRIPE_PUBLISHABLE_KEY`: Stripe Test Mode publishable key only.
- `VITE_IMAGE_SEARCH_ENABLED`: `false` unless the operator has separately approved public image search.

Set variables in Vercel for Production and approved Preview deployments. Development may leave API/socket variables unset to use the Vite proxy. Vite variables are public after compilation.

Never place database URLs, JWT/OTP secrets, Stripe secret/webhook credentials, Brevo keys, Supabase secret keys, AI shared secrets, or private artifact credentials in Vercel.

## Render Blueprint settings

| Service | Repository root | Runtime | Plan | Region | Health | Auto deploy |
|---|---|---|---|---|---|---|
| `electrohub-api` | `.` | Node 22.19.0 | Free | Frankfurt | `/health/ready` | Disabled |
| `electrohub-ai` | `.` | Docker | Free | Frankfurt | `/health` | Disabled |

The API build sequence in `render.yaml` installs root workspaces, generates Prisma, builds the frontend workspace, and builds the backend workspace. The Express server remains authoritative for `/api`, `/socket.io`, authentication, commerce, payment mutation, and Stripe webhooks.

## Split-origin runtime configuration

Set `FRONTEND_URL` to the exact canonical Vercel HTTPS origin. Set `CORS_ALLOWED_ORIGINS` only to additional exact approved origins, comma-separated. It must not contain wildcard Vercel hosts.

REST requests use `VITE_API_BASE_URL + /api/...`. Socket.IO uses `VITE_SOCKET_URL` or `VITE_API_BASE_URL`, namespace `/delivery`, and path `/socket.io`. Cross-origin production cookies use Secure and SameSite=None from the backend.

## OAuth

`GOOGLE_REDIRECT_URI` belongs to the Render API service:

`https://REPLACE_WITH_RENDER_API_HOSTNAME/api/auth/google/callback`

Register that exact URI in the Google OAuth Web application. `FRONTEND_URL` remains the Vercel origin. The provider dashboard and real callback cannot be verified without the operator-approved hostnames.

## Backend environment inventory

Runtime: `NODE_ENV`, `ELECTROHUB_ENV_FILES`, `DB_RUNTIME_URL_SOURCE`, `FRONTEND_URL`, `CORS_ALLOWED_ORIGINS`, `COMMERCE_EMAIL_ORIGIN`.

Database: `DATABASE_URL`, `DIRECT_URL`, optionally `DB_SSL_CA_CERT_PATH`.

Security: `JWT_SECRET`, `JWT_REFRESH_SECRET`, `OTP_HASH_SECRET`.

Google: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`.

Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PAYMENT_SHARED_MUTATIONS_APPROVED=false` until independently approved.

Email: `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`; keep enqueue, dispatch, send mode, and real-recipient actions disabled.

Storage: `SUPABASE_URL`, `SUPABASE_PROJECT_REF`, `SUPABASE_SECRET_KEY`, `PRODUCT_MEDIA_BUCKET`.

AI: `AI_SERVICE_URL`, `AI_SERVICE_API_KEY`, `AI_SERVICE_ENVIRONMENT`, `AI_SERVICE_TIMEOUT_MS`. Generate a separate strong value and configure the same secret on both services.

WebAuthn: `WEBAUTHN_RP_NAME`, `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN`. Set only after the Vercel hostname is approved; RP ID is the registrable domain, and origin is the exact HTTPS frontend origin.

Frontend build copies for the existing backend build: `VITE_API_BASE_URL`, `VITE_SOCKET_URL`, `VITE_STRIPE_PUBLISHABLE_KEY`, `VITE_IMAGE_SEARCH_ENABLED=false`.

## AI environment

The AI service keeps its existing Docker isolation and private artifact installer. Required release variables remain unset until separately approved: private download URL, release ID, production release SHA-256, archive SHA-256, and host trust pin. The restricted vector role, cache directory, and mounted read-only model paths remain separate deployment decisions.

Do not publish production artifacts or activate production inference as part of repository preparation.

## Operator dashboard sequence

1. Create or confirm the Vercel project at repository root and run `npm ci` plus the verified workspace build command.
2. Add only browser-safe Vite variables for Production and approved Preview environments.
3. Obtain the approved Vercel and Render hostnames.
4. Confirm the exact Supabase production project and least-privilege database/storage identities.
5. Generate and enter unique JWT, refresh, OTP, and AI shared secrets only in provider secret managers.
6. Configure Google OAuth with the exact Render API callback URI.
7. Configure a Stripe Test Mode hosted webhook endpoint and enter the endpoint-specific webhook secret.
8. Keep Brevo dispatch, payment mutations, AI activation, migrations, and auto-deploy disabled until separately authorized.

## Remaining blockers

- Final Vercel and Render hostnames are not verified.
- Supabase production project identity and backup/recovery state are not authenticated.
- Production database URLs and secrets do not exist in repository evidence.
- Stripe hosted webhook identity is not configured.
- Google OAuth provider callback is not registered.
- AI production release metadata and trust pin are not approved.
- Hosted Render memory, cold-start, CPU, and 512 MB feasibility are not measured.
- Docker image smoke test was not available locally.

Repository work is not hosted deployment approval.
