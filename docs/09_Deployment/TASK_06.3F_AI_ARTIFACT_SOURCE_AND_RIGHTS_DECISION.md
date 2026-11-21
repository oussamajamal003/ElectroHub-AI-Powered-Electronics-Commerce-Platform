# Task 06.3F — AI Artifact Source, Model Approval and Distribution Policy

**Review date:** 2026-11-19
**Scope:** Repository investigation and policy decision only. No artifact bytes were read, packaged, transferred, signed or published.
**Current candidate:** `siglip2-b16-p256-d1` + `siglip2-b16-p256-d1-family-gate-v2`
**Distribution status:** **BLOCKED — no approved canonical source, production quality approval, or redistribution-rights decision.**

## 1. Decision summary

The repository establishes a locally verifiable D3 candidate, but it does not establish a source that a hosted release workflow can fetch, a model release approved for production, or the rights to redistribute the complete model bundle. The production repository is public (as stated in the task context), so a GitHub Release asset must be treated as public distribution. Public release is not authorized by the evidence found.

**Recommended policy now: do not distribute the candidate.** Keep the existing manifest explicitly local-only and retain the ignored artifact files under their current local controls. Do not publish them to a public Release, copy them to a VPS, or load them into a new private store until source provenance, rights and quality gates are resolved.

No artifact store is currently selected or approved. If private distribution is later authorized, prefer a private, versioned store with narrowly scoped read access; its provider, cost and credentials require separate approval. A controlled operator transfer can be considered for a one-time bootstrap after the source and rights are approved, but it is not a durable canonical source or an automated release process.

The production model-quality gate remains **NOT MET** for D3 on the recorded Benchmark 5 metric: 7 of 103 stocked images rejected (6.8%) against the required maximum of 5%. The later owner-authorized shared-DEV activation accepted this exception for DEV only. It explicitly did not pass the gate or authorize PROD. Later Task 04.4 evaluation concerns downstream recommendations and does not supply a superseding approval of the image-search false-rejection gate.

## 2. Canonical artifact source and reproducibility

### 2.1 What the repository identifies

| Component | Repository evidence | Finding |
|---|---|---|
| Shared encoder | `training/build_siglip_candidate.py` describes a pretrained SigLIP 2 B/16-224 vision tower. Its inputs are exported fp16 safetensors shards from Kaggle and an embedding archive produced by an `encoder-compare` kernel. | The upstream model family and broad source path are described. The exact upstream model identifier/revision, download record, license notice and immutable Kaggle dataset/kernel/run output IDs are not recorded in the tracked release contract. |
| D1 model candidate | The builder accepts `<vision-dir>` and `<embeddings.npz>`, fits a 768-to-256 projection and relevance/category head, copies the vision shards, and writes `weights.json` and a descriptor. It selects fitting inputs from `train` and catalog rows and chooses thresholds from `dev`; it excludes the final split. | The deterministic source code is present, but the actual input artifacts and complete generation recipe are not a checked-in or hosted-CI-accessible source. A checksum on the output cannot reconstruct the inputs. |
| D3 relevance gate | `training/build_family_gate.py` consumes a prior relevance head, encoded data, development folds, text encodings and the model projection. Task 04.2-Q reports that a clean rebuild reproduced the D3 family-gate checksum. | This is useful evidence for that gate's rebuild, not a canonical source for every model and relevance file or an end-to-end reproducibility record for the complete 186.7 MB artifact set. The private inputs and full immutable run identity remain unavailable from tracked source. |
| Local candidate bytes | `AI_MODEL_ARTIFACT_CANDIDATE.json` lists 13 model files and three D3 relevance files, totalling 186,742,169 declared bytes. Task 06.3D reports that the local candidate matched the listed sizes and SHA-256 values and that the verifier rejected the wrong D1 relevance directory. | This establishes byte agreement for the local candidate against the candidate manifest and historical Task 04.2 evidence. It does not authenticate who supplied the bytes or authorize their distribution. The model files were not re-hashed in this task. |
| CI/deployment input | `.gitignore` excludes `apps/ai-service/models/`; `apps/ai-service/.dockerignore` excludes model and training files. The current deployment workflow and release bundle described in Task 06.3E contain no model payload and have no artifact acquisition step. | Hosted CI cannot obtain this candidate from the current checkout/workflow. No authorized artifact source or CI credential/integration is documented. |

### 2.2 Conclusion on canonical source

**Canonical source: NOT ESTABLISHED.** Kaggle and a local ignored artifact directory are provenance clues, not sufficient source records. There is no tracked approved model archive, immutable artifact URI, owner-controlled source registry, or workflow that retrieves and verifies the exact candidate. The project cannot currently reproduce a fresh deployment from its hosted release process without a developer/local artifact transfer.

Before implementation, the model owner must provide or identify:

