# Task 06.3E — AI Artifact Distribution and Attestation Architecture

**Review date:** 2026-11-19
**Scope:** Repository architecture decision only. No artifacts were packaged, uploaded, installed, activated or deployed.
**AI production release:** **NO-GO**
**Recommended direction:** **CONDITIONAL** — protected CI creates a signed, immutable AI artifact release bundle; a separately approved application release fetches that exact bundle and transfers it through the existing SSH release path. GitHub Release assets are the preferred no-new-service retention target only after repository visibility, model distribution rights and source provenance are approved.

## 1. Executive recommendation

The repository has strong local integrity checks, but no complete artifact delivery chain. The candidate manifest describes ignored local model directories; the AI loader verifies weight and relevance digests before deserialization; Docker mounts the model read-only. The deployment workflow packages application images and the candidate JSON, while the VPS deployment script verifies model files already present on the host. Neither step distributes model bytes or proves who approved them.

Adopt a separate, versioned AI artifact release, bound to the exact application source SHA and model/index identity. A dedicated protected GitHub Actions workflow should consume a formally approved artifact source, validate the complete directory against a release manifest, package it, produce provenance, and sign the package/manifest with a keyless Sigstore identity. Keep GitHub Actions workflow artifacts as short-lived same-run handoff only. If account/repository policy permits, retain the signed package as an immutable GitHub Release asset; the existing deployment workflow can download the exact asset and send it to the host over its current pinned SSH/SCP channel. The host must verify signature, signer identity, manifest, archive and individual files before safe extraction into a versioned read-only directory.

This is a target design, not an approved release or an implementable pipeline yet. Two inputs are unresolved: there is no canonical artifact source available to hosted CI (the model directories are Git-ignored and absent from the release bundle), and the repository visibility/access policy and model distribution rights are not evidenced. Do not publish model assets or extend deployment until those decisions are recorded. A valid signature would establish the identity of the builder workflow and signed bytes; it would not establish model quality, training-data rights, production index readiness or operator approval.

**BLOCKER — model approval is a separate gate.** Task 04.2-Q records that D3 failed its then-required stocked-image rejection threshold (7/103, 6.8%, against a maximum 5%). A later entry documents an owner-authorized shared-DEV activation with explicit acceptance of that metric exception; it is not a production authorization or a pass of the original quality gate. Task 06.3D approved local artifact provenance and integrity only. Reconcile model quality against a later authorized production decision before a release.

No signing key, artifact registry, CI release, host or provider was created or changed in this task.

## 2. Current-state findings

