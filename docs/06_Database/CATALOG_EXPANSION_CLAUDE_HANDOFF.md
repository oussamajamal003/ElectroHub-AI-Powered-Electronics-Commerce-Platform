# Claude Code continuation prompt — Catalog expansion Part 1 and Part 2 handoff

> **Superseded 2026-10-23.** Historical Codex → Claude continuation prompt. Current state, evidence and the Part 2 handoff are in [CATALOG_EXPANSION.md](CATALOG_EXPANSION.md).

Continue the existing ElectroHub catalog-expansion work. Read this entire document, the original task and repository instructions before modifying anything. This is a continuation of partially completed work, not permission to recreate the implementation or reset data.

## Workspace and original instructions

- Repository: `C:\Users\ouss0\Desktop\Tools\Coding\Portfolio\ElectroHub — AI-Powered Electronics Commerce Platform`
- Current branch: `feature/Catalog-Expansion-Real-Product-Media`; original baseline commit `734f6ce`.
- Original complete task: `C:\Users\ouss0\.codex\attachments\afd9cfa7-381a-4049-a4ce-28e31a60a5b4\Pasted text.txt`.
- Read `AGENTS.md`, `AGENT_COORDINATION.md`, `docs/06_Database/CATALOG_EXPANSION.md`, `docs/06_Database/SEEDING.md` and relevant environment/database runbooks.
- Preserve all current uncommitted work. Inspect branch, status and diff first. No commit, push, merge, deployment, PROD write or database reset is authorized.
- Do not implement the Part 2 Home/Products redesign in this workstream. Finish Part 1 and deliver the frontend contract below.

## Authorization and image-generation restriction

The owner authorized the scoped additive DEV seed only after target verification, full dataset/media validation, isolated QA, repeat/idempotency and reviewed dry-run. DEV project is `pzxekjybdiulzmssalfo`; PROD `yepfgjehdstlxbpespun` is forbidden.

Image generation is authorized ONLY through Codex's built-in imagegen while signed into the owner's ChatGPT Plus account. Codex previously verified `auth_mode=chatgpt` without an API key and generated the approved previews. This does not authorize Claude API image generation or any alternative service. Do not use `OPENAI_API_KEY`, the OpenAI API, third-party generators or purchased credits. If Claude cannot access the specifically authorized built-in capability, continue independent implementation/QA and leave exact missing/rejected images for Codex. Do not substitute placeholders, reused product views or pretend that approval exists.

All generated assets are illustrative storefront renders, not authenticated model photographs. They are not authorized as ground-truth Kaggle/ML training data. Public manufacturer links establish specifications, not image-reuse rights.

Codex asked its three active workers to checkpoint and pause after their current calls for this handoff. The home-controls and printing workers subsequently reported stream-disconnection failures; their final completion reports were not received. Check their saved files and provenance ledgers rather than assuming completion. Check the filesystem again: a final in-flight generation may have landed after this snapshot. Avoid concurrent edits with a resumed Codex session.

## Verified state at handoff, 2026-10-23

### Latest update — all five missing images completed by the parent

The owner subsequently asked the Codex parent to generate the five remaining images personally. All five paths listed in the historical snapshot below are now generated, visually inspected, imported as WebP and fully decoded. **The current saved-file count is 166/166.** The parent used only the built-in image-generation tool; no subagent, API or third-party generator was used for these five. All five decode to 1254×1254. Prompts, original source paths, final hashes/dimensions, rights and review records are in `apps/backend/prisma/data/catalog-expansion-media-last-five.json`. The K780 alternate was regenerated after rejecting a first draft too similar to its primary; the selected result shows the rear cradle in the foreground and numeric keypad on the viewer's left. Preserve this ledger and merge these five records into the full home-controls batch. Do not generate these five again.

The remaining steps are printer corrections, refreshing/integrating batch and global manifests, complete media/browser validation, isolated QA/idempotency/API checks, conditional DEV dry-run/apply/postchecks and final evidence. The older missing-file statements below describe the prior snapshot and are superseded by this update; no completed full-manifest or database acceptance is implied by 166 saved files.

