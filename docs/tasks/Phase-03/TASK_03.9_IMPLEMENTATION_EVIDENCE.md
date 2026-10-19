# Task 03.9: PDF Documents — implementation evidence

| | |
|---|---|
| Branch | `feature/PDF-Documents` |
| Base | `develop` @ `510b41cd4da7f0260e711df0db099148060b6c97`, unchanged since the specification |
| Status | **Implementation substantially complete. Final closure records PDF09 as PARTIAL pending independent Principal Architect decision.** Not integrated, not released. |
| Recorded | 2026-10-19 |
| Push / merge / deploy | **None during this closure.** Committed HEAD matches the remote feature branch; closure edits are local and uncommitted. |

The specification is [TASK_03.9_PDF_DOCUMENTS.md](TASK_03.9_PDF_DOCUMENTS.md). The feature, API and runtime reference is [docs/05_Features/PDF_DOCUMENTS.md](../../05_Features/PDF_DOCUMENTS.md).

## 1. Decisions

| Decision | Result |
|---|---|
| Legal mode | `COMMERCIAL_V1`. The invoice is titled "Order invoice — commercial transaction statement". It carries "Not a tax invoice" prominently on page 1 and in every footer, with no tax, seller registration, "Bill to" or sequential number. "TEST TRANSACTION — no live payment" appears on every output. |
| Database | **No migration.** The Prisma schema and all 20 migrations are byte-unchanged (`git diff -- apps/backend/prisma` is empty). Documents render on demand from existing Order, OrderItem, Payment and PaymentAttempt facts. |
| Renderer | PDFKit `0.20.2` (MIT), fontkit `2.0.4` (MIT) and bidi-js `1.1.0` (MIT), pinned exactly. There is no Chromium. |
| Fonts | Poppins 400/500/600, Noto Sans 400/600 and Noto Sans Arabic 400/600 (OFL 1.1, license texts packaged), sourced from the `@expo-google-fonts` npm packages. Their SHA-256 values are pinned in `assets.ts` and verified when a worker starts. |
| Isolation | A pool of 2 worker threads, a queue of 8, a 10 s hard deadline enforced by `worker.terminate()`, a 15 s request budget and one generation in flight per user. |
| Optional Brevo attachments | **DEFERRED / OFF.** They would require edits to the protected 03.8 producer, dispatcher and Brevo payload, plus a new immutable event-descriptor version. Customer downloads do not depend on them. |
| Plan Mode / agents | Formal Plan Mode was not entered. The plan was written down and followed without stopping for approval. The lead was Opus 5.5. Five Haiku 5.5 agents each owned one test or story file: domain, renderer/pool, API, frontend unit, and Storybook. |

## 2. Gates

| Gate | Provenance | Command / environment | Result |
|---|---|---|---|
| Backend typecheck / lint | local | `tsc --noEmit`, `npm run lint` (apps/backend) | exit 0 / exit 0 |
| Backend `src` suite | UNIT + MOCKED API | `npx vitest run src` | **1210 passed**, 98 skipped (opt-in live suites); exit 0 |
| Task 03.9 backend files | UNIT + MOCKED API + REAL WORKERS | domain 89, renderer 23, pool 8, routes 48 | **168 / 168** |
| Frontend typecheck / lint | local | `tsc -b`, `npm run lint` | exit 0 / exit 0 |
| Frontend suite | UNIT (jsdom) | `npx vitest run` | **866 / 866**, including apiBinary 19 and documents panel/dialog/chooser 36 |
| Builds | local | backend `tsc`, frontend `npm run build`, `npm run build-storybook` | exit 0 / exit 0 / exit 0 |
| Intercepted Orders Playwright (earlier run) | INTERCEPTED BROWSER | `playwright test -c playwright.orders.config.ts` | 43 passed, **16 stale-build footer `color-contrast` failures**; the final rebuilt-bundle focused run is recorded in §9. |
| Real PostgreSQL gate | REAL POSTGRES (disposable `electrohub_disposable` :55434, TLS verify-full, ledger 20/20) | `node scripts/document-isolated-check.cjs` | **ALL PASSED**. See §3 |
| Real-stack browser | REAL STACK (isolated frontend :3000 → backend :5000 → disposable PG → workers, no interception) | `ISOLATED_BASE_URL=http://localhost:3000 … playwright test -c playwright.isolated.config.ts order-documents` | **8 / 8 passed**. See §4 |
| Packaged build | compiled `dist/` + copied `assets/`, run from `C:\Windows\Temp` | `scratchpad smoke.cjs` | Rendered `%PDF-1.7`, 19,412 B (identical to the source build). With assets removed: `ASSETS_UNAVAILABLE`. Compiled document code contains no http/https/net/dns/fetch. |
| Docker image | — | Docker is not installed on this host | **NOT VERIFIED** (Dockerfile now copies `apps/backend/assets`) |
| DEV schema | DEV READ-ONLY (Supabase `pzxekjybdiulzmssalfo`, `BEGIN READ ONLY`) | MCP `execute_sql` | Ledger 20 finished / 0 bad (latest `20261018000000_commerce_email_outbox`). All 40 required columns are present. |
| PROD schema | PROD READ-ONLY (Supabase `yepfgjehdstlxbpespun`, `BEGIN READ ONLY`) | MCP `execute_sql` | Ledger 20 finished / 0 bad. All 40 required columns are present with the expected types. No write. |
| Live DEV authenticated download | — | — | **NOT VERIFIED.** The real-data gate ran on the disposable database. No backend was started against shared DEV. |