| Finding | Classification | Repository evidence |
|---|---|---|
| The candidate describes model **siglip2-b16-p256-d1**, embedding/index identity **siglip2-b16-p256-d1-b3900dd9fad5**, preprocessing **siglip2-rgb-r224-bilinear-norm05-v1**, dimension 256, and D3 relevance version **siglip2-b16-p256-d1-family-gate-v2**. It lists 13 model files and 3 relevance files with sizes and SHA-256 values. | INFORMATIONAL | [Candidate manifest](AI_MODEL_ARTIFACT_CANDIDATE.json); [Task 06.3D provenance report](TASK_06.3D_ARTIFACT_PROVENANCE_REPORT.md). |
| The candidate is explicitly **LOCAL_ARTIFACT_CANDIDATE_NOT_PRODUCTION_RELEASE** and records local ignored-directory evidence. It contains no signature, signing identity, attestation, durable source URI, or production index evidence. | HIGH | [Candidate manifest](AI_MODEL_ARTIFACT_CANDIDATE.json). |
| The Task 06.3D verifier compares repository-relative artifact paths, expected sizes and hashes, loader source digest and artifact compatibility; local D3 passed and D1 was rejected. The 49-test result is local repository evidence only. | INFORMATIONAL | [Verifier](../../apps/ai-service/verify-model-artifact.py); [Task 06.3D verification](TASK_06.3D_AI_RELEASE_VERIFICATION.md). |
| The SigLIP loader checks the descriptor and preprocessing/dimension identity, verifies the digest of **weights.json**, checks every listed safetensors file and refuses unlisted vision safetensors before deserializing. Relevance loading verifies the head and optional family-gate hashes and matches the backbone model version. It does not fetch model files or authenticate the author of a manifest. | INFORMATIONAL | [SigLIP loader](../../apps/ai-service/app/models/siglip_loader.py); [relevance loader](../../apps/ai-service/app/models/relevance.py). |
| The AI Docker image intentionally excludes model artifacts. Production Compose mounts model and relevance paths read-only from host directories. This is appropriate isolation, but requires an independently reliable installer. | INFORMATIONAL | [AI Dockerfile](../../apps/ai-service/Dockerfile); [production Compose](../../infrastructure/production/compose.yaml); [AI ignore rules](../../apps/ai-service/.dockerignore). |
| The current release workflow copies the candidate JSON, source archive and image archive into a seven-day Actions artifact. It does not copy the ignored model or relevance files. The release manifest hashes the candidate JSON and image/source archives, not the model payload. | BLOCKER | [Production workflow](../../.github/workflows/deploy-production.yml); [release-manifest builder](../../infrastructure/production/create-release-manifest.cjs); [release verifier](../../infrastructure/production/verify-release-manifest.cjs). |
| The host deploy script requires model/relevance directories already under the managed host root, verifies them against the candidate manifest and then starts the services. It does not download, extract or install artifact files. The existing release path is therefore not self-contained or reproducible for a fresh host. | BLOCKER | [Host deploy script](../../infrastructure/production/deploy-release.sh); [Compose environment example](../../infrastructure/production/compose.env.example). |
| No Cosign, Sigstore, in-toto, SLSA, signature-verification or artifact-registry integration was found in the relevant workflows, deploy scripts or AI runtime. Existing SHA-256 checks provide byte integrity relative to the checked manifest, not trusted provenance. | HIGH | Repository search of **.github**, **infrastructure/production**, **apps/ai-service** and deployment documentation. |
| Task 04.3's media worker processes product-media outbox events, resolves canonical image sources, checks the active model identity and publishes eligible media overlay vectors. It is not a model distribution/install worker and must not acquire that new responsibility. | HIGH | [Task 04.3 implementation report](../tasks/Phase-04/TASK_04.3_IMPLEMENTATION_REPORT.md); [media worker](../../apps/ai-service/app/media_sync.py); [ADR-010](../ADR/ADR-010-product-media-synchronization.md). |
| Task 04.2-Q records D3's then-current rejection metric above its acceptance ceiling. A later entry records an explicitly authorized shared-DEV activation accepting that exception, but no production approval. Task 06.3D establishes local byte provenance, not a quality-gate waiver. | BLOCKER | [Task 04.2 implementation evidence](../tasks/Phase-04/TASK_04.2_IMPLEMENTATION_EVIDENCE.md), D3 artifact and Task 04.2-Q sections; [Task 06.3D evidence](TASK_06.3D_IMPLEMENTATION_EVIDENCE.md). |

## 3. Distribution options

