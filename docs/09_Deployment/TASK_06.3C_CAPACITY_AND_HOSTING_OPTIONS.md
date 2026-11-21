# Task 06.3C — Capacity and Hosting Options

**Research date:** 2026-11-19  
**Spend target:** $0. No provider was selected, account created, or resource purchased.  
**Measurement status:** source-derived estimates only; no VPS or Docker runtime measurements exist.

## Executive capacity finding

The $6/month, 1 GiB, 1 shared-vCPU Droplet is rejected for the required complete stack. The current AI loader's source-derived model-load working set is about **933 MB decimal / 889 MiB** before Python/PyTorch runtime, allocator overhead, FastAPI, image decode, Express, Nginx, Docker, OS, workers, caches, and logs. One 40-megapixel RGB image can require about **120 MB / 114 MiB** for decoded pixels. The 1 GiB host cannot credibly co-reside the required services without severe memory pressure and likely OOM or swap-driven latency.

An initial 4 GiB / 2 shared-vCPU option is a measurement candidate, not a proven minimum. **8 GiB / 4 shared-vCPU is the more credible first full-stack experiment** because it leaves room for non-model services and image preprocessing, but neither plan is approved or proven sufficient. CPU-bound inference, concurrency, actual Docker image sizes and peak RSS are not measured.

## Source-derived resource estimate

| Resource | Evidence and estimate | Classification |
|---|---|---|
| Vision model artifact on disk | Current local model directory contains 13 files, **186,581,546 bytes** (~186.6 MB / 177.9 MiB): ten FP16 shards, projection weights, and associated descriptor/weights. | Source/artifact inventory; not RAM measurement |
| Tensor/model-load working set | Loader accumulates the FP16 shard state (~186.6 MB), converts weights to FP32 (~373.2 MB), and loads an FP32 model (~373.2 MB): arithmetic estimate ~933 MB decimal (~889 MiB), before runtime overhead. | Source-derived peak estimate; not RSS |
| Relevance candidate | Manifest expects 160,623 bytes including `family_gate.safetensors`; current local relevance directory has 18,869 bytes and lacks that file. Current candidate release verification fails on `relevance.json` hash. | Concrete release blocker; do not activate |
| Image preprocessing | Defaults permit 8 MiB compressed input and 40,000,000 pixels. RGB decode alone is approximately 3 bytes/pixel or 120 MB decimal (~114 MiB) per active image, in addition to model and runtime. | Upper-bound arithmetic from configured limit; concurrency not measured |
| AI runtime | FastAPI/Python 3.11 with CPU PyTorch and safetensors; production Compose candidate sets AI concurrency and Torch threads to 1. This constrains parallelism but does not establish a memory or latency bound. | Source review |
| Other services | Node 22 Express API, Nginx edge, Docker/container runtime and OS need additional RAM/CPU. Payment/email/push/media workers are disabled by default; their eventual approved enablement still needs measured headroom and must not be silently omitted from the required product scope. | Runtime totals not measured |
| Disk | 25 GiB includes OS, Docker layers, image tar/import space, logs and releases. The model directory is small relative to this, but PyTorch image sizes, temporary image build/import duplication, release retention and log growth were not measured. 25 GiB is therefore unverified. | Not yet verifiable |
| Database | Supabase PostgreSQL/Storage remain external; no local PostgreSQL container is part of the reviewed required stack. AI vector access still depends on external service/network configuration. | Source topology |

The arithmetic adds simultaneous representations conservatively. Actual allocator reuse, memory mapping, framework behavior and peak timing may change the observed peak. The number must not be presented as benchmark data.

## Why 1 GiB fails as a full-stack target

- The source-derived model load alone approaches the entire advertised RAM, before Python/PyTorch and the host OS.
- Model loading overlaps weight representations; image decode adds a large transient allocation. Express/Nginx and container services compete for the remainder.
- A single shared vCPU is a serious bottleneck for CPU inference and commerce requests running alongside model load/inference. Shared-CPU burst behavior is not a performance guarantee.
- Swap may avoid immediate process termination but can produce unbounded latency and cascading health-check failures. It is not safe capacity planning for an interactive commerce system.
- A 25 GiB disk might hold final images but cannot be accepted without measuring image sizes plus import/build scratch, logs, backups and at least one rollback release.
- No actual OOM, latency, throughput or CPU measurements were collected. The plan is rejected by source-derived incompatibility, not by a fabricated benchmark.

## Current public plan comparison

Prices were checked on the providers' official pages on 2026-11-19. They are list prices, region and tax dependent; region availability and final checkout prices must be rechecked before any separately authorized purchase. **No paid provider is selected.**