## 3. Real PostgreSQL gate (disposable database)

**Fixtures.** The fixture writes are labelled and reported separately:
- customers A, B and C, plus one owner per scenario;
- 9 orders for A's scenarios and 1 for C, all synthetic.

**Results.** All of the following passed through the real Express app with real auth, Prisma and worker rendering:

| Check | Result |
|---|---|
| Eligibility matrix | Matched exactly: paid / paid-cancelled / refunded / 50-line give 3× AVAILABLE; pending / legacy / failed give `PAYMENT_NOT_CONFIRMED` with the summary only; refunded without `paidAt` gives `HISTORICAL_PAYMENT_UNVERIFIED`; total mismatch gives `DATA_INCONSISTENT` for all three. |
| Status codes | Eligible kinds return 200 PDF. Ineligible kinds return 409 or 422 JSON and never a PDF. |
| Ownership | B on A, C on A and A on C each return 404 with a body identical to an unknown order, on both metadata and file. |
| Determinism | Inline and attachment bytes are identical across repeated requests. Renaming the product after purchase leaves the invoice bytes unchanged. |
| No side effects | Hashes of every fixture-scoped row (users, carts, cart_items, inventory, orders, order_items, payments, payment_attempts, commerce_email_outbox, refresh_tokens) are equal before and after the reads. Whole-table counts are unchanged across 14 commerce/auth tables. |

**Note on the first run.** The first unscoped whole-table hash run flagged `payment_attempts` / `payment_work`. The cause was the user's already-running isolated backend: its in-process recovery loop updated pre-existing DECLINED attempts. That process was left untouched, and the gate was re-scoped to its own fixture rows.

## 4. Real-stack browser and visual QA

Every screenshot below was opened and inspected. The files are under `apps/frontend/test-results/isolated/documents-*.png` and are not committed.

| Journey | Evidence |
|---|---|
| Details | Invoice, receipt and summary downloaded through real browser download events. Each has an `ElectroHub-ORD-…-<kind>.pdf` filename, starts with `%PDF-` and is over 10 KB. The page shows "PDF download started" and never "saved". There were no non-GET requests. Axe (scoped to the document UI) is clean. |
| Preview | Headed Chromium (desktop browser pane) showed the actual PDF in PDFium inside the dialog. Headless Chromium (`pdfViewerEnabled=false`) showed the fallback, and its Download reused the previewed bytes. Escape returns focus to View PDF, then to the Documents button. |
| My Orders | Pointer and keyboard activation open the chooser and the URL stays `/orders?page=2`. Clicking the card body still opens Details. The test now asserts one link plus one sibling Documents button per card. |
| Ownership (browser) | Customer B's request for A's document returns the same 404 text as an unknown order. |
| Session end | With a preview open, a session-expired event closes the dialog and leaves no blob frames. B then signs in, sees "Order not found" and gets no documents panel. |
| Responsive | Checked at 320 / 390 / 768 / 1440 / 1920: no horizontal overflow; every document button is ≥43 px tall with unclipped text; chooser and preview close buttons stay inside the viewport; Confirmation order is card → notice → documents → View Order Details. |

**Defects found by inspection and fixed:**
1. Focus was lost to `<body>` after preview close. Fixed with explicit opener restoration, and View stays focusable while its preview loads.
2. "Download PD" was clipped in the narrow Details aside. Fixed with auto-fit stacking of the actions.
3. At 390 px the chooser's close button sat left of its title, because a mobile rule meant for the preview header was leaking. The rule is now scoped.
4. At 320 px the card footer was cramped. The Documents action now wraps onto its own right-aligned row.
5. Button accessible names did not contain the visible text (WCAG 2.5.3). Names now read `View PDF: <label>, order <ref>`.