| Option | Integrity / provenance | Retention, size and cost | Rollback and access | Assessment |
|---|---|---|---|---|
| **GitHub Actions artifact only** | Can transport a checksummed bundle between jobs in one workflow. Artifact storage itself is not proof of signer or model provenance. | Existing deployment workflow explicitly retains 7 days. Account/repository retention settings and plan quota apply. Current GitHub documentation lists included shared artifact/package storage by plan (Free 500 MB, Pro 1 GB, Team 2 GB, Enterprise Cloud 50 GB); overage can be billed. Five uncompressed AI bundles at about 178 MiB each are about 890 MiB before application images or other artifacts. | Convenient for same-run deploy and the existing approval gate; it expires and is deleted with its run, so it is a poor durable rollback source. | **Use only as transient handoff**, never as the sole retained release archive. Account plan/remaining quota are not verified. |
| **Immutable GitHub Release asset** | Can hold a signed archive, manifest and attestation linked to a release identity. GitHub storage alone does not authenticate the model; host signature verification remains required. | Official release docs currently allow up to 2 GiB per asset and state no total release-size or bandwidth limit. No separate asset price was identified in those docs; current account terms must still be checked. The 178 MiB payload is comfortably below the per-file limit. | Durable versioned asset; release immutability can prevent asset replacement/deletion after publication. Access follows repository visibility. If this repository is public, the model weights may be public to repository viewers. | **Preferred no-new-service retention option, conditional** on repository visibility, artifact confidentiality and model/license approval, and the owner enabling appropriate immutable-release protection. Visibility and settings were not checked. |
| **Versioned object storage (example: DigitalOcean Spaces)** | Private bucket access can restrict downloads; still needs signed-manifest verification and a pinned trust policy. | DigitalOcean's official page, last verified 2026-11-17, lists a **$5/month** base subscription including 250 GiB and 1,024 GiB outbound transfer; extra outbound transfer is $0.01/GiB. Region-specific transfer exceptions apply. Any service minimum, taxes and later pricing must be checked again. | Durable object versioning/retention policies would need to be configured and tested. Requires service account credentials, lifecycle ownership, private access policy and a new provider boundary. | Technically viable but **not compatible with the current $0/no-new-service authorization**. Do not select or create it without separate approval. |
| **Embed weights in the AI application image** | Image digest can bind code and weights in one content-addressed artifact; a checksum still needs a trusted signature/attestation. | Adds roughly 178 MiB of uncompressed model/relevance bytes to the image before image-layer overhead. Repeated app releases duplicate or retain model layers; image tar size and runner/host storage are not measured. | Application and model rollback are coupled. Model rollout becomes coupled to every AI image release, and the current deliberate read-only host-mount boundary changes. | **Not recommended.** It conflicts with the existing design intent that model files stay out of the AI image and makes independent model retention/activation less clear. |
| **Separate OCI model image/artifact** | OCI digest and image signing can provide content-addressed packaging and provenance if implemented. | Requires a registry or offline image distribution. No approved registry is configured. A paid registry/service would need price and approval; bundling it into the existing image tar avoids a registry charge but still requires a source and installer. | Versioned tags/digests can support rollback, but require an artifact extraction/volume mechanism and registry/image retention policy. | **Viable future alternative**, but more machinery than a single 178 MiB file set at current scale. Not selected. |
| **Operator-managed archive + existing SSH/SCP** | Local verifier plus host-side verifier can detect changed bytes. Without a signed identity and independent source record, a malicious or mistaken operator can replace both payload and checksums. | No new storage subscription; each transfer is approximately 178 MiB before archive overhead. A local approved source and retained host versions consume disk. Human time and chain-of-custody costs are real. | Fits the existing pinned SSH/SCP route and can be used for a one-time controlled installation after explicit approval, but is manual and easy to make non-repeatable. | **Fallback/bootstrap only**, with an independently approved source, dual-person review, signed manifest and audited transfer record. It is not a substitute for a release pipeline. |

### Recommended target

Use a dedicated, protected **AI artifact release** workflow to create the signed immutable bundle; publish its assets to an immutable GitHub Release only after the repository owner confirms that the model may be distributed to the repository's audience. The existing manual exact-SHA deployment workflow should then consume the named AI artifact release ID, verify it, and transfer the bytes to the host using its already pinned SSH/SCP channel. Do not put model access credentials on the VPS and do not serve model files through Nginx or the frontend.

Actions workflow artifacts remain a short-lived same-run transport or review copy. They are not the authoritative retained release because the current deployment uses seven-day retention and rollback artifacts must outlive a workflow run. If GitHub Release storage/access is not acceptable, pause and request an operator decision between an explicitly approved paid private store and a manually controlled host transfer policy. Do not silently move weights into Supabase product-media Storage.

**No canonical source is selected today.** The ignored local directories that passed Task 06.3D are a verified local candidate, not a hosted CI input or an approved production distribution source. A future builder needs an owner-approved origin and an audited way to provide those exact bytes to the protected builder; this task did not upload them.

## 4. Release identity and manifest contract

Keep **AI_MODEL_ARTIFACT_CANDIDATE.json** local-only and unchanged in status. Introduce a separate, versioned AI artifact release envelope only in a later implementation task. It must not be confused with the existing production activation manifest, which records the live project/index and operator authorization evidence.

The signed release identity should be a canonical manifest digest and bind all of the following:

### Model and preprocessing identity

- Schema and manifest version, artifact release ID, creation time, and release channel.
- Exact source Git SHA for loader/preprocessing code and exact application release SHA/image digests that consume the artifact.
- Model name/family/version, embedding version, model/index compatibility identifier, preprocessing version and full preprocessing contract, embedding dimension, artifact format and tokenizer value.
- Relevance version, backbone model version, threshold/configuration identity, and every relevance file.
- Verifier name/version and source SHA-256, loader source path/SHA-256, relevant preprocessing source SHA-256, runtime lockfile digest and declared Python/Torch/safetensors runtime.

