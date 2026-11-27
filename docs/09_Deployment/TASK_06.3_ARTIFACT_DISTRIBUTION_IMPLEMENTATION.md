# Task 06.3 — AI Artifact Distribution Implementation

## Architecture

ElectroHub uses private, immutable Supabase Storage objects for approved AI release archives. A Render instance downloads only the archive selected by `AI_ARTIFACT_RELEASE_ID` from `AI_ARTIFACT_DOWNLOAD_URL`, verifies an archive SHA-256 pin and the existing host-pinned production release envelope, extracts into a temporary directory, and atomically installs the release into `/tmp/electrohub-ai-artifacts/<release-id>`.

The implementation preserves the existing production trust anchor:

- `AI_PRODUCTION_RELEASE_SHA256` pins `AI_PRODUCTION_RELEASE.json` exactly.
- The release envelope pins `AI_MODEL_ARTIFACT_PRODUCTION.json` and the model/relevance identities.
- The repository-owned `verify-model-artifact.py` verifies every artifact file, the loader source, and model/index compatibility.
- The archive has an independent `AI_ARTIFACT_ARCHIVE_SHA256` pin.

No model binary or credential is committed to Git. No public GitHub release is used.

## Publication

Use `apps/ai-service/scripts/publish_artifact_release.py` only after a separately approved production release exists. The script:

1. Requires the production release and artifact manifests.
2. Verifies the host release SHA-256 pin.
3. Verifies the distinct approved release status and approval references.
4. Verifies model, relevance, loader, and checksum identities.
5. Packages only the approved release metadata, model directory, relevance directory, and exact loader source.
6. Refuses to overwrite an existing local output.
7. Produces a `.release.json` record containing release and archive SHA-256 values.
8. If a publish URL is supplied, uploads with `x-upsert: false`; overwrite is refused by the workflow protocol.

Publication credentials are read only from the protected `ai-artifact-production` GitHub environment. Ordinary CI and pull requests receive no publish credentials. The workflow is manual and has `contents: read` permissions.

No production release was created or published by this implementation.

## Render startup

The installer runs in the FastAPI lifespan before model initialization. It:

- validates signed or authenticated Supabase Storage URLs against approved project refs;
- streams downloads in 1 MiB chunks with bounded retries and exponential backoff;
- enforces download and extracted-size limits;
- rejects traversal, duplicate, symlink, hardlink, device, and non-file archive entries;
- verifies the archive checksum before extraction;
- verifies cache markers and existing cache bytes before reuse;
- stages in a sibling temporary directory and atomically switches the active release;
- fails closed and keeps `/health` live while `/internal/v1/ready` remains unavailable;
- never logs signed URLs or authorization values.

A restart or instance replacement may download and verify the configured release again. The ephemeral `/tmp/electrohub-ai-artifacts` cache is not permanent storage and no Render disk is declared.

## Render environment

| Variable | Secret | Purpose |
|---|---|---|
| `AI_ARTIFACT_DOWNLOAD_URL` | Yes | Private signed Supabase Storage object URL |
| `AI_ARTIFACT_RELEASE_ID` | No | Exact immutable release directory/object identity |
| `AI_PRODUCTION_RELEASE_SHA256` | No | Host-pinned SHA-256 of `AI_PRODUCTION_RELEASE.json` |
| `AI_ARTIFACT_ARCHIVE_SHA256` | No | SHA-256 of the versioned `.tar.gz` archive |
| `AI_ARTIFACT_CACHE_DIR` | No | Ephemeral cache, `/tmp/electrohub-ai-artifacts` |
| `AI_ARTIFACT_MAX_DOWNLOAD_BYTES` | No | Download limit, default 600 MiB |
| `AI_ARTIFACT_MAX_EXTRACTED_BYTES` | No | Extraction limit, default 900 MiB |
| `AI_ARTIFACT_DOWNLOAD_TIMEOUT_SECONDS` | No | Per-request timeout, default 60 seconds |
| `AI_ARTIFACT_DOWNLOAD_RETRIES` | No | Bounded retry count, default 3 |
| `AI_MODEL_ARTIFACT_DIR` | No | Mounted-readonly mode only; unset for Render download mode |
| `AI_RELEVANCE_ARTIFACT_DIR` | No | Mounted-readonly mode only; unset for Render download mode |

For Render, configure only the dashboard secret values. Do not place signed URLs or release credentials in `render.yaml`, frontend variables, Git, logs, or chat.

## Storage setup blocked pending authorization

A private Supabase Storage bucket and immutable release object are required. The operator must separately create or verify a private bucket, publish a manually approved archive without upsert, create a short-lived signed download URL or restricted storage credential, configure the Render dashboard, and verify a non-overwritten object record. These are dashboard mutations and are not performed by this repository task.

## Credential rotation

Replace `AI_ARTIFACT_DOWNLOAD_URL` in the Render service, redeploy or restart the service, verify `/health` and `/internal/v1/ready`, and revoke the old signed URL. Archive release pins should change only with a separately approved release identity.

## Rollback

Set the Render variables to the previous separately approved release ID and matching archive/release SHA pins, update the signed URL, and restart. Do not deploy an incompatible artifact without the matching approved vector index and loader source. Existing index rollback remains a separate audited operation.

## Free-plan implications

The implementation uses ephemeral disk only and remains compatible with no persistent disk. It does not prove that a 216.70 MiB model, 490 MiB Torch runtime, decompression copies, startup RSS, and cold download fit within Render Free. Docker build and hosted RSS evidence remain unavailable or unverified.

## QA

The installer test suite covers valid installation, checksum mismatch, unsafe extraction paths, retry exhaustion, URL/release mismatch, and liveness/readiness separation. It uses no production credentials or artifacts.

## Dashboard checklist

1. Approve the production source, quality, rights, model, and vector index separately.
2. Create the private versioned Supabase Storage object without upsert.
3. Record the release ID and archive/release SHA-256 values.
4. Generate a short-lived signed URL.
5. Enter dashboard values under the protected Render environment.
6. Trigger a manual deploy, because `autoDeploy: false` remains intentional.
7. Measure image size, startup download duration, peak disk, RSS, and cold-start latency.
8. Verify liveness and readiness without a fallback model.
9. Record hosted smoke evidence and rollback target.

## Final gate

Repository implementation is complete. Hosted publication and deployment remain **STRICT NO-GO** until an externally authenticated operator completes the dashboard checklist and provides credential, storage, memory, startup, and readiness evidence.