**Figma:** NOT VERIFIED. The Figma MCP requires authorization in this session. No Task 03.9 frame was inspected. Existing shell components and tokens were reused unchanged.

## 5. PDFs opened

These are synthetic samples from `npx tsx scripts/generate-document-samples.ts <dir>`, all at `commercial-template-1.0.0`. SHA-256 values are for these inputs; the gate's own PDFs from §3 are recorded in its run output.

| Sample | Bytes | Pages | SHA-256 |
|---|---|---|---|
| 01-invoice | 19,412 | 1 | `b365ed4c43bb29c91e1b2816be1dd117c8d8b33401de036051f07674023022f8` |
| 02-receipt | 17,917 | 1 | `b76d08960bd3e36cc265b5ab453c27d1b2547095a3dc66e794f5ec1e10b50770` |
| 03-summary | 19,033 | 1 | `ce2ee5c577c8a4af8d6c63bb257223c3e9686ed1c1bbc78614867ba67c8e1259` |
| 04-invoice-100-lines | 39,069 | 8 | `6920818963e22c274bbeb6ea483335f3011006c34acf3ffb6ce0cbcb11cb4268` |
| 05-invoice-refunded | 19,829 | 1 | `6de83a9d1411cf4a77d0f0547e28eed77c19451bab7a28ce59e2947b5a311f38` |
| 07-invoice-unicode-arabic | 28,266 | 1 | `6ecf4e4fde1d6f4c8fae2d124c36df662f62cc69732dc8a0dde82a4739de6feb` |

**Readers and extractors used:**
- pdf.js 4.10.38: an independent renderer, every page rasterized and inspected;
- xpdf `pdftotext` 4.00;
- Chromium PDFium, the viewer inside the app preview.

**Layout and content checks:**
- Headers repeat on continuation pages, and "Page X of Y" is correct.
- Totals appear exactly once.
- Full references are never ellipsized, and no footer overlaps content.
- Large amounts (`$6,249,999.95`) fit their measured columns.
- Metadata contains only the reference, brand and source date, with no customer name.

**Arabic and RTL:**
- The visual run order matches Chromium's own bidi layout for the same strings, checked word by word.
- Shaping is correct.

**Arabic copy/search — final closure check:** Chrome `155.0.8059.82` opened the actual PDFium viewer with this sample. Its full-page copy preserves the complete Arabic name (`أحمد محمد`), city (`بيروت`) and country line (`Lebanon — لبنان`), but reorders the full Arabic address and mixed product line into visual order, so those two source strings do not copy exactly. Ctrl+F caused PDFium to begin text extraction, but its search controls/results were not inspectable; exact search for at least two Arabic words is **NOT VERIFIED**. Raw PDF inspection found five correctly UTF-16BE-encoded `ActualText` spans, each containing the corresponding saved logical source line. pdf.js `4.10.38` exposes marked-content boundaries but its `getTextContent()` extraction does not substitute those values and uses the incomplete Arabic ToUnicode mappings; xpdf `4.00` also reports shared-glyph substitutions. The fontkit/PDFKit shaped-glyph mapping and PDFium's subsequent bidi pass are distinct limitations. PDFium source at [CPDF_TextPage::ProcessMarkedContent and CloseTempLine](https://pdfium.googlesource.com/pdfium/%2B/886f932aeeb4c0/core/fpdftext/cpdf_textpage.cpp) confirms that it inserts `ActualText` into a temporary line and applies bidi segmentation/reversal when closing that line. No safe renderer change was established: reversing or rewriting semantic `ActualText` for PDFium would make the replacement text incorrect for other consumers. **Arabic rendering passes; copy/search remains PARTIAL and PDF09 is PARTIAL pending an explicit compatibility decision or a standards-correct renderer/library fix.**

**Final visual checks:** `pdfinfo` reports A4 geometry (595.28 × 841.89 pt). The eight existing synthetic samples, including all pages of the 8-page invoice, were rasterized with Poppler `26.07`; first, continuation and final pages were opened and inspected. The Arabic sample was also rendered in grayscale at 144 dpi and inspected: contrast and meaning remain readable. The actual Chrome PDFium page was opened at `200%` and inspected; text remains legible and the page scrolls. A4 print preview and Letter fit-to-page remain **NOT VERIFIED**: Chrome's native Print action crashed in headless mode, and the headed browser did not expose an inspectable print-preview surface/settings. No physical print was made.

