# Render Free Environment and Secret Inventory

## 1. Responsibility split

- Local frontend: `apps/frontend/.env.local`.
- Local backend: `apps/backend/.env` or `.env.local`.
- Local AI: `apps/ai-service/.env` or `AI_ENV_FILE`.
- Render runtime: variable values in each Render service's Environment settings.
- GitHub Actions: only workflow/deployment credentials explicitly required by an approved workflow.
- `.env.example`: names and safe placeholders only.
- Never use `VITE_*` for private credentials.

## 2. Frontend variables

Actual frontend code currently confirms:

| Variable | Use | Classification | Render location |
|---|---|---|---|
| `VITE_STRIPE_PUBLISHABLE_KEY` | Stripe Test Mode publishable key | Public, must start `pk_test_` | Static Site build environment |
| `VITE_IMAGE_SEARCH_ENABLED` | Enables image-search client behavior | Public build flag | Static Site build environment |
| `VITE_MAP_TILE_URL` | HTTPS XYZ tile template | Public build variable | Static Site build environment |
| `VITE_MAP_ATTRIBUTION` | Map attribution text | Public build variable | Static Site build environment |
| `VITE_MAP_ATTRIBUTION_URL` | Optional HTTPS attribution link | Public build variable | Static Site build environment |

API calls and Socket.IO currently use relative `/api` and `/socket.io` paths. `VITE_API_URL` appears in `.env.example` but is not a confirmed active API-base implementation variable; the next agent must verify or remove that example only after source search and tests.

## 3. Backend runtime variables

Core validated variables:

| Variable | Purpose | Public/private | Production requirement |
|---|---|---|---|
| `NODE_ENV` | Runtime mode | Private | `production` |
| `PORT` | Render-supplied listen port | Private runtime | Required by Render |
| `DATABASE_URL` | Prisma runtime datasource | Secret | Existing PROD Supabase pooled/session URL |
| `DIRECT_URL` | Prisma CLI/migrations | Secret | Existing PROD direct/session URL |
| `DB_SSL_CA_CERT_PATH` | Optional TLS CA file | Private | Configure only if certificate file can be packaged safely |
| `DB_RUNTIME_URL_SOURCE` | Chooses database/direct runtime | Private | Verify approved pool strategy |
| `JWT_SECRET` | Access/JWT signing | Secret | Strong unique >=32 chars |
| `JWT_REFRESH_SECRET` | Refresh signing | Secret | Strong unique value |
| `OTP_HASH_SECRET` | OTP hashing | Secret | >=16 chars in production |
| `FRONTEND_URL` | Trusted public frontend origin | Public origin | Exact HTTPS origin |
| `GOOGLE_CLIENT_ID` | Google OAuth public identifier | Sensitive configuration | Only if configured |
| `GOOGLE_CLIENT_SECRET` | Google OAuth credential | Secret | Only if configured |
| `GOOGLE_REDIRECT_URI` | OAuth callback | Public origin | Exact hosted HTTPS callback |
| `STRIPE_SECRET_KEY` | Stripe API credential | Secret | `sk_test_*` only |
| `STRIPE_WEBHOOK_SECRET` | Hosted endpoint signature secret | Secret | Endpoint-specific Test Mode secret |
| `BREVO_API_KEY` | Brevo HTTPS API | Secret | Required in production |
| `BREVO_SENDER_EMAIL` | Verified sender | Public/sensitive | Required in production |
| `BREVO_SENDER_NAME` | Sender display name | Public | Optional; default ElectroHub |
| `ADMIN_MFA_ENCRYPTION_KEYS` | Administrator MFA key ring | Secret | Production key ring only |
| `ADMIN_MFA_ACTIVE_KEY_VERSION` | Active MFA key | Private | Required if MFA enabled |
| `WEBAUTHN_RP_ID` | Passkey/WebAuthn relying-party ID | Public domain configuration | Match public origin |
| `WEBAUTHN_RP_NAME` | Passkey display name | Public | Match product identity |
| `WEBAUTHN_ORIGIN` | WebAuthn origin | Public origin | Exact HTTPS origin |
| `ELECTROHUB_ENV_FILES` | Hermetic test environment-file control | Private/test | Never use to expose DEV credentials in PROD |

Additional integrations require values already defined in the backend `.env.example`: AI service URL/key, commerce email configuration, web push/VAPID, Supabase Storage, delivery map origin and test controls. They must not be inferred or enabled without source review.

Production must keep `ADMIN_SEED_PROVISIONING_ENABLED=false` or unset and must not mount a development administrator account.

## 4. AI runtime variables

| Variable | Purpose | Production requirement |
|---|---|---|
| `AI_ENVIRONMENT` | Environment identity | `production` |
| `AI_PROCESS_ROLE` | API or media worker | `api` by default; separate worker only if explicitly implemented |
| `AI_SERVICE_API_KEY` | Shared Express-to-AI credential | Strong secret, required for public/production API |
| `AI_BIND_HOST` | ASGI bind address | Render-compatible non-loopback address after validation |
| `AI_PORT` | ASGI listen port | Render-supplied port where supported |
| `AI_DOCS_ENABLED` | Interactive docs | Must be false in production |
| `AI_LOG_LEVEL` | Logging | Production-safe level |
| `AI_MAX_REQUEST_BYTES`, `AI_MAX_TOP_K`, `AI_MAX_CANDIDATES`, `AI_INFERENCE_TIMEOUT_SECONDS` | Request/resource limits | Evidence-based bounds |
| `AI_MAX_IMAGE_BYTES`, `AI_MAX_IMAGE_PIXELS`, `AI_TORCH_THREADS` | Image/inference resources | Fit 512 MB evidence |
| `AI_MODEL_ARTIFACT_DIR` | Model directory | Verified read-only artifacts |
| `AI_RELEVANCE_ARTIFACT_DIR` | Relevance gate directory | Verified read-only artifacts |
| `AI_VECTOR_DATABASE_URL` | Read-only ai-vector role | Restricted PROD URL only if approved |
| `AI_MEDIA_WORKER_DATABASE_URL` | Separate media worker database | Secret; only worker process |
| `AI_MEDIA_STORAGE_BASE_URL` | Approved Supabase origin | HTTPS/approved project |

The AI process must reject commerce secrets and arbitrary database credentials. This is already a startup safety rule and must remain intact.

## 5. GitHub Actions

Add only workflow deployment credentials or approval signal values with an explicit workflow need. Do not duplicate every Render runtime secret. Do not print secrets or use them in frontend build variables. Do not create repository environments/protections or deployment credentials without explicit operator approval.

## 6. Secret scan status

The `.gitignore` and `.dockerignore` patterns exclude `.env*` variants while tracking `.env.example` templates. Tracked environment-like files found: only the three `.env.example` templates. Existing ignored environment files must not be deleted or overwritten. Any real secret-like value discovered in an ignored or historical file requires separate operator-authorized revocation/rotation review.