| Provider / candidate | vCPU and RAM | SSD / transfer | List price | Backup and billing notes |
|---|---:|---:|---:|---|
| DigitalOcean Basic rejected baseline | 1 shared / 1 GiB | 25 GiB / 1,000 GiB outbound pool | $6/mo | This is the rejected plan. Droplet backup add-on is listed as weekly +20% or daily +30%: $1.20 or $1.80/mo at this plan price. Overage is $0.01/GiB. Powered-off Droplets remain billable. |
| DigitalOcean Basic candidate | 2 shared / 4 GiB | 80 GiB / 4,000 GiB pool | $24/mo | Weekly backup estimate $4.80/mo; daily $7.20/mo, making $28.80 / $31.20 before tax, snapshots, storage or overage. Shared CPU; region availability varies. |
| DigitalOcean Basic candidate | 4 shared / 8 GiB | 160 GiB / 5,000 GiB pool | $48/mo | Weekly backup estimate $9.60/mo; daily $14.40/mo, making $57.60 / $62.40 before tax, snapshots, storage or overage. Shared CPU; region availability varies. |
| Akamai Cloud Shared CPU candidate | 2 shared / 4 GiB | 80 GiB / 4,000 GiB pool | $24/mo on the reviewed pricing selector | Page allows region selection and may show different regional prices. Backups are separately priced; a reliable exact monthly total was not established. Hourly billing is rounded up and capped at monthly pricing for most services; powered-off instances can still incur charges. |
| Akamai Cloud Shared CPU candidate | 4 shared / 8 GiB | 160 GiB / 5,000 GiB pool | $48/mo on the reviewed pricing selector | Same region and backup qualifications. Provider describes shared compute as suitable for development/testing and workloads that are not resource intensive; model inference needs measurement. |

These estimates omit tax, snapshots, object storage, DNS/domain, monitoring, email, registry, and any separate backup/restore destination. At $0 initial spend, none of the paid VPS options is authorized. Free dynamic DNS or a provider-generated hostname is not a replacement for a measured, recoverable host.

## Future authorized capacity experiment

Run only after explicit approval to create a disposable host and use synthetic/local test data. Keep worker dispatch, payment, email, push and media sending disabled; no shared DEV or PROD database. Capture host size, image digests, config, workload script version, timestamps and raw metrics.

1. Record idle OS/container baseline: total/available RAM, per-container RSS/cgroup limits, CPU, disk, Docker image/layer sizes, log size, network and health state.
2. Cold-start AI once from an empty process; collect peak host and AI RSS, load duration, CPU, swap-in/out, OOM events, restarts, and readiness result.
3. Warm inference on approved synthetic images; record p50/p95 latency, throughput, CPU and RSS at concurrency 1, then modest bounded concurrency.
4. Run bounded Express requests while AI inference is active to check co-resident commerce API latency/errors and queueing. Add Socket.IO polling/WebSocket checks only with a safe local harness.
5. Track disk and logs during repeated start/stop, temporary image handling and one rollback image retention cycle.
6. Repeat cold start after host restart and after deploying the exact immutable image bundle. Verify AI unavailable behavior does not break core commerce paths.

**Proposed stop gates for that future experiment (not measurements):** stop immediately on any OOM/restart, unintended external dispatch, unexpected database target, sustained swap activity, less than 25% host RAM available at steady load, disk above 70% or below 5 GiB free, or the operator-approved latency/error threshold being exceeded. A production gate should require stable headroom at forecast peak load plus a separate backup/restore test; this report does not set the final SLO.

## Official sources (reviewed 2026-11-19)

- [DigitalOcean Droplet pricing](https://www.digitalocean.com/pricing/droplets)
- [DigitalOcean backup pricing](https://docs.digitalocean.com/products/backups/details/pricing/)
- [DigitalOcean bandwidth billing](https://docs.digitalocean.com/platform/billing/bandwidth/)
- [DigitalOcean region reference](https://docs.digitalocean.com/reference/terraform/reference/data-sources/regions/)
- [Akamai Cloud CPU pricing](https://www.akamai.com/cloud/pricing/cpu)
- [Akamai Cloud backup pricing](https://www.akamai.com/cloud/pricing/backups)
- [Akamai backup service documentation](https://techdocs.akamai.com/cloud-computing/docs/backup-service)
- [Akamai billing behavior](https://techdocs.akamai.com/cloud-computing/docs/understanding-how-billing-works)

**Decision:** 1 GiB full-stack plan rejected. 4 GiB/2 vCPU is a constrained test candidate. 8 GiB/4 vCPU is a more realistic initial capacity experiment candidate, not a selected or production-approved plan. All runtime capacity remains **UNVERIFIED**.