## 6. Performance (synthetic, `npx tsx scripts/document-perf.ts`)

Host: i7-1355U ×12, 16 GiB, Node 22.19.0. Pool size 2, waves of 4 concurrent callers. Times include queue wait.

| Lines | p50 | p95 | Size | Pages |
|---|---|---|---|---|
| 1 | 31 ms | 55 ms | 19 KB | 1 |
| 10 | 19 ms | 36 ms | 22 KB | 2 |
| 50 | 33 ms | 46 ms | 28 KB | 4 |
| 100 | 34 ms | 65 ms | 36 KB | 7 |

- Main event-loop delay while rendering: p99/max 21 ms.
- Peak process RSS including workers: 247 MiB.
- Cold worker start: about 325 ms.
- Targets (≤2 s and ≤5 s) are met with wide margin.
- Rate and concurrency limits are per process, not deployment-wide.

## 7. Traceability (PDF01–PDF20)

| ID | Implementation | Evidence | Status |
|---|---|---|---|
| PDF01 | branch / base / manifest above | §1, git | PASS |
| PDF02 | `pdf-renderer.ts`, `pdf-format.ts`, entry copy in `order-document.service.ts` | renderer tests, §5 | PASS |
| PDF03 | `order-document.domain.ts` `evaluateDocuments` | 89 domain tests, §3 | PASS |
| PDF04 | Decimal-exact validation, snapshot from Order/OrderItem only | domain tests, product-rename check | PASS |
| PDF05 | on demand, no migration, `contentVersion`, fixed metadata | byte-equality tests, §3 | PASS |
| PDF06 | `order-document.routes.ts`, owner predicate | 48 API tests, §3, §4 | PASS |
| PDF07 | private headers, RFC 6266 filename, size checks in `render-pool.ts` and `apiBinary` | API and apiBinary tests | PASS |
| PDF08 | no payment/cart/email imports; GET only | mock spies, real row hashes, browser request log | PASS |
| PDF09 | text engine, embedded fonts, pagination | §5 | **PARTIAL** (Arabic PDFium copy/search contract not met/verified) |
| PDF10 | `assets/`, `assets.ts`, Dockerfile | packaged smoke | PARTIAL (no Docker host) |
| PDF11 | Confirmation, Details aside, My Orders chooser | §4 | PASS |
| PDF12 | `useOrderDocuments.ts` epochs, abort, revoke | 36 component tests, §4 session-end | PASS |
| PDF13 | SCSS, accessible names | §4 at 5 widths, scoped axe, §9 | PASS (200% UI zoom and PDF page inspected) |
| PDF14 | `OrderDocuments.stories.tsx` (26 stories) | Storybook build and six opened stories, §9 | PASS |
| PDF15 | `render-pool.ts`, limits | pool tests, §6 | PASS |
| PDF16 | no schema change | §1, DEV/PROD read-only | N/A (no migration) |
| PDF17 | — | §1 | DEFERRED / OFF |
| PDF18 | suites | §2, §9 | PASS (final focused footer a11y clean; earlier stale-build failure recorded) |
| PDF19 | `PDF_DOCUMENTS.md`, swagger annotations, this file | — | PASS |
| PDF20 | self-review below | — | Ready for independent review |

## 8. Residual risks and limits

- **Arabic copy/search** remains a PDFium compatibility gap despite correct visual shaping and exact `ActualText` source strings (§5, §9).
- **Test-mode label** is policy-wide. A live or mixed rollout needs per-record provenance (specification §6.2).
- **Per-process limits**: the rate and concurrency limits are in memory. A multi-instance deployment needs proxy or global limits.
- **Not verified:** Docker image build, live DEV authenticated download, Figma, A4 print preview, Letter fit-to-page, PDFium exact Arabic search, and mobile Safari's inline PDF behaviour. Storybook representative states, grayscale legibility and PDFium 200% page zoom were inspected; 200% application UI accessibility is covered by §9.
- **Resolved accessibility regression:** an earlier intercepted Orders axe run reported footer copyright contrast failures. At current HEAD, after rebuilding the served frontend bundle, the focused suite is 16/16 clean; §9 records the exact result.
- **Self-review: 90/100** (SELF-REVIEW, not architect approval).

