# Task 06.3B — Capacity Assessment

**Assessment date:** 2026-11-17  
**Candidate:** DigitalOcean Basic Droplet, 1 shared vCPU, 1 GiB RAM, 25 GiB SSD. Current published rate reviewed as $6/month with 1,000 GiB included transfer; no Droplet was created.  
**Classification:** **INFEASIBLE FOR THE REQUIRED FULL STACK AS CURRENTLY IMPLEMENTED** on 1 GiB. This is a repository-based engineering conclusion, not a measured benchmark. A larger plan remains unselected and unapproved.

## Stack and known artifacts

Required online services in the candidate are Nginx + static React frontend, Express/Node API, private FastAPI + CPU PyTorch model, and external Supabase PostgreSQL/Storage. Payment/email/media workers remain separate opt-in profiles. Docker engine, the Ubuntu host, filesystem cache, logs and monitoring share the same host memory/disk. The external database avoids colocating Postgres, but does not reduce local inference memory.

| Measured from local checkout | Size / behavior | Evidence |
|---|---|---|
| SigLIP model directory `siglip2-b16-p256-d1` | 186,581,546 bytes including descriptor, `weights.json`, projection and ten sharded vision tensors. Individual model shards are ~15–19 MiB. | Local file stat and SHA-256 checks; `.gitignore` excludes model weights from the repository/source image. |
| Separate `relevance-siglip2-d3` artifact | 160,623 bytes: relevance manifest, head and family gate. | Local file stat and SHA-256 checks. |
| Runtime model | Python 3.11, CPU PyTorch 2.13.0, torchvision 0.28.0, safetensors; AI Dockerfile builds a Debian slim runtime and mounts model files read-only. | Dockerfile and pinned runtime requirements inspected. Container image size unavailable because Docker is absent. |
| Model load peak | Loader loads FP16 tensors into a Python state dict, makes a converted FP32 state dict for `load_state_dict`, and builds an FP32 model. Approximate weight working-set arithmetic is 186.6 MB FP16 + ~373 MB converted copy + ~373 MB model parameters = ~933 MB before allocator/runtime overhead and transient inference. | Inference from source tensor conversion and artifact bytes; **not** an observed RSS/peak measurement. PyTorch state copies/allocator behavior can alter the exact peak. |
| Query bounds | Runtime allows up to 8 MiB image uploads and 40 million decoded pixels (~120 MB RGB buffer/query), defaults to 2 concurrent inference slots and 2 Torch threads; production env example lowers concurrency/threads to 1. | Configuration defaults/templates inspected. Lower concurrency does not lower cold model-load working set. |
| AI temporary memory | Compose includes `/dev/shm` tmpfs up to 128 MiB; files consumed in tmpfs count toward host/container memory. | Compose inspected. |
| Node API and edge | Node 22 runtime, Prisma client, Express/Socket.IO, API request buffers, Nginx workers (candidate fixed to 1) and frontend static assets. | Dockerfiles/templates inspected; actual image size and memory unavailable. |
| Disk | 25 GiB must hold OS, Docker layers and metadata, API/AI/edge images, current and prior image releases, AI model/relevance artifacts, TLS, logs, temporary uploads and free-space reserve. | No container images were built, so exact footprint and growth are unknown. |

## Resource judgement

### Memory — blocker

The rough ~933 MB model load weight-copy estimate leaves about 91 MiB of a nominal 1 GiB for Python interpreter, PyTorch native libraries and pools, the OS, Docker, other containers, model-network allocations not reflected in raw artifact files, 120 MB decode buffers and health checks. Those terms are required and make the budget untenable. The observed source code creates full FP32 copies from FP16 weights, and the default online model loads at process startup. Running under swap might prevent a fast OOM in some cases, but it would consume disk and can turn model load/inference into unbounded latency and host-wide pressure; swap is not a capacity solution.

