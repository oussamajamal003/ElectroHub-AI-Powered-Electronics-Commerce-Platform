# Task 06.3D — AI Artifact Provenance Report

**Review date:** 2026-11-19

**Scope:** Repository and local files only. No service, database, provider, worker, or deployment was accessed.

## Result

The reported mismatch was caused by verifying the candidate manifest against the wrong relevance directory. The manifest describes the D3 v2 family-gate artifact; the earlier Task 06.3C command supplied `relevance-siglip2-d1`. The correct local D3 artifact already exists and all declared bytes match. No model artifact was recovered, regenerated, substituted, or modified.

The candidate manifest now records both artifact directories, and the offline verifier checks the supplied paths against those declarations before hashing. The change makes the same mistake fail with a path-specific diagnostic. It does not change model identity, checksums, loader behavior, or production configuration.

## Expected and actual artifacts

| Candidate component | Manifest path | Local contents | Result |
|---|---|---|---|
| SigLIP model `siglip2-b16-p256-d1` | `apps/ai-service/models/siglip2-b16-p256-d1` | Descriptor, `weights.json`, projection and ten vision shards; 186,581,546 bytes total | All 13 declared files match size and SHA-256 |
| Relevance gate `siglip2-b16-p256-d1-family-gate-v2` | `apps/ai-service/models/relevance-siglip2-d3` | `relevance.json`, `head.safetensors`, `family_gate.safetensors`; 160,623 bytes total | All three declared files match size and SHA-256 |

The model and relevance directories are ignored local artifacts, not Git-tracked release bundles. Their current files match the committed Task 04.2 evidence and the Task 06.3 local-candidate manifest. This establishes the identity of this local candidate against repository evidence; it is not a signed supply-chain attestation or evidence of a production artifact installation.

## Provenance evidence

- Tracked [Task 04.2 implementation evidence](../tasks/Phase-04/TASK_04.2_IMPLEMENTATION_EVIDENCE.md), recorded in Git commit `4ff68be27cd78538fc094ef8766bfaca10c00fa5`, identifies `models/relevance-siglip2-d3` as version `siglip2-b16-p256-d1-family-gate-v2`, threshold `0.35`, and records the family-gate SHA-256 `be4e874667e7ab86742805788b7055d427eba8018dead5543b4755fdf7ba952a`. It reports that a clean rebuild reproduced that digest.
- The same evidence identifies the shared model as `siglip2-b16-p256-d1`, embedding version `siglip2-b16-p256-d1-b3900dd9fad5`, preprocessing `siglip2-rgb-r224-bilinear-norm05-v1`, and dimension 256. It records the D3 head and gate checksums matching `relevance.json`.
- The current D3 `relevance.json` was reconstructed in memory using the tracked `training/build_family_gate.py` metadata-update/JSON-serialization logic, the existing D2 descriptor, the documented D3 version and threshold, and the current D3 family-gate digest. With the artifact's CRLF line endings, the reconstructed bytes match exactly: 1,379 bytes and SHA-256 `3d2baad2bcd95ad77c474115c958056b01afb6e9498f52c6116fe4a07f114175`. This was a read-only metadata reconstruction; the training script and model fitting were not run.
- The local D3 descriptor and model descriptor were parsed by the current application loaders. The D3 loader accepted the expected backbone, checksum, tensors and shapes. The model descriptor accepted the current preprocessing version and dimension; its 11 weight files passed the model loader's checksum verification.
- The [Task 04.3 implementation report](../tasks/Phase-04/TASK_04.3_IMPLEMENTATION_REPORT.md) documents Task 04.3's existing version-aware synchronization and worker ownership. This review did not access the DEV or PROD database or verify their present state.

The local training inputs and historical clean-rebuild execution were not re-run here. No dataset, artifact archive, signature, or external artifact registry was inspected. The provenance conclusion is limited to exact agreement with the tracked Task 04.2 record, a byte-exact builder-equivalent metadata reconstruction, and current loader acceptance.

## Root cause

There are three local relevance generations for the same backbone:

| Directory | Relevance version | Family gate | `relevance.json` size / SHA-256 |
|---|---|---:|---|
| `relevance-siglip2-d1` | `siglip2-b16-p256-d1-category-head` | No | 1,257 / `ae16c39d6c5dfe6ef8ba519f8a23daa5dd56831719fd95e4e752bd1fc5df3df8` |
| `relevance-siglip2-d2` | `siglip2-b16-p256-d1-family-gate-v1` | Yes, v1 | 1,379 / `ab45c345ef26bb86fc8ca2ab71e86dca69cc8937a3c9817ee0639deb2eb8b914` |
| `relevance-siglip2-d3` | `siglip2-b16-p256-d1-family-gate-v2` | Yes, v2 | 1,379 / `3d2baad2bcd95ad77c474115c958056b01afb6e9498f52c6116fe4a07f114175` |

The candidate expected the D3 `relevance.json` and `family_gate.safetensors` digests, while the earlier command pointed to D1. D1 is a real older artifact, but it is not the manifest's relevance version and does not contain a family gate. The original verifier correctly failed closed on those bytes; its diagnostic did not identify the directory-selection error.

## Remediation and severity

- **MEDIUM — Candidate artifact paths were not bound to the manifest.** A caller could select a different local model/relevance directory, and the resulting checksum error obscured whether the artifact was missing or the path was wrong. The manifest now declares checkout-relative model and relevance directories. The verifier rejects paths outside the checkout and paths that differ from those declarations. A focused regression test covers a D1-style wrong path and a path traversal declaration.
- **INFORMATIONAL — Prior Task 06.3C interpretation corrected.** The earlier report accurately recorded that the D1 directory did not match the D3 manifest, but its “missing artifact” conclusion does not apply to the D3 directory now traced and verified. Historical Task 06.3C evidence was left unchanged; this report supersedes that root-cause interpretation.
- **BLOCKER — No production AI release is established.** The candidate manifest explicitly says `LOCAL_ARTIFACT_CANDIDATE_NOT_PRODUCTION_RELEASE`. No production catalog/index, current readiness, approved production artifact bundle, or activation evidence was examined or created. This is separate from the resolved local byte-verification failure.

## Remaining provenance and release work

1. If the D3 candidate advances, package the exact artifacts through an approved, immutable release process and retain source, artifact and loader identities together. Decide whether signed provenance/attestation is required by release policy.
2. Under separate authorization, verify the intended production project and current index/readiness using the existing Task 04.3 operator workflow. Do not reuse DEV vectors or treat this repository-only report as index approval.
3. Keep model activation, worker operation and public deployment as separately authorized release actions.

No AI artifact was activated and no database or external system was contacted for this report.