The latest progress command reported **161/166 saved final WebP paths**. This is a file-existence count, not approval of 161 assets. Recompute using:

```powershell
node apps/backend/scripts/catalog-expansion-progress.cjs
```

Missing at that snapshot:

```text
/images/catalog/expansion/category-smart-home.webp
/images/catalog/expansion/category-keyboards-mice.webp
/images/catalog/expansion/logitech-k780-alternate.webp
/images/catalog/expansion/logitech-k120-primary.webp
/images/catalog/expansion/logitech-k120-alternate.webp
```

Media review issues still require resolution:

- CPU correction assignment is COMPLETE: all 12 assigned replacements were generated, imported and individually visually reviewed by the catalog worker, including final primary/alternate contact-sheet review. Accepted images use notched AM5 geometry and distinct elevated primary/low opposite-corner alternate views. `catalog-expansion-media-corrections.json` records `status: complete`, `completedCount: 12`, `remainingTargets: []`, `activeGeneration: null`, prompts, source PNGs, hashes, dimensions and approval results. The parent independently verified all 12 accepted hashes against the saved WebP bytes on 2026-10-23. Superseded drafts are archived; the ledger also retains a rejected near-identical initial alternate. Do not regenerate these completed images. Refresh their hashes in the 69-asset batch and final 166-asset manifest. Paired review sheets: `.cache/catalog-cpu-correction-pairs-1.jpg` and `-2.jpg`.
- The storage/components/networking batch has stale hashes and pending approval after corrections. Rebuild it only after all replacements are saved, then visually inspect it.
- Printer review found Brother HL-L2400D black in the primary but light gray/white in the alternate. Correct the mismatch. MFC-J4355DW images show visible external CMY tank windows: verify the official model's physical design and correct both views if inaccurate. The printing worker was informed; inspect its latest output before repeating work.
- Root already replaced Samsung 870 EVO alternate (previously a multi-unit collage), Samsung T9 primary (previously wrong texture), Ryzen 9950X primary and Ryzen 9900X primary. Their provenance is in `catalog-expansion-media-root-corrections.json`.
- Review all completed category sheets; camera/audio was independently inspected. Recovered images may lack the exact historical prompt/source-path record; preserve that limitation truthfully.

**No catalog-expansion seed has run on QA or DEV.** No complete final manifest, browser acceptance, QA idempotency result or DEV post-seed acceptance has been established.

## Work implemented

### Dataset

`apps/backend/prisma/data/catalog-expansion.json` contains metadata and `dataset`: exactly 79 real product identities, `EH-CE-001` through `EH-CE-079`, eight categories and eight represented brands. Official sources are recorded. Every product has at least six specifications and two deterministic local image paths. Brands represented: Canon, JBL, Samsung, AMD, TP-Link, Tapo, Logitech and Brother. Prices are illustrative USD demo values, stock initializes to 24 simulated units, compare-at prices are null, and no reviews/ratings are fabricated. Existing dataset validation passed.

Validated dataset digest: `5f23d1d3851025a6ab317e9e6b441e563e6f3e1eebec0916385a989d27b09e54`. Recompute if data changes.

### Additive seed and evidence

- `apps/backend/prisma/catalog-expansion.ts`: extends existing validation, deterministic owned IDs, exact 79-SKU/eight-category gates, full media/hash/rights/review validation before connecting, target gates, default dry-run, serializable bounded transaction, conflict rejection, limited batches and repeat reconciliation. Existing inventory is preserved. Foreign/manual children are rejected rather than deleted.
- `apps/backend/prisma/catalog-expansion-evidence.ts`: read-only consistent snapshots using row hashes, checks unchanged dry-runs and preservation of unrelated records across all public tables.
- `apps/backend/scripts/catalog-expansion.ts`: CLI, pinned isolated QA configuration, verified-TLS adapter, authenticated DB identity, dry-run plan, QA repeat/preservation evidence and conditional DEV apply. QA evidence and a recent DEV dry-run plan must match data/media digests.
- Never call the general `prisma/seed.ts` or `seedProductDataset` on shared DEV. They can reset administrators and replace existing inventory/media/specs. No migration is needed or introduced.