### Files and package identity

- Every file's normalized relative path, byte size and SHA-256, including descriptor, weights manifest, all model shards, projection, relevance JSON, head and family-gate tensors.
- Expected directory layout and a policy that rejects absolute paths, parent traversal, symlinks, unexpected files, duplicate paths, missing files and oversized archives.
- Archive format/tool and exact tool version, archive byte size and SHA-256, and the digest of the canonical manifest itself.
- The candidate manifest digest and the Task 04.2 artifact/training evidence reference from which the release source was accepted.

### Build provenance and signature

- Builder repository, workflow path and workflow revision, exact workflow run ID/attempt, trigger/ref, builder image/toolchain identity, input artifact source reference and digest, packaging command/version, and resulting archive/manifest digests.
- An attestation that distinguishes **artifact creation/training evidence** from **packaging by CI**. If CI only packages pre-existing bytes, say so; do not claim that the CI builder trained or independently reproduced the model.
- Signature bundle reference, signer certificate identity, OIDC issuer and transparency-log evidence reference.
- An explicit approval reference and artifact-release authorization. Approval fields are evidence references, not secrets or claims inferred from a successful workflow.

The current candidate and 06.3D verifier already give per-file byte checks and loader compatibility identifiers. The existing application release manifest binds source and Docker image identities but hashes only the candidate JSON, not model files. The future AI release envelope should be referenced by digest in that top-level application release manifest so a reviewed application SHA cannot be deployed with a different AI bundle under the same label.

SHA-256 is an integrity mechanism: it answers whether bytes match a digest. A checksum stored beside the files does not identify who produced or approved those bytes. A signature authenticates a signing identity over the signed manifest/package digest. A provenance attestation describes the builder and inputs. Neither proves training-data rights, model quality, customer-catalog fitness, production index freshness or operator approval; those require independent evidence.

## 5. Signing and trust decision

**Decision: require cryptographic signing before any production artifact transfer.** Prefer a keyless Sigstore/Cosign signature from a dedicated protected GitHub Actions workflow using GitHub's OIDC identity. The current code has no signing implementation; this is a design choice for a later approved implementation, not a claim that the pipeline exists.

- Restrict the signing job to one reviewed workflow file, one approved protected branch/tag lineage and a production-grade GitHub Environment with reviewer protection. Set OIDC token permission only on that job; do not add a long-lived private signing key to repository secrets.
- The deployment verifier must pin the expected workflow certificate identity and OIDC issuer. Reject a valid signature from any other repository, workflow, branch/ref or issuer. Validate the signature over the canonical manifest and package digest before extraction.
- Pin the verifier/Cosign release version and binary digest. Maintain the Sigstore trust root according to its documented update/rotation process; make trust-root changes reviewable. The VPS does not need a model signing private key.
- Keep keyless signing's identity boundary explicit: compromise of the protected workflow or repository identity can produce an apparently valid signature. Require protected code review, environment approval and exact-SHA checks before signing; do not treat a signature as a substitute for those controls.
- Missing signature, malformed bundle, untrusted identity, expired/invalid certificate, transparency proof failure, manifest mismatch or file digest mismatch must **fail closed before install/activation**. Keep the prior active artifact and config unchanged; mark AI unavailable if no previously approved compatible version is available. Core commerce must continue without AI.
- Signature verification must not automatically activate the model or change the vector-index pointer.

Sigstore documents GitHub Actions OIDC signing and verification by exact certificate identity and issuer. Source links and access dates are in §10. The exact verifier packaging, offline/limited-connectivity behavior and trust-root update mechanism require focused tests before operator rollout.

## 6. Deployment verification, installation and activation lifecycle

Keep these as separate audited operations:

1. **Approve source and build:** an authorized maintainer names the canonical source artifact and its provenance. A protected workflow checks the exact artifact bytes against the source evidence and candidate declaration, runs current offline verification and compatibility checks, creates the archive, manifest and attestation, signs them, and records all output digests. No AI activation occurs.
2. **Retain immutable release:** publish the signature bundle, manifest, provenance and model archive as assets named by an immutable artifact release ID. If the repository audience cannot be authorized to read those weights, stop before publication and use a separately approved private storage option.
3. **Select for deployment:** the exact-SHA application release explicitly references one AI artifact release ID/digest. The deployment approval is separate from artifact-release approval. Verify the workflow run and exact application SHA as the current release workflow already requires.
4. **Acquire without host credentials:** the existing deployment runner downloads the exact immutable asset using its workflow authorization, validates its asset digest, and transfers it over pinned SSH/SCP. The VPS does not receive a GitHub token or a signing key. The candidate transfer path is inbound to a private host directory and does not publish artifacts.
5. **Verify before extraction:** on the host, verify the Sigstore bundle against the pinned identity, issuer and trust policy; verify the signed manifest and archive digest; reject path traversal, links, duplicate or unlisted files, size-limit violations and incompatible manifest fields. Then run the current offline artifact verifier against the extracted staging directories. Do not rely on runner-only verification.
6. **Install atomically without activation:** extract into a unique root-owned staging directory with restrictive read permissions for the AI runtime, validate file permissions and contents, flush/close all files, and rename into a new immutable version directory only after every check passes. Keep the existing model and relevance directories untouched. Remove incomplete staging only after a recorded failed-install outcome. No mutable “latest” directory or model download at AI startup.
7. **Check index compatibility:** compare model version, embedding version/index compatibility ID, preprocessing version, dimension and source/model digest with the approved Task 04.3 index plan/status. The AI service's readiness gate and vector gateway must continue to fail closed on a mismatch. Artifact installation does not stage or activate a database index.
8. **Activate only under separate authorization:** an operator explicitly selects the exact versioned model and relevance paths and executes the existing Task 04.3 staging/activation procedure for the exact catalog/index. No Compose startup, image pull, bundle verification or workflow completion may flip the active model or DB pointer. The application manifest records which artifact ID is selected.
9. **Readiness and commerce fallback:** restart/recreate the private AI service with the selected read-only paths, then require authenticated readiness to report exact model, embedding, preprocessing, dimension and relevance identities. If the index/model disagree or the AI service is unhealthy, keep AI unavailable and preserve normal Express commerce flows.
10. **Rollback:** retain the prior approved artifact directory, application image/config and corresponding compatible index through the agreed recovery window. Roll back the AI artifact path and code to a known-compatible identity. If the database active-index pointer changed, use only the existing audited Task 04.3 rollback under separate operator authorization and after verifying that the previous index remains compatible with current catalog/media revisions. The app deployment rollback alone does not undo database activation. Record pre/post identities and smoke evidence.

There is no atomic transaction spanning host filesystem state and the external vector-index pointer. A cutover must therefore use an explicit coordinated procedure and accept a bounded AI outage if needed; it must never serve mixed versions. Do not claim this sequence is tested or production-ready until a disposable host and disposable index exercise install failure, interrupted transfer, successful activation and rollback.

### Failure policy

| Failure | Required outcome |
|---|---|
| Source or training provenance is absent | Do not create an AI release. Keep the candidate local-only. |
| Bundle is truncated, corrupt, unsigned, signed by an untrusted identity, or has any digest/compatibility mismatch | Reject before extraction or activation. Retain active version and record a redacted audit failure. |
| Installation is interrupted or disk space is insufficient | Do not move the active pointer. Preserve the old version; clean only task-owned temporary staging after recording failure. |
| AI process cannot load or readiness does not match the selected index | AI remains NOT_READY; Express commerce continues; do not automatically activate/rollback a database index. |
| Rollback target is missing or no longer matches current catalog/media/index compatibility | Do not point to it. Keep AI disabled and resolve an authorized rebuild/release path. |

## 7. Task 04.3 ownership and service boundaries

The release bundle installs **static model code/data inputs only**. Task 04.3 remains the sole owner of product image synchronization, event leases, source revision/digest validation, overlay publication, reconciliation, worker health and model/index activation safeguards. Do not add artifact fetching to **app.media_sync**, a product-media event, a new recurring worker, or a service-role Storage client.

The bundle is private server-side model data. It must not be copied into the React build, served through Nginx, mounted into Express, or exposed through FastAPI. The existing AI container mounts it read-only. The existing worker profile, when separately authorized, consumes the same exact model release from its read-only mount and retains its current least-privilege DB/Storage configuration.

## 8. Cost, storage and transfer estimates

### Artifact footprint