| Category | Score |
|---|---|
| Correctness | 19/20 |
| Security | 19/20 |
| Architecture | 14/15 |
| Concurrency / DB | 14/15 |
| Tests / evidence | 12/15 |
| Performance | 9/10 |
| Docs / operations | 4/5 |

## 9. Final closure pass — 2026-10-19

Closure was performed against branch `feature/PDF-Documents`, HEAD `d2ca61d33fdfdd613233047f0b7201e012320f99` (also current `origin/feature/PDF-Documents`), base `510b41cd4da7f0260e711df0db099148060b6c97`. No Prisma, migration, payment, order, Stripe or Brevo files/contracts changed. Existing untracked prompt files were preserved.

| Gate | Outcome | Evidence |
|---|---|---|
| Arabic rendering/copy/search | **PARTIAL** | Existing fixture `07-invoice-unicode-arabic.pdf`, SHA-256 `6ecf4e4fde1d6f4c8fae2d124c36df662f62cc69732dc8a0dde82a4739de6feb` (28,266 bytes; A4, 1 page), opened in Chrome `155.0.8059.82` PDFium. Arabic shaping is visually correct. Full-page copy preserves `أحمد محمد`, `بيروت`, and `Lebanon — لبنان`, but copies the address as `(٣ الطابق )النور بناية 12، الحمرا شارع` and product as `(أسود )2X Model — لاسلكية سماعات`, rather than the exact fixture strings. Exact Arabic search result is **NOT VERIFIED**. Raw PDF contains five exact UTF-16BE `ActualText` logical strings; pdf.js 4.10.38 ignores these for extraction and exposes fragmented/reordered glyph text (`محمد أ\u0005حمد`, etc.); xpdf 4.00 has shared-glyph substitutions. PDFium source inserts ActualText then applies bidi processing to the temporary line, consistent with the observed copy order ([source](https://pdfium.googlesource.com/pdfium/%2B/886f932aeeb4c0/core/fpdftext/cpdf_textpage.cpp)). No safe renderer-side workaround was proven; changing the semantic ActualText to appease PDFium risks incorrect accessibility/other-reader text. |
| Unavailable observability | **PASS** | `document_availability_changed` warning carries sanitizer-safe `reason` values `FEATURE_DISABLED` and `REQUIRED_ASSET_UNAVAILABLE`, emitted only on state change without order/customer/path data. `document_renderer_pool_changed` warns once on `RENDER_FAILED` only when pool stats report zero workers, and clears after a successful render; a single worker failure with another worker present is not mislabeled as total pool unavailability. Focused route tests assert configuration/asset causes, metadata unavailable entries, PDF 503 behavior, total-pool detection, partial-worker distinction, deduplication and recovery. |
| Docker runtime | **NOT VERIFIED** | No Docker/Podman/nerdctl/buildah executable and no container-build job in `.github/workflows/ci.yml`. Local compiled-runtime smoke passed: 18,549-byte parseable one-page invoice, embedded TrueType font, packaged assets, no network. Exact deferred container command: `docker build -f apps/backend/Dockerfile -t electrohub-backend:task-03.9 .` then `docker run --rm --network none -e ELECTROHUB_BACKEND_ROOT=/app/apps/backend -v "$PWD/apps/backend/scripts/document-container-smoke.cjs:/tmp/document-container-smoke.cjs:ro" --entrypoint node electrohub-backend:task-03.9 /tmp/document-container-smoke.cjs`. |
| Print/grayscale/zoom | **PARTIAL** | `pdfinfo` confirms A4 (595.28 × 841.89 pt); Poppler 26.07 rasters of all pages were opened and inspected, including the Arabic page rendered with `-gray` at 144 dpi; grayscale readability passed. Chrome 155 PDFium actual page at 200% was opened and inspected: legible and scrollable. A4 print preview and Letter fit-to-page are **NOT VERIFIED**: headless Print crashed; headed native print preview/settings were not exposed to inspection. No physical print. |
| Storybook visual states | **PASS** | Opened and inspected six existing stories via local Storybook: Paid All Available, Chooser Open, Metadata Loading, Metadata Error, Backend Unavailable and Confirmation Mobile 390. The desktop confirmation story wrapper was too narrow for its viewport and produced overlapping actions; its width now represents the wide confirmation surface. Updated screenshots are in ignored `apps/frontend/test-results/closure-story-*.png`. |
| Footer contrast | **PASS** | Rebuilt frontend before Playwright because Orders config serves `dist/`. Focused axe suite: 16/16 pass at 390px and 1440px. The prior 16 contrast failures were from stale `dist` (still `#94a3b8`); rebuilt bundle uses `#475569`. Opened the 200% full-page screenshot; copyright remains legible and footer layout is unchanged. No footer UI code change was needed in closure. |
| Focused regression | **PASS** | Current closure route/diagnostics test rerun: `npx vitest run src/routes/order-document.routes.test.ts` — **50/50**. Backend `npm run typecheck` and `npm run lint` — exit 0 after the observability correction. Previously completed route + renderer + pool set: **81/81**. Orders E10 accessibility set: 19/19 (includes all 16 axe cases, 200% page zoom, keyboard order, accessibility tree). Local compiled-runtime smoke passed. |
| Final safe suite | **REUSED** | Full backend 1,210, frontend 866, real PostgreSQL and 8/8 real-stack browser evidence remains attached to unchanged HEAD `d2ca61d`; closure changed only document diagnostics/story rendering and added a local container smoke script. Focused affected suites above were rerun. No remote CI, database write, Docker build, push, merge or deploy was performed. |

Closure files: `apps/backend/src/services/order-document.service.ts`, `apps/backend/src/routes/order-document.routes.test.ts`, `apps/frontend/src/features/orders/documents/OrderDocuments.stories.tsx`, and `apps/backend/scripts/document-container-smoke.cjs` (plus this evidence update). `Visual QA: PARTIAL` — Storybook states, grayscale output, responsive customer UI and PDFium 200% page zoom were opened and inspected; Arabic address/product copy is reordered, exact Arabic search is unverified, and A4 print preview / Letter fit-to-page remain unverified.

## 10. Final local source review — 2026-10-19

- **Review identity:** committed HEAD remains `d2ca61d33fdfdd613233047f0b7201e012320f99`; the four tracked edits above are local and uncommitted, and `document-container-smoke.cjs` is a local untracked Task 03.9 file. The two pre-existing untracked prompt files are outside this closure and untouched. No push, commit, merge or deployment.
- **Full-file review:** all five local closure files were read in full and compared with HEAD where tracked. Direct dependencies reviewed were PDFKit 0.20.2, pdf.js 4.10.38, the text engine, font assets, logger sanitizer, renderer pool/worker and Dockerfile.
- **Observability:** `FEATURE_DISABLED` and `REQUIRED_ASSET_UNAVAILABLE` are derived separately from configuration and the asset readiness probe. `RENDER_FAILED` marks the pool unavailable only when its stats report zero workers; a single failure with another worker present is not misreported. Diagnostics carry only fixed event/state/reason values; repeated unavailable states do not emit repeated warnings, and the pool warning clears after a successful render. Tests assert service-to-logger events, privacy, unavailable metadata/PDF behavior, total versus partial failure, deduplication and recovery.
- **Arabic:** source review and raw-PDF inspection found the five `ActualText` values match the stored logical source strings. Actual Chrome 155/PDFium full-page copy was verified: name, city and Lebanon line remain exact, but Arabic address and mixed product lines are reordered; exact Arabic search was not verified. pdf.js and xpdf remain affected by incomplete/shared shaped-glyph ToUnicode mappings. PDFium's extraction source inserts `ActualText` then applies bidi segmentation/reversal to the same temporary line. This is an actual supported-preview compatibility gap, not merely an unsupported-parser discrepancy. A one-sided `ActualText` reversal would corrupt semantic text for other consumers, so no source workaround was made without proof of cross-reader correctness. **PDF09 remains PARTIAL and requires an explicit compatibility decision or a standards-correct fix.**
- **Focused verification:** current local order-document routes/diagnostics **50/50** (`npx vitest run src/routes/order-document.routes.test.ts`); backend document routes/renderer/pool **81/81**; current backend typecheck and lint exit 0; Orders E10 accessibility **19/19** and focused axe **16/16**; Storybook representative states and local compiled-runtime smoke are recorded in §9. Previously accepted full backend/frontend, PostgreSQL and real-stack evidence is reused unchanged.
- **Operational gates:** `DOCKER IMAGE VERIFICATION: NOT VERIFIED`; no container builder was available. Poppler grayscale and actual PDFium page zoom at 200% passed visual inspection. A4 print preview and Letter fit-to-page are **NOT VERIFIED**; 200% document controls/preview dialog and six representative Storybook states were inspected. The Arabic copy/search gap is a demonstrated mandatory PDF09 acceptance issue for the supported Chrome PDFium preview; no standards-correct source fix is established in this pass. Independent architect decision is required before marking Task 03.9 fully accepted.
