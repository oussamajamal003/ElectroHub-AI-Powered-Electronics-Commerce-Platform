# Task 06.3D — Implementation Evidence

**Date:** 2026-11-19

**Result:** Repository investigation and local candidate verification complete; evidence is ready for Principal Software Architect review. This does not approve a production AI release.

## Git and worktree

- Branch: `feature/06.3-production-infrastructure` (the current branch name is `feature/06.3-production-infrastructure`).
- HEAD: `053a271ba36ebcf436720bdc6aa87c7bb79cf149`.
- Local `develop`, `origin/develop` and the task branch's local `origin/feature/06.3-production-infrastructure` ref point to that same SHA. No fresh remote query was made during this task; this is local-ref evidence only.
- The worktree already contained extensive uncommitted Task 06.3 changes before this task. They were preserved. No stage, commit, push, merge, rebase, branch switch, reset, clean, stash or discard was performed.
- The model directories remain Git-ignored under the existing `apps/ai-service/models/` ignore rule. They were read and hashed only.

## Changes in this task

| File | Change |
|---|---|
| `docs/09_Deployment/AI_MODEL_ARTIFACT_CANDIDATE.json` | Added the evidence-backed local model and D3 relevance artifact directory paths. Existing model/relevance versions and checksum declarations were not altered. |
| `apps/ai-service/verify-model-artifact.py` | Added path binding to the candidate manifest; rejects paths outside the checkout and mismatched caller-supplied artifact directories before hashing. |
| `apps/ai-service/tests/test_task_063_artifact_manifest.py` | Added regression coverage for a wrong relevance directory and a path traversal declaration. |
| `docs/09_Deployment/TASK_06.3D_ARTIFACT_PROVENANCE_REPORT.md` | Recorded artifact provenance, corrected root cause and residual release blockers. |
| `docs/09_Deployment/TASK_06.3D_AI_RELEASE_VERIFICATION.md` | Recorded hashes, loader compatibility checks, commands and outcomes. |
| `docs/09_Deployment/TASK_06.3D_IMPLEMENTATION_EVIDENCE.md` | This evidence index. |

No model artifact bytes, authentication code, AI runtime configuration, database, vector index, or worker setting changed.

## Findings and test evidence

The prior Task 06.3C verification supplied `relevance-siglip2-d1`, although the candidate manifest and tracked Task 04.2 evidence identify `relevance-siglip2-d3` as the required family-gate v2 artifact. D1 is an older category-head artifact without the family gate. The D3 `relevance.json`, head and family-gate byte sizes and SHA-256 values match the candidate manifest. The model descriptor and all 11 model weight files also pass their current loader and manifest checks.

| Verification | Actual result |
|---|---|
| Offline candidate verifier with D3 path | PASS, exit 0 |
| Offline candidate verifier with D1 path | Expected rejection, exit 1 with an explicit directory mismatch |
| Focused AI/release tests (`test_relevance_gate.py`, `test_siglip_loader.py`, `test_task_063_artifact_manifest.py`, `test_task_063_release_healthcheck.py`) | 49 passed |
| Focused Ruff lint | PASS |
| Focused Ruff format check | PASS |
| Actual D3 gate loader and model descriptor/weight verification | PASS; details in the [AI release verification report](TASK_06.3D_AI_RELEASE_VERIFICATION.md) |

The system Python attempt could not import FastAPI/PyTorch. The existing repository virtual environment supplied the dependencies for passing local checks; no dependencies or system software were installed.

## Limitations and unverified areas

- The artifact binaries are ignored local files, not an immutable/signed production release bundle. Provenance is established to the tracked Task 04.2 record by exact checksum and loader acceptance; a new training or clean rebuild was not performed.
- Full SigLIP cold-start and inference were not run. Cross-browser behavior, actual deployment image packaging, AI worker operation and host capacity are outside this local artifact check.
- No current DEV/PROD database, vector index, model pointer, or provider state was queried. Historical Task 04.2/04.3 evidence is not asserted as current live state.
- No migration, model/index activation, worker dispatch, cloud operation, spend, public exposure, or external provider change occurred.

## Recommendation

Send the corrected local provenance and verification evidence for Principal Software Architect review. Keep deployment and AI production release **NO-GO**. A later, separately scoped task should define an approved immutable artifact distribution/attestation path and, only with explicit authorization, verify production project/index/readiness through the existing Task 04.3 safeguards. This work does not authorize that activity.