1. The exact upstream SigLIP 2 checkpoint identifier, revision/digest, publisher and applicable license/notice.
2. The authoritative private Kaggle dataset, kernel and run/output identifiers used to create the vision shards, embeddings and relevance inputs, plus the immutable digests of those inputs.
3. The matching private data/benchmark snapshot identifiers and the complete per-file source/attribution records needed to audit model-training rights.
4. A reproducible regeneration procedure or a designated owner-controlled canonical artifact archive whose bytes match the Task 06.3D candidate manifest.
5. The approved method and authorization for making that source available to a future protected release workflow. Do not place private data or general-purpose Kaggle credentials in this public repository.

This task did not inspect Kaggle, local private training data, model weights, provider accounts or external registries. No such access was needed to establish that those sources are absent from the tracked release path.

## 3. D3 production-quality decision

### 3.1 Recorded acceptance gate

Task 04.2-Q's locked Benchmark 5 comparison records:

| Metric | D3 result | Original requirement | Result |
|---|---:|---:|---|
| Stocked-image Top-1 | 93/103 (90.3%) | At least 80% | Pass |
| Stocked images rejected | 7/103 (6.8%) | At most 5% | **Fail** |
| Unstocked electronics accepted | 10/64 (15.6%) | At most 20% | Pass |
| Unrelated objects accepted | 0/34 | No worse than the recorded gate | Pass |

The evidence says no further collection or tuning followed Benchmark 5 under its stopping rule. The 6.8% result is a measured failure, not a rounding ambiguity or a result that is offset by the UX recovery actions.

### 3.2 Scope of the shared-DEV exception

The Task 04.2-Q record states that the owner authorized a reversible **shared-DEV-only** activation while explicitly accepting the measured 6.8% result against the original `<=5%` limit. The same record says this is “not a pass of the gate, and not a PROD authorisation.” It records the D3 vector index as active in shared DEV, but runtime/index state and an exception limited to DEV do not expand the authorization scope.

### 3.3 Later evidence

Task 04.4 reports D3-based recommendation evaluation and runtime use. That is downstream ranking/recommendation evidence, not a new locked evaluation of the Task 04.2 image-search stocked-rejection criterion. Its implementation evidence also records later D3 reliability as **NOT VERIFIED**, latency as **NOT ACCEPTED**, and readiness for Architect review as **NO**. No subsequent production-quality approval for D3 was found in the repository search performed for this task.

**Decision: D3 is not approved for production release under the current recorded acceptance contract.** Preserve the `<=5%` threshold. A future candidate must pass the applicable locked evaluation and receive the required owner/architect release approval. If the owner wants to change the acceptance contract, that requires its own explicit specification decision; this task does not waive or alter it.

## 4. Distribution rights and audience

### 4.1 Evidence available

- The root [`LICENSE`](../../LICENSE) is MIT for the project software. It does not establish rights to redistribute a third-party pretrained checkpoint, third-party training images, or the resulting model weights.
- Task 04.2 records training photographs from Wikimedia Commons/Openverse under CC0, public-domain, CC BY and CC BY-SA classes, with per-file attribution/provenance in generated training data. The actual dataset and attribution ledger are git-ignored/private and are not part of this release review. The repository does not record a rights analysis for distributing derived weights or the complete bundle.
- The tracked SigLIP builder calls the vision tower pretrained but does not pin the upstream checkpoint source/revision or include a model-specific license/NOTICE file in the candidate manifest.
- No tracked owner/legal sign-off establishes redistribution rights for the combined upstream weights, trained projection/head, D3 gate, or associated derived artifacts.
- Per the task's repository-visibility fact, a GitHub Release asset attached to this public repository must be considered **publicly distributable/downloadable by the repository audience**. No evidence authorizes that audience.

These findings do not determine that redistribution is prohibited; they establish that permission has not been evidenced. Legal/third-party license interpretation is not inferred from a successful local checksum or the repository's MIT license.

### 4.2 Options under current evidence

| Option | Audience and rights consequence | Current decision |
|---|---|---|
| Public GitHub Release asset | Public distribution. Requires explicit confirmation of upstream model terms, training-data/derived-artifact rights, attribution obligations and owner authorization. | **Do not use now.** Rights are unresolved and no public-release authorization exists. |
| Private versioned object storage | Can restrict audience, but private access does not cure license or source-provenance gaps. No approved private store exists in repository configuration. A provider may add recurring cost, credentials and operational ownership. | **Not selected.** Requires a separate provider/cost and access-control approval after rights are established. |
| Another approved private artifact source | Would avoid introducing a service only if such a source is already authorized and has auditable retention/access controls. | **None identified in repository evidence.** |
| Controlled operator-managed transfer | Can limit access for a one-time transfer, but is manual, depends on a valid canonical source, and needs signed identity, custody records and host verification. It does not resolve redistribution rights. | **Possible bootstrap only after approvals.** No transfer performed or source approved. |

## 5. Recommended distribution policy

Adopt a **private-by-default, fail-closed, no-distribution-until-approved** policy:

1. **Permitted audience today:** no deployment or distribution audience has been approved. Keep the candidate local-only under existing ignored-file controls.
2. **Confidentiality:** treat model files and training-derived artifacts as restricted pending a documented rights and audience determination. Do not place them in public releases, frontend assets, public web paths or source/container archives.
3. **Authoritative source:** only an owner-identified immutable source with exact source and output digests, license/attribution records, and reproducibility evidence may feed a release. A developer's ignored directory is not a canonical source.
4. **Store:** none is approved today. After source, rights and quality gates pass, use a private versioned store only after explicit provider and cost approval. An operator-controlled transfer may be a limited bootstrap path where the origin and handoff are independently attested; do not treat it as a durable store.
5. **Immutability/retention:** each approved artifact release must be immutable and content-addressed; keep the currently deployed approved version and at least its compatible rollback target. Exact retention duration/count, backup and deletion policy require an owner decision before implementation.
6. **Access:** grant only the approved release/deployment identity read access to the exact artifact version. Do not give the runtime AI service broad artifact-store credentials. Keep private data and secrets out of workflow logs and public artifacts.
7. **Attestation:** require a verifiable signature over the canonical release manifest/package and a builder provenance statement before production transfer, following the conditional design in [Task 06.3E](TASK_06.3E_AI_ARTIFACT_DISTRIBUTION_ARCHITECTURE.md). Checksums establish byte integrity relative to a manifest; they do not prove source authenticity, rights, quality or approval.
8. **Independent quality authorization:** sign/attest quality approval separately from packaging provenance. Artifact authenticity must never imply that the model passed its quality gate or that an index was approved/activated.

This policy permits an architectural direction, not a release. It does not select a provider, grant publication rights, authorize a production exception, or begin implementation.

## 6. Exact owner decisions and prerequisites

| Decision owner | Required decision/evidence | Gate that remains closed until resolved |
|---|---|---|
| ML/model owner | Supply the canonical source identity, immutable inputs/outputs, reproducibility record, upstream model license and complete dataset attribution/rights record. Confirm whether any candidate bytes are approved as a source of truth. | Artifact source and hosted release workflow input. |
| Product/quality owner + Principal Architect | Provide a new qualifying locked evaluation for the production acceptance criteria, or select another candidate that passes. Keep the existing threshold. Any proposal to alter the approved task's threshold must be separately authorized and documented before evaluation/release. | D3 production model-quality approval. |
| Rights owner / project owner | Confirm whether the model and derived artifacts may be redistributed; specify required notices/attribution and permitted audience (private operators only or public). | Public/private distribution rights. |
| Infrastructure/release owner | Choose an already-approved private store or explicitly approve a provider, budget, account ownership, retention and recovery model. Confirm exact workflow/release access controls. | Artifact store and release implementation. |

Do not proceed to signing/publishing implementation until the first three gates have written evidence. Do not create paid storage or accounts under this decision.

## 7. Implementation prerequisites for a later task

Once owner decisions are recorded, a separate implementation task can specify a canonical signed manifest; source ingestion; immutable bundle creation; rights/attribution notices; signer and verifier trust policy; fail-closed host verification before extraction; versioned read-only installation; separate activation; rollback to a compatible version; and disposable test coverage. The manifest must bind model, embedding, preprocessing and relevance identities, exact file paths/sizes/SHA-256, source/release identity, builder workflow identity, verifier version, and separate quality/rights approval references.

The artifact installer must remain separate from Task 04.3 product-media synchronization. It must not ingest or publish vectors, switch the active index, or use the media worker. Preserve the existing principle that AI unavailability does not block core commerce.

## 8. Evidence references and limits

- [Task 04.2 implementation evidence, including D3 Benchmark 5 and DEV exception](../tasks/Phase-04/TASK_04.2_IMPLEMENTATION_EVIDENCE.md)
- [Task 04.3 synchronization specification](../tasks/Phase-04/TASK_04.3_PRODUCT_IMAGE_STORAGE_AI_EMBEDDING_SYNCHRONIZATION.md)
- [Task 04.3 implementation report](../tasks/Phase-04/TASK_04.3_IMPLEMENTATION_REPORT.md)
- [Task 04.4 implementation evidence](../tasks/Phase-04/TASK_04.4_IMPLEMENTATION_EVIDENCE.md)
- [Local candidate manifest](AI_MODEL_ARTIFACT_CANDIDATE.json)
- [Task 06.3D artifact provenance report](TASK_06.3D_ARTIFACT_PROVENANCE_REPORT.md)
- [Task 06.3D verification evidence](TASK_06.3D_AI_RELEASE_VERIFICATION.md)
- [Task 06.3E artifact distribution decision](TASK_06.3E_AI_ARTIFACT_DISTRIBUTION_ARCHITECTURE.md)

No external provider accounts, local private training datasets, model weight contents, Supabase projects, registries, release settings or cloud resources were inspected. No current production index or model readiness was checked.

## 9. Final disposition

**Task 06.3F repository decision work: COMPLETE.**
**Canonical source: NOT ESTABLISHED.**
**D3 production quality: NOT APPROVED; recorded image-search gate failed.**
**Distribution rights: UNRESOLVED.**
**Artifact store: NONE selected or approved.**
**Public GitHub Release: NOT AUTHORIZED.**
**Production distribution/release: BLOCKED.**

Recommended next task: obtain the four written owner decisions in Section 6. If source, rights and quality remain unresolved, do not build an artifact release workflow; keep the local candidate unchanged.