### Media tools and files

Under `apps/backend/scripts/`: `catalog-expansion-progress.cjs`, `catalog-expansion-media.py`, `catalog-expansion-import.py`, `catalog-expansion-decode.py`, `catalog-expansion-finalize-media.ts`.

Batch manifests under `apps/backend/prisma/data/`:

```text
catalog-expansion-media-camera-audio.json
catalog-expansion-media-storage-components-networking.json
catalog-expansion-media-home-controls.json
catalog-expansion-media-printing.json
catalog-expansion-media-corrections.json
catalog-expansion-media-root-corrections.json
```

Some are partial/pending/stale. Inspect their contents rather than trusting filenames. The finalizer expects four complete approved category batches, combines exactly 166 unique assets, fully decodes images with Pillow, binds hash/dimension attestations, validates and writes `catalog-expansion-media.json` and `catalog-expansion-media-review.json`. Never mark an asset visually approved without actually inspecting it.

Saved storefront assets: `apps/frontend/public/images/catalog/expansion/`. Five requested preview PNGs, their manifest and README: `assets/catalog-expansion/previews/`. Original generator outputs are preserved under `C:\Users\ouss0\.codex\generated_images\`; do not delete them. Contact sheets and temporary evidence are under `.cache/catalog-expansion/` or backend `.cache/`; inspect script paths.

### Verification tools

- Backend: `tests/catalog-expansion.seed.test.ts`, `tests/catalog-expansion.evidence.test.ts`, opt-in `tests/catalog-expansion.database.test.ts`.
- Frontend: `tests/catalog/catalog-expansion-assets.spec.ts`, uses existing `playwright.catalog.config.ts` and checks all 166 HTTP image responses plus browser decoding/dimensions.
- `apps/backend/scripts/catalog-expansion-api-smoke.ts`: local-only read-only API acceptance. Verifies all 79 summaries, eight categories and eight representative details. Newly added; its compilation and execution were pending when handed off.
- Package scripts: `catalog:expansion`, `catalog:expansion:finalize-media`, `catalog:expansion:api`.

## Checks actually run

- Offline `catalog:expansion --validate-data`: passed.
- Focused seed/evidence tests: 14 passed; one real database test skipped pending complete media. Earlier existing product-seed tests also passed. These are not live seed evidence.
- Backend ordinary typecheck, lint and build: passed before the newest API-smoke helper.
- Focused strict TypeScript and scoped ESLint covering launcher/finalizer/seed/evidence: passed before the newest helper. Ordinary backend tsconfig excludes Prisma/scripts/tests, so repeat focused checks including that helper.
- Frontend asset test scoped ESLint: passed. Browser asset acceptance has not run.
- All five preview PNGs decoded with Pillow, 1254×1254.
- Isolated PostgreSQL identity/TLS status: verified `localhost:55434/electrohub_disposable`, `electrohub_disposable|55434|true`. This does not establish seed correctness.
- GitHub CI, complete visual QA, QA application/repeat, DEV dry-run/apply and API acceptance: NOT VERIFIED.

## Remaining execution sequence

1. Reconcile saved assets and worker checkpoints. Finish missing images through the authorized Codex capability, resolve the printer issues and inspect full-size images/contact sheets for model form, view distinction and consistency. All 12 assigned CPU corrections are complete; integrate their verified hashes and approval ledger without regenerating them.
2. Rebuild stale media batches. For the 69 storage/components/networking assets, from repository root:

```powershell
python apps/backend/scripts/catalog-expansion-media.py --categories storage-ssds,computer-components,networking-wifi --output prisma/data/catalog-expansion-media-storage-components-networking.json
```

This produces a draft, not approval. Review then update approval/provenance truthfully. Ensure home-controls has all 42 assets, not just the resumed worker's additions. All four batches must have fresh hashes and approved status before finalizing.

3. Finalize and validate offline, from backend:

```powershell
npm run catalog:expansion:finalize-media
npm run catalog:expansion -- --validate-data
npm run catalog:expansion -- --validate-media
```

4. Repeat relevant tests/typecheck/lint/build. Include the new API helper in strict standalone compilation. From frontend run:

```powershell
npx playwright test -c playwright.catalog.config.ts catalog-expansion-assets.spec.ts
```

5. Preserve the existing isolated cluster. PostgreSQL 17.11 binaries are `C:\PostgreSQL\17\bin`; set `PG_BIN` accordingly. Do not initialize/reset or use the PostgreSQL 18 service. `.isolated/env.json` contains private connection configuration; never print credentials. Loopback DB access was sandbox-blocked and required explicit tool escalation in Codex.
6. Run from backend:

```powershell
npm run catalog:expansion -- --target=qa --apply --verify-repeat
```

Inspect real snapshot/preservation and zero-write repeat results; retain QA evidence. Optionally run the opt-in integration test using both pinned isolated URLs/CA and manifest/review environment paths. Do not inherit shared DEV URLs into tests.
7. Start a local backend against isolated QA using established environment setup; avoid unrelated mail/payment workers. Run API smoke with its explicit local origin. Do not claim QA APIs passed without execution.
8. Capture fresh read-only DEV baseline through trusted target metadata. Confirm both connection URLs and exact approved DEV project, verified TLS and database identity. Run `--target=dev` without apply, inspect the plan/collisions and expected rows. Then use the existing approval gate `CATALOG_EXPANSION_DEV_APPROVED=pzxekjybdiulzmssalfo` only for the authorized scoped apply after all conditions pass. The launcher requires matching QA evidence and a DEV plan no older than one hour. Read the CLI before invocation; do not bypass gates or manually insert via SQL.
9. Apply the dedicated seed, perform read-only postchecks and API smoke from the DEV backend. If unrelated concurrent changes cause preservation evidence to fail after commit, investigate read-only; do not replay/reset the broad seed.
10. Update the runbook, CE-01 through CE-20 evidence matrix and final Part 2 handoff. Mark incomplete requirements honestly. No new commit/push/deployment.

## REQUIRED HANDOFF TO PART 2 — frontend contract

This section is a provisional contract. The implementer must replace pending operational results with actual evidence after Part 1 finishes. It is not an assertion that DEV already contains the new rows.

### Exact category names, slugs, image URLs and product counts

All image URLs below have prefix `/images/catalog/expansion/`.

| Exact name | Slug | Category image filename | New products |
|---|---|---|---:|
| Cameras & Photography | cameras-photography | category-cameras-photography.webp | 8 |
| Speakers & Audio | speakers-audio | category-speakers-audio.webp | 12 |
| Storage & SSDs | storage-ssds | category-storage-ssds.webp | 10 |
| Computer Components | computer-components | category-computer-components.webp | 15 |
| Networking & Wi-Fi | networking-wifi | category-networking-wifi.webp | 8 |
| Smart Home | smart-home | category-smart-home.webp | 10 |
| Keyboards & Mice | keyboards-mice | category-keyboards-mice.webp | 10 |
| Printers & Scanners | printers-scanners | category-printers-scanners.webp | 6 |

### Verified DEV counts versus pending expansion

Read-only DEV baseline observed 2026-10-22: 150 products; 127 ACTIVE/visible/non-test products; 21 categories; eight storefront categories; 10 brands; 274 image records and 151 distinct image URLs; zero EH-CE SKUs. These are historical verified baseline values, not fresh current counts.

If the baseline remains unchanged, expected after expansion: 229 total products, 206 visible products, 29 categories, 16 storefront categories, 432 image records and 309 distinct product image URLs. The exact final brand count must be checked, not inferred. **Post-seed DEV counts are currently NOT VERIFIED.** Record fresh before/after totals, timestamp, target identity and differences before marking Part 1 complete.

### Product/category API behavior

Existing repository contract, pending live acceptance of the new data:

- `GET /api/products?page=1&pageSize=100` returns `{data, meta}` with `meta.total`; prices are decimal strings. Summaries include `category.slug`, nullable `brand`, nullable `primaryImage`/`secondaryImage`, availability and nullable compare-at price. Do not invent category query support; inspect the actual validators before using filters.
- `GET /api/categories?pageSize=100` returns paginated category objects including slug/name/imageUrl. The service exposes categories with ACTIVE, visible, non-test products; test fixture categories remain hidden through existing rules. Inventory and storefront visibility are separate.
- `GET /api/products/:slug` returns `{data}` with SKU, marketed model identity, image list and grouped specifications. Expect two SKU images and one primary for these products; demo initial inventory is 24, while repeat seed preserves real inventory changes.
- No API/schema redesign or new frontend components were introduced. Preserve existing loading/empty/error behavior and pagination; consume API results rather than hardcoding a visible total of 206.

### Representative detail links

These are planned frontend paths from curated product slugs, **not verified live browser links**. Verify the application's actual route and frontend origin, then provide clickable absolute links after DEV API/browser checks. Their read-only detail API counterparts are `/api` plus each path.

| Category | Representative | Planned detail path |
|---|---|---|
| Cameras | Canon EOS R50 | /products/canon-eos-r50 |
| Audio | JBL Go 3 | /products/jbl-go-3 |
| Storage | Samsung 990 PRO 1TB | /products/samsung-990-pro-1tb |
| Components | AMD Ryzen 9 9950X | /products/amd-ryzen-9-9950x |
| Networking | TP-Link Archer AX55 | /products/tp-link-archer-ax55 |
| Smart Home | Tapo C200 V1 | /products/tapo-c200-v1 |
| Controls | Logitech MX Master 3S Bluetooth Edition | /products/logitech-mx-master-3s-bluetooth-edition |
| Printing | Brother HL-L2400D | /products/brother-hl-l2400d |

### Asset provenance and frontend usage

- Two unique local WebP views per SKU plus eight category images: 166 assets in total. Use API image URLs and primary/secondary ordering; do not replace them with a category-wide product placeholder.
- Match existing square white/light-gray studio framing, soft shadows and unbranded illustrative rendering. Confirm final manifest dimensions; existing samples are 1254×1254. Do not assert every final asset's dimensions until validated.
- Preserve illustrative disclosure in documentation and any applicable storefront context. Never label these as manufacturer/model photographs or training ground truth. Final manifest records hashes, dimensions, source, visual approval and rights scope; retain original generation provenance and acknowledge gaps.
- Prices are simulated USD demo values, not verified offers. Stock is simulated at creation. No invented discounts or review data. Camera listings are body-only; regional smart-home electrical requirements and capacity/switch variants are explicit in the dataset.
- Part 2 must follow existing ElectroHub design tokens, components, Figma references and responsive architecture; this task does not authorize an entire frontend redesign.

### Known limitations and required evidence attachment

At handoff, five image files are missing, the completed/reviewed CPU replacements require global manifest hash refresh, printer form/color issues remain, combined final media approval is pending, and no live seed/API acceptance has run. Some generated-model details are illustrative approximations; official specification sources do not establish exact visual authenticity or local distributor availability. Some recovered generation prompts are unavailable and must stay disclosed.

Attach actual final data/media validation results, browser decoding results, QA first/repeat summaries, unrelated-data preservation evidence, DEV identity/dry-run/apply/postcounts and representative API responses. Include local typecheck/lint/build/test results and explicitly label remote CI/Figma/live verification that was not performed. Never mark an acceptance row PASS based only on the existence of this document.