The API, edge and OS also need memory while AI is starting or serving. On a shared vCPU, PyTorch thread pools, image decode, Prisma/API traffic and Nginx compete. A cgroup memory limit does not create additional RAM. Container OOM, healthcheck restarts, swap thrashing or system OOM can take the edge, API and AI offline together.

### CPU — severe limitation

The Droplet provides one shared vCPU. The current model is a 12-layer, 768-hidden SigLIP vision tower plus projection. Single-image inference, cold-start warm-up, image decoding and 40 MP validation compete with all API/worker activity. A single Torch thread and concurrency 1 bound contention, but no local or VPS latency/throughput measurements exist. p50/p95 and capacity cannot be estimated credibly from repository source alone.

### Disk — plausible but unproven

The 186.6 MB model + 0.16 MB relevance directory is small relative to 25 GiB. However, the AI CPU PyTorch image size is not available; Docker build/cache layers and up to five prior release images can be multiple GiB. Retained container logs, OS upgrades, backups (not stored locally by this design) and overlay filesystem reserve also need measurement. Keep snapshots/backups outside this root disk only after an approved backup plan; no paid backup option is included in the stated plan price.

### Bandwidth and cost

The public pricing page currently lists 1,000 GiB transfer for the Basic 1 GiB Droplet at $6/month. Media downloads, product images, client bundles, uploads and AI service traffic consume egress; exceeding included usage can add cost. Snapshots/backups, taxes, and other billable resources are not assumed free. No forecast is available. Cloudflare Pages/Worker free alternative has its own request quota and does not solve VPS resource needs.

## Future separately authorized experiment protocol

This is a test plan only. Do not provision the candidate machine from this document.

1. On a separately approved isolated host, record baseline total/available/cgroup memory, CPU, disk and swap with only OS and Docker installed.
2. Build exact-SHA backend, AI and edge images; record compressed/unpacked sizes, build cache growth and `docker system df` before/after.
3. Start only required app services with live external dispatch disabled; record host and per-container `memory.current`, `memory.peak`, CPU seconds, throttling, pids, swap and restarts during API/edge readiness.
4. Start the AI service from a cold cache. Record peak RSS/cgroup memory during digest checks, shard deserialization, dtype conversion, model initialization and warm-up; record cold readiness duration and OOM/restart behavior.
5. With only synthetic, non-customer local fixtures, measure warm inference for one image and controlled concurrency 1; record p50/p95, errors, decoded bytes/pixels, host CPU and memory. Do not run impact-producing load against shared PROD/provider services.
6. Run separately controlled API/browser scenarios on a disposable/local harness with real Socket.IO upgrade and polling; record p50/p95 and resource peaks.
7. Add workers only in a later, separately authorized test with external dispatch disabled or isolated provider fakes; never enable live delivery as part of this experiment.
8. Record disk/log growth over the trial and simulate container restart, host restart and clean rollback.

**Proposed stop criteria for an authorized test:** any OOM/restart; any sustained swap-in/out under normal readiness; AI fails to become ready; any required feature is unavailable; memory peak leaves less than 25% host RAM free for non-model processes; CPU throttling or inference latency exceeds operator-approved limits; disk exceeds 70% or lacks at least 5 GiB free after retaining rollback images; health/readiness smoke fails; any unexpected external provider dispatch. The 25% and disk figures are conservative experiment gates, not measured ElectroHub requirements or a claim of production suitability.

## References

- [DigitalOcean Droplet pricing](https://www.digitalocean.com/pricing/droplets), reviewed 2026-11-17.
- Local source inspected: `apps/ai-service/app/models/siglip_loader.py`, `siglip_network.py`, `app/core/config.py`, `requirements-runtime.txt`, `Dockerfile`, `apps/ai-service/.env.production.example`, `infrastructure/production/compose.yaml` and model artifact files. SHA/size details are recorded in [AI_MODEL_ARTIFACT_CANDIDATE.json](AI_MODEL_ARTIFACT_CANDIDATE.json).
- Docker, Nginx and VPS measurements: **NOT AVAILABLE**. No images or services were built or started in this assessment.
