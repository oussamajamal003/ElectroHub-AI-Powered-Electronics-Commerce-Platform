# AI Production Release Manifest

This release record binds an exact code SHA, verified AI model/preprocessing artifacts, an exact loader source digest, and a vector index built from the actual PROD catalog. Its schema is [AI_RELEASE_MANIFEST.schema.json](AI_RELEASE_MANIFEST.schema.json). The local checked-out artifact and loader values are recorded in [AI_MODEL_ARTIFACT_CANDIDATE.json](AI_MODEL_ARTIFACT_CANDIDATE.json); that file is explicitly not a production release because no PROD catalog/index/activation evidence is available. It contains evidence references and digests only; never put credentials, catalog rows, customer data, or embeddings in the manifest.

## Required verification

1. Verify the Supabase project identity and region from the approved project configuration. Record the region evidence reference; a repository project ref is not proof of the live project region.
2. Select the exact approved model artifact. Record every descriptor field and artifact digest from its checked-in `descriptor.json` and the artifact directory's hash manifests. Keep the artifact read-only at runtime.
3. Use the Task 04.3 operator CLI against the verified PROD project only after separate authorization: `python -m app.ingest stage --artifact-dir <approved-artifact> --catalog-root <approved-production-image-snapshot>`, then inspect `python -m app.ingest status`. The catalog source must be PROD-visible products and product IDs. Never copy DEV embeddings or database rows into PROD.
4. Compare model/index `embeddingVersion`, `preprocessVersion`, `embeddingDimension`, artifact digest and index status. Require the index completeness and current-catalog checks before `activate`; activation uses the existing `AI_VECTOR_ADMIN_DATABASE_URL` role and audited `python -m app.ingest activate --embedding-version <version>` command.
5. Record the pre-activation version, approved activation evidence, post-activation status and the tested rollback target. Existing rollback is `python -m app.ingest rollback`; it returns to `ai.active_index.previous_version` and does not make incompatible artifacts valid.
6. At service start, the existing loader verifies artifact digests and preprocessing identity. `ModelRegistry` and `PgVectorGateway` determine readiness only when the active PROD index matches the loaded descriptor. Keep FastAPI private behind Express and its service key.

The schema cannot prove that a declared catalog digest came from PROD or that a human approval is valid. Those claims require preserved output from the protected read-only preflight, PROD-scoped operator command, and approval record. No production manifest or index was created during this repository task.

## Evidence fields

| Manifest field | Required source |
|---|---|
| `releaseSha` | Reviewed full Git SHA from the approved release checkout |
| `supabase.projectRef`, `supabase.region` | Read-only verified production project configuration |
| `model.*` | Exact artifact descriptor and byte-level SHA-256 checks |
| `loader.*` | Exact loader source path/SHA and pinned Python/Torch runtime requirement; compatibility id must equal the vector index embedding identity |
| `vectorIndex.catalogSnapshotSha256` | Task 04.3 eligible PROD catalog snapshot digest |
| `vectorIndex.productIdSetSha256` | Canonical sorted PROD product ID set digest; IDs are not embedded in the manifest |
| counts and active versions | `app.ingest status` before and after approved activation |
| authorization references | Protected operator approval record, without secret values |

Do not activate while the recorded `projectRef`/region, schema baseline, model identity, counts, or index readiness are unknown or inconsistent.

## Task 06.3 production deployment gate

The application deployment bundle requires two distinct files: `AI_PRODUCTION_RELEASE.json` and `AI_MODEL_ARTIFACT_PRODUCTION.json`. Both must use the explicit `APPROVED_PRODUCTION_RELEASE` identity; the production envelope binds the exact artifact-manifest digest, model/embedding/preprocessing/relevance identities and quality/source/rights approval references. The local `AI_MODEL_ARTIFACT_CANDIDATE.json` is not packaged as the AI release and is rejected if presented as the production artifact manifest.

The envelope must also match `PROD_AI_RELEASE_MANIFEST_SHA256` from the root-owned, non-group/world-writable host Compose settings file. That out-of-band digest pin is the production trust anchor for this deployment gate; it is not itself a model-quality evaluation or a cryptographic signature. The pin can be installed only after separately approved production source, quality and redistribution decisions. The current repository has no production AI release or artifact manifest and no approved host pin, so the deployment candidate is rejected. This candidate does not support a commerce-without-AI deployment mode: the release is rejected as a whole when its AI release is absent or invalid. Model artifact installation, application model startup and vector-index activation remain separate operations.

## Render archive distribution

For Render, a separately approved release may be distributed as an immutable private Supabase Storage archive instead of a mounted directory. The repository implements this installer at `apps/ai-service/app/artifact_installer.py`; packaging is manual and protected by `.github/workflows/publish-ai-artifacts.yml` and `apps/ai-service/scripts/publish_artifact_release.py`. No archive, signed URL or publish credential is defined in the repository. `render.yaml` declares only environment placeholders and no persistent disk. The complete operator and rollback procedure is in [TASK_06.3_ARTIFACT_DISTRIBUTION_IMPLEMENTATION.md](TASK_06.3_ARTIFACT_DISTRIBUTION_IMPLEMENTATION.md).