- Model directory: **186,581,546 bytes**.
- D3 relevance directory: **160,623 bytes**.
- Combined declared files: **186,742,169 bytes**, approximately **178.1 MiB** or **186.7 decimal MB**.
- A manifest, signature bundle and provenance record add small metadata compared with the weights, but exact packaged bytes have not been measured. Safetensors are already binary tensors; do not assume compression meaningfully reduces the archive.
- A single model-only release transfer is approximately **0.18 GB**. The candidate's source directories are small compared with the app's image archive, whose current size has not been measured.

### Retention and temporary disk

- Five uncompressed artifact releases retained on a VPS are approximately **890 MiB** of model/relevance bytes, excluding filesystem and metadata overhead.
- A safe update needs the old active release plus the incoming archive and extracted staging release: approximately **534 MiB** at peak from model bytes alone. Retaining a prior rollback release as well raises that conservative peak to approximately **712 MiB**. These are arithmetic planning estimates, not measured archive sizes.
- The current 25 GiB candidate disk is not rejected by artifact size alone. OS, Docker layers, app image archives, source archives, logs, backups and other retained releases still require measured disk budgeting. The 1 GiB RAM host remains rejected for the full stack; this artifact design does not alter that conclusion.
- Retaining Actions artifacts can consume shared Actions/Packages storage. Current official quota documentation lists 500 MB on GitHub Free, 1 GB Pro, 2 GB Team and 50 GB Enterprise Cloud; the repository owner's plan and current usage are unknown. One 178 MiB AI payload may fit the lowest listed allowance alone; five retained copies would exceed it. The existing seven-day workflow artifact also includes application image/source bundles of unmeasured size.
- GitHub Release asset docs state a 2 GiB maximum per asset and no total release-size or bandwidth cap. That makes the current model bundle technically small enough, but does not settle access/privacy, licensing, repository settings or future platform policy.
- DigitalOcean Spaces currently lists a **$5/month** base subscription, 250 GiB included storage and 1,024 GiB outbound transfer. Additional outbound transfer is $0.01/GiB; same-region transfer exceptions vary. It is a paid alternative, not selected and not authorized.

No customer-facing bandwidth is required: artifacts remain server-side and are never delivered from the application. Artifact bandwidth is limited to release acquisition, retries and recovery/rollback. A later implementation should record transferred byte count and verify both the signed archive digest and file-level hashes.

## 9. Required implementation changes after decisions

These are future requirements, not changes made by Task 06.3E:

1. Approve a canonical artifact source and its owner, retention, access control, training/provenance evidence and transfer into a protected builder. Do not use the current ignored local directory as an implicit CI source.
2. Resolve D3 production model-quality approval or select a separately approved model/version. Preserve the current candidate bytes and local-only status until that decision.
3. Confirm repository visibility, who may download model weights, applicable upstream/custom artifact licenses, and whether GitHub Release assets are acceptable. Enable and test immutable-release protections if selected.
4. Add a distinct AI artifact release schema and deterministic/safe packaging step. Bind its digest into the existing exact-SHA application release manifest; leave the current candidate local-only.
5. Add a protected signing job with minimal OIDC permissions, exact workflow identity, environment approval and immutable release publication. The GitHub Environment's actual reviewers and branch protections must be verified in account settings; YAML cannot prove them.
6. Pin the Cosign verifier version and digest; document trust-root maintenance and test positive/negative signature identity cases.
7. Add deployment-runner acquisition and host-side pre-extraction verification, atomic version-directory installation, disk-space checks, audit receipt and failure cleanup. The installer must not set activation pointers.
8. Update the release/rollback runbook to include AI artifact ID, manifest/signature digests, model/index compatibility, prior artifact retention and the separately authorized Task 04.3 index rollback.
9. Add focused tests: schema/path traversal/unlisted file/digest errors; signature valid/invalid/wrong identity; corrupted and truncated transfer; interruption and atomic install; insufficient disk; existing model remains selected on failure; model/index mismatch leaves AI unavailable; rollback checks exact identities.
10. Validate with a disposable host and disposable vector database. Never use shared DEV or PROD in those tests without a new explicit authorization and target-specific safeguards.

## 10. Open decisions and remaining evidence

