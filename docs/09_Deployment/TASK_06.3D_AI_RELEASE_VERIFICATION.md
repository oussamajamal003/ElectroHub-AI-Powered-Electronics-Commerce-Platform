# Task 06.3D — AI Release Verification

**Review date:** 2026-11-19

**Scope:** Offline local-candidate integrity and focused AI tests. This is not production release approval.

## Artifact identity and checksums

| Identity | Verified value |
|---|---|
| Model directory | `apps/ai-service/models/siglip2-b16-p256-d1` |
| Model version / embedding version | `siglip2-b16-p256-d1` / `siglip2-b16-p256-d1-b3900dd9fad5` |
| Preprocessing / dimension | `siglip2-rgb-r224-bilinear-norm05-v1` / 256 |
| Model `weights.json` SHA-256 | `b3900dd9fad5222758071cdaede682cb375a1ae8cf06624c30346abd1aff243a` |
| Model descriptor SHA-256 | `d18f1cc6f8d219c1931275d0e2752aa140a07b1b81256aff41cf1f0b127ce189` |
| Model file set | 13 files, 186,581,546 bytes; all declared size/hash entries verified |
| Relevance directory | `apps/ai-service/models/relevance-siglip2-d3` |
| Relevance version / backbone | `siglip2-b16-p256-d1-family-gate-v2` / `siglip2-b16-p256-d1` |
| `relevance.json` SHA-256 | `3d2baad2bcd95ad77c474115c958056b01afb6e9498f52c6116fe4a07f114175` (1,379 bytes) |
| `head.safetensors` SHA-256 | `db8acc3ab3bc5ee669a4ea193e29e5dc8beb67748938ed91cc951d73fdbf6587` (17,612 bytes) |
| `family_gate.safetensors` SHA-256 | `be4e874667e7ab86742805788b7055d427eba8018dead5543b4755fdf7ba952a` (141,632 bytes) |

The candidate manifest's expected model and relevance identities and per-file digests are unchanged. It now declares the two checkout-relative directories so a verification command cannot silently substitute another ignored model generation.

## Exact verification commands and outcomes

Commands below ran from the repository root unless the working directory is stated.

| Command | Result |
|---|---|
| `python apps/ai-service/verify-model-artifact.py docs/09_Deployment/AI_MODEL_ARTIFACT_CANDIDATE.json apps/ai-service/models/siglip2-b16-p256-d1 apps/ai-service/models/relevance-siglip2-d3 .` | **PASS**, exit 0: `Local model and relevance artifact bytes match the candidate manifest.` |
| Same command with `apps/ai-service/models/relevance-siglip2-d1` as the relevance directory | **EXPECTED REJECTION**, exit 1: `relevance artifact directory does not match the candidate manifest` |
| From `apps/ai-service`: `venv/Scripts/python.exe -m pytest -p no:cacheprovider tests/test_relevance_gate.py tests/test_siglip_loader.py tests/test_task_063_artifact_manifest.py tests/test_task_063_release_healthcheck.py` with `PYTHONDONTWRITEBYTECODE=1` | **PASS**, 49 passed in 1.99s |
| From `apps/ai-service`: `venv/Scripts/python.exe -m ruff check verify-model-artifact.py tests/test_task_063_artifact_manifest.py` | **PASS** |
| From `apps/ai-service`: `venv/Scripts/python.exe -m ruff format --check verify-model-artifact.py tests/test_task_063_artifact_manifest.py` | **PASS**, both files formatted |

The initial attempt to run pytest with the system `python` was **BLOCKED by that interpreter's environment** (`ModuleNotFoundError: fastapi`; a direct model-load attempt also lacked `torch`). The repository's existing AI-service virtual environment was present and was used for the successful test and loader checks. No package was installed.

## Loader and preprocessing compatibility

The following read-only checks ran using `apps/ai-service/venv/Scripts/python.exe`:

- `read_descriptor(..., preprocess_version=PREPROCESS_VERSION, embedding_dimension=EMBEDDING_DIMENSION)` accepted the local model descriptor. It returned model version `siglip2-b16-p256-d1`, embedding version `siglip2-b16-p256-d1-b3900dd9fad5`, the expected preprocessing version, and dimension 256.
- `verified_weight_files` verified all 11 safetensors weights listed by the model's `weights.json` (ten vision shards plus projection) against the descriptor-bound manifest digest.
- `load_relevance_gate(Path('models/relevance-siglip2-d3'), model_version=d.model_version, feature_dim=d.embedding_dimension)` loaded the actual D3 head and family-gate tensors. It returned relevance version `siglip2-b16-p256-d1-family-gate-v2`, the expected backbone, `family_gate_loaded=True`, and threshold `0.35`.
- The D3 metadata serialization was reconstructed in memory using the tracked `training/build_family_gate.py` update and serialization behavior, the D2 `relevance.json` base, D3 version/threshold and current family-gate digest. The expected CRLF-encoded bytes exactly matched D3 `relevance.json` (1,379 bytes, SHA-256 `3d2baad2bcd95ad77c474115c958056b01afb6e9498f52c6116fe4a07f114175`). No training or artifact write occurred. The executed comparison was equivalent to:

  ```python
  source = json.loads(d2_relevance.read_text(encoding="utf-8"))
  source.update(
      relevanceVersion="siglip2-b16-p256-d1-family-gate-v2",
      familyGateSha256=sha256(d3_family_gate_bytes).hexdigest(),
      minFamilyEvidence=0.35,
  )
  text = json.dumps(source, indent=2) + chr(10)
  expected = text.replace(chr(10), chr(13) + chr(10)).encode("utf-8")
  assert expected == d3_relevance_json_bytes
  ```

- The focused `test_siglip_loader.py` suite covers descriptor/weight integrity behavior, safe file-list validation, the network output shape, and the documented preprocessing tensor shape/value behavior. The relevance suite covers version mismatch, digest mismatch, malformed tensors and fail-closed family-gate behavior. The candidate artifact-manifest and release-health tests also passed.

The complete `load_siglip_encoder` cold start and real-image inference were **NOT RUN** in this task. The selected checks validate model descriptor/weight integrity and load the actual relevance artifact without allocating the full SigLIP model working set or running an inference service.

## Release conclusion

- **Local candidate artifacts:** **VERIFIED** against the repository candidate manifest and the tracked Task 04.2 D3 provenance record.
- **Loader/preprocessing compatibility:** **PARTIALLY VERIFIED** locally through descriptor checks, actual relevance-gate loading and focused unit tests; a full model cold-start/inference run is not claimed.
- **AI production release readiness:** **NO-GO / NOT ESTABLISHED.** The manifest is explicitly a local candidate, not a production release. This work did not inspect production catalog/index state, query any Supabase project, package an immutable release bundle, or authorize model activation.

See [the artifact provenance report](TASK_06.3D_ARTIFACT_PROVENANCE_REPORT.md) for the corrected root cause and remaining release gates.