| Decision / unknown | Current status | Evidence needed |
|---|---|---|
| Canonical D3 model/relevance source and who owns release rights | **BLOCKER — not established by repository files.** Task 06.3D shows a local candidate and historical Task 04.2 evidence; files are ignored and not in CI. | Owner-approved source URI or controlled artifact input, source digest and provenance record; confirm artifact generation/reconstruction procedure and data/model license. |
| Whether the current D3 model is approved for production | **BLOCKER — not established.** Task 04.2-Q records a failed stocked rejection target and later an explicit shared-DEV exception; neither is production approval. | A Principal Architect/model-owner decision with accepted production quality evidence, or a separately approved model release. |
| GitHub repository visibility and Release asset audience | **UNKNOWN.** No visibility/settings or license decision was inspected. | Owner confirmation and read-only repository settings review. If public, explicit approval that the complete model bundle is distributable to the public. |
| GitHub immutable release feature and deletion/retention policy | **UNKNOWN.** Documentation describes immutable releases, but account/repository setting was not checked. | Verify settings, permissions, retention and recovery behavior in GitHub before implementing publication. |
| Account-level workflow protections and artifact-storage quota | **UNKNOWN.** Workflow YAML requests an Environment, but reviewer rules, branch restrictions, plan and shared usage are account state. | Verify exact Environment reviewers, protected ref policy, repository plan and current Actions/Packages usage. |
| Sigstore verification availability on deployment host | **NOT TESTED.** No Cosign binary, trust material or identity allowlist exists in the repository. | Pin and test host verifier, trusted identity constraints, transparency proof/trust-root update, and behavior with limited network access. |
| Measured archive size, host disk and release retention | **ESTIMATE ONLY.** Raw declared size is known; no production package or host exists. | Package only after source approval; record exact archive size; measure Docker/app release footprint and peak staging/rollback storage on an authorized disposable host. |
| Production vector/index readiness and current active version | **NOT VERIFIED in this task.** No DB was accessed. | Separately authorized read-only PROD preflight and Task 04.3 current-catalog/source-coverage evidence. |
| Atomic application/model/index cutover and rollback | **DESIGN ONLY.** No host/index was exercised. | Disposable-host/disposable-index failure injection, mismatch behavior, cutover and rollback evidence; production backup/restore and approval remain separate gates. |

## 11. Decision and next step

**Architecture decision:** conditionally approve the **design direction only**: CI-produced signed immutable AI artifact release, retained as an immutable GitHub Release asset if audience/rights allow, transferred over the existing exact-SHA SSH deployment channel, host-verified and installed into a versioned read-only directory. Keep installation, model activation and vector-index activation separate. Do not use Actions artifacts as the only rollback store, do not embed weights into the application image, and do not repurpose the Task 04.3 media worker or product-media bucket.

**Current status: BLOCKED for production artifact distribution/release.** The canonical source, GitHub access policy and D3 model acceptance are unresolved. The current deployment bundle cannot install the model by itself. This task did not grant approval to sign, publish, transfer or activate a production artifact.

**Recommended next task:** a short architecture clarification to (a) name the authorized artifact source and model release owner, (b) resolve the D3 quality gate, and (c) approve or reject GitHub Release asset visibility/retention. If accepted, Task 06.3F can implement the signed release schema/builder/verifier and disposable host installation tests without deploying or touching shared DBs. If GitHub distribution is rejected, obtain a separate cost/access decision before selecting another store.

## 12. Public documentation consulted

Access date: **2026-11-19**. These sources support current public product behavior and are not evidence of ElectroHub account settings:

- [GitHub Actions limits and included storage](https://docs.github.com/en/actions/reference/limits) — included storage/plan limits.
- [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) — pooled artifact and GitHub Packages storage, and current overage billing model.
- [GitHub workflow-artifact retention](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/remove-workflow-artifacts) — default/custom retention and deletion with workflow runs.
- [GitHub Releases](https://docs.github.com/en/enterprise-cloud%40latest/repositories/releasing-projects-on-github/about-releases) — per-asset limit and current total/bandwidth statements.
- [Managing immutable GitHub Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository) — behavior when immutable-release protection is enabled.
- [Sigstore CI quickstart](https://docs.sigstore.dev/quickstart/quickstart-ci/) — GitHub Actions signing and blob verification by certificate identity and OIDC issuer.
- [Sigstore security model](https://docs.sigstore.dev/about/security/) — workload OIDC identity and short-lived certificate model.
- [DigitalOcean Spaces pricing](https://docs.digitalocean.com/products/spaces/details/pricing/) — $5 base subscription, included storage/transfer and current overage. The page reports last verification 2026-11-17.
