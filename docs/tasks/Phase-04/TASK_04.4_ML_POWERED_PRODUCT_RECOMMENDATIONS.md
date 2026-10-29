# ELECTROHUB — TASK 04.4 / REAL ML-POWERED PRODUCT RECOMMENDATIONS

**Phase:** 04 — AI & Real-Time Features  
**Task:** 04.4 — ML-Powered Product Recommendations  
**Document status:** IMPLEMENTATION SPECIFICATION / STRONG FIRST HANDOFF — this document does **not** claim Task 04.4 is implemented, trained, deployed, or tested.  
**Prepared:** 2026-10-28  
**Feature branch:** `feature/04.4-ml-powered-recommendations`  
**Integration target:** `develop`  
**Proposed repository location:** `docs/tasks/Phase-04/TASK_04.4_ML_POWERED_PRODUCT_RECOMMENDATIONS.md`  
**Repository inspected read-only:** `oussamajamal003/ElectroHub-AI-Powered-Electronics-Commerce-Platform`, `develop` at `5f7aede9845ad1f739304ddf40ba71fc537df9ae`. This is a snapshot, not a substitute for inspecting the implementer's actual local HEAD/worktrees.  
**Prerequisites:** Task 04.1 FastAPI foundation, Task 04.2 real vision retrieval and versioned vectors, and **Task 04.3 closed and merged** (authoritative media sources/worker). Do **not** reopen Task 04.3 or regard its historical partial progress reports as current status.  
**Primary systems:** React 19 / TypeScript / Vite / SCSS Modules / TanStack Query; Node/Express/TypeScript/Zod; Prisma 6 / Supabase PostgreSQL / pgvector; Python 3.11+ / FastAPI / PyTorch; D3 SigLIP2 source-correct embeddings; Storybook 9 / Vitest / Playwright / pytest / Ruff / mypy. Verify current pinned versions in the repo.  
**Environment examples:** customer frontend `:3000`, Express `:5000`, FastAPI `:8000`; isolated QA frontend `:3200`, Express `:5200`, FastAPI `:8200`, disposable pgvector DB `:55434`. Verify actual running ports.  
**Supabase identities:** DEV `pzxekjybdiulzmssalfo`; PROD `yepfgjehdstlxbpespun`; these are distinct authorities and must never be mixed.  
**External authorization:** This specification authorizes local source/test work and disposable QA only. Shared DEV writes, live migrations/roles/seed, PROD changes, Kaggle private dataset upload, model promotion, commit, push, merge, and deployment require their applicable explicit authorization.  
**Target implementation window:** roughly Days 7–8 of Phase 04 for embedding retrieval, behavior contracts, API/UI and evidence, **not** a promise to collect/train a production behavior model in two days without a real dataset. Time-box investigation; do not time-box safety or truth.

> **Required outcome:** ElectroHub serves **real, learned-embedding-based** Similar Products and Recommended for You, context-aware You May Also Like, evidence-based Frequently Bought Together, and meaningful Popular Products. When available and consented, current customer behavior changes personalized ranking. Every result is a real eligible product resolved by Express/Prisma; sparse history and AI outage cause explicitly labeled, truthful fallbacks. The system has observable data provenance, baseline/held-out ranking evaluation, private interaction persistence, accessible responsive UI, and credible end-to-end tests. **Random vectors, fabricated click/purchase data, category-only recommendations mislabeled as AI, or simulated confidence do not satisfy this task.**

---

## 0. FIRST-PASS QUALITY CONTRACT AND FRONT-LOADED INVARIANTS

This section is placed first deliberately. Build the implementation and tests around these invariants rather than inviting a cycle of basic bugs after the first handoff.

### 0.1 Product, visual and UX invariants

| ID | Non-negotiable invariant | Minimum verification |
|---|---|---|
| V44-01 | The existing product page's **“More in {category}”** is category-search output, **not** learned recommendation output. A new Similar Products label requires a real compatible embedding computation. | Source review + real API/browser evidence |
| V44-02 | Five approved user-facing contexts exist: Recommended for You, You May Also Like, Similar Products, Frequently Bought Together, Popular Products; surface placement is purposeful rather than five redundant rows everywhere. | Route/component trace and viewport smoke |
| V44-03 | All recommendation cards use the existing `ProductCard`, verified product URL, real current image/alt, price, availability, wishlist/cart behavior and product identity. | Frontend + Express integration |
| V44-04 | Source product is excluded from its own recommendations; no duplicate SKU/product cards, hidden/test products or retired images. | API/DB tests |
| V44-05 | A personalized label appears only for legitimately user-specific ML output; guest/cold-start/popularity/category fallback is unmistakably identified internally and honestly titled externally. | API provenance and browser tests |
| V44-06 | Empty, initial loading, background refresh, fallback, unavailable, retry, no-history, sparse-history and disabled-tracking states do not look like fabricated success or hide an otherwise usable page. | Storybook + RTL/Vitest + browser |
| V44-07 | Recommendation sections never block product details, cart, checkout, header or ordinary catalog when FastAPI/pgvector/event logging fails. | AI-down and DB/event-down integration |
| V44-08 | User activity causes a real, explainable change to a consenting returning user's profile/rank when there is enough signal; no profile bleeding across logins, logout, tabs or caches. | Two-user isolated E2E |
| V44-09 | Keyboard, accessible headings, focus, scroll controls, screen-reader names, reduced-motion, 200% zoom and 390/768/1440/1920 layouts work. | Storybook a11y + Playwright + screenshots |
| V44-10 | View/impression/click events are sent only under the chosen privacy policy, are deduplicated, and are not emitted merely because React rerendered or a card was offscreen. | Unit + browser/network observation |
| V44-11 | Arabic/RTL and localization follow existing application capability; do not introduce broken directionality or invent a full translation system outside scope. | Existing locale/RTL compatibility smoke where supported |
| V44-12 | Existing catalog filtering/search/04.2 image search/04.3 media gallery remain functionally unchanged except intentional recommendation integration. | Direct consumer regression |

### 0.2 ML, data, API, security and persistence invariants

| ID | Non-negotiable invariant | Minimum verification |
|---|---|---|
| M44-01 | At least one production-oriented recommendation path retrieves/ranks using **actual approved learned D3 embeddings**, not hand-written category rules or fake vectors. | Real FastAPI + pgvector + descriptor proof |
| M44-02 | Every vector in one recommendation computation comes from the **same exact active embedding space** (model/preprocess/artifact/version/dimension); mismatch fails safely. | Index/version tests |
| M44-03 | Only 04.3-current, eligible product-image revisions contribute to similarity; replaced/retired/missing-source results cannot reappear through recommendation code. | Real SQL source-eligibility tests |
| M44-04 | A product-level representation aggregates eligible multi-image vectors without favoring products solely for having more photos. | Deterministic fixture + genuine vector test |
| M44-05 | Express is the public gateway and commerce authority. FastAPI receives minimal authorized context and returns advisory product UUIDs, rank/scores/model metadata, not prices, user identities or orders. | Source/API/negative security tests |
| M44-06 | Profile signals derive from authorized real activity; test fixtures must not be represented as real user/training evidence. | Provenance/fixture and profile tests |
| M44-07 | Anonymous traffic cannot read/write another user's history; event ingestion does not trust client `userId`, purchased state, order IDs, price or synthetic conversion labels. | 401/403 and spoof tests |
| M44-08 | Consent/opt-out, retention, account deletion and guest-session policy are specified and enforced; no passwords, tokens, address, payment data or raw search photos are recommendation features. | Privacy/deletion/authorization tests |
| M44-09 | Recommendation interactions, recently viewed, impressions and attribution have bounded storage, uniqueness/idempotency, timestamp consistency and indexed access. | Prisma migration + real PG tests |
| M44-10 | A profile is tied to exact embedding version and event watermark; invalidation/rebuild prevents stale or mixed-model recommendations. | Version-change/race tests |
| M44-11 | Co-purchase ranking uses **real eligible order-item pairs**, with proper order-status/payment/refund exclusion, support thresholds and no invented “customers bought together” claim. | SQL + small truthful fixtures |
| M44-12 | Popularity input is genuinely measured, temporally bounded, deduplicated and abuse-resistant; unobserved/catalog-bootstrap state does not masquerade as trending demand. | Aggregation/time-decay tests |
| M44-13 | Cold-start, sparse history, AI outage and no-eligible-vector fallbacks are explicit and never presented as model-generated personalization. | Contract + UX tests |
| M44-14 | Ranking is deterministic for the same source state/version except documented exploration; tie-breaking, topK, candidate caps and timeouts are bounded. | API/SQL/fuzz tests |
| M44-15 | Relevance is evaluated on a frozen independent judgment/interaction holdout; baseline comparison, Recall/NDCG@K, coverage/diversity/cold-start and latency are reported with limitations. | Reproducible evaluator/artifacts |
| M44-16 | If sufficient genuine behavior data exists, a trained ranking experiment uses real optimization and holdout evidence; otherwise no claim of a behavior-trained model is made. The approved ML requirement is still fulfilled via learned D3 item embeddings. | Data gate and training logs or explicit NOT TRAINABLE |
| M44-17 | Recommendation readiness is truthful: a registered ranker alone is insufficient if its required index/profile version is missing. | FastAPI readiness/error tests |
| M44-18 | Unavailable AI, incorrect recommendations or tracking failures never change stock, pricing, order/payment authority, media ingestion or model activation. | Fault-isolation and privilege tests |
| M44-19 | DEV/QA/PROD project identity and DB role boundaries are enforced before migrations/connected work; no PROD seed, fake purchases or model training using customer data without approval. | Identity-preflight evidence |
| M44-20 | No acceptance claim is based solely on a mocked ranker, a Storybook story, proposed notebook or written plan. At least one real ML-to-public-UI flow is actually executed. | Integrated acceptance record |

**Critical acceptance:** M44-01, M44-02, M44-03, M44-05, M44-07, M44-15 and M44-20 must pass. A five-carousel UI showing category/popularity rules is **not** a completed Task 04.4.

---

## 1. STEP ZERO — INSPECT ACTUAL REPOSITORY AND TASK DEPENDENCIES

Before implementation or branch creation:

```bash
git status --short --branch
git branch --show-current
git branch -vv
git worktree list --porcelain
git log -8 --oneline --decorate
git rev-parse HEAD
git rev-parse origin/develop
git diff --stat
git diff --check
git ls-files --others --exclude-standard
```

Fetch `origin` only when safe, and **do not** reset/stash/switch through another agent's or owner's uncommitted work. Confirm the integrated 04.3 commit/migration state and resolve local-versus-remote divergence. Create `feature/04.4-ml-powered-recommendations` from the verified approved `develop` baseline, or reuse the branch if already correctly established. **Do not start from the older unmerged 04.3 feature branch.**

Read the actual current equivalents of:

- Root `AGENTS.md`, `AGENT_COORDINATION.md`, `docs/prompts/{DEVELOPER_PROMPT,REVIEW_PROMPT}.md`, applicable workflow/branch/code-review standards.
- `docs/01_Project Foundation/{ROADMAP,TECH_STACK,PROJECT_VISION}.md` and `docs/03_Architecture/{AI_ARCHITECTURE,BACKEND_ARCHITECTURE,DATABASE_ARCHITECTURE,FRONTEND_ARCHITECTURE,DEPLOYMENT_ARCHITECTURE}.md` as applicable.
- `docs/tasks/Phase-04/TASK_04.1_FASTAPI_AI_SERVICE.md`, Task 04.2 specification/approved evidence, Task 04.3 **final merged source + final acceptance evidence** (only to establish consumers and current index contract).
- `docs/05_Features/RECOMMENDATIONS.md`, `docs/07_AI/RECOMMENDER.md`, current data/privacy/account-deletion conventions, order lifecycle and catalog eligibility.
- Relevant frontend Home/ProductDetail/Cart code, existing ProductCard/queries/Storybook/Playwright conventions; Express AI client, routes/RBAC/products/search, Prisma schema/migrations; FastAPI recommendations schemas/service/registry and `PgVectorGateway` source-aware queries.

Produce **one concise Plan Mode output** with existing API contracts, related-file manifest, diagram, schema/migration plan, actual embedding descriptor and readiness, behavior-data inventory, design decisions, agent file ownership, and minimal verification gates. Use actual Plan Mode when available; if unavailable, save a bounded plan and continue—do not pretend the tool ran.

### 1.1 Related-file-only investigation

Initial file search/ownership scope (inspect files only as needed):

```text
apps/frontend/src/pages/{HomePage.tsx,customer/ProductDetailPage.tsx,customer/CartPage.tsx}
apps/frontend/src/components/ui/{ProductCard,ProductCardSkeleton}/
apps/frontend/src/features/{products,search,cart,wishlist,auth}/
apps/frontend/src/lib/                 # API client / query keys / cache policy
apps/frontend/.storybook/             # existing Storybook conventions
apps/frontend/playwright*.config.ts   # relevant E2E harnesses
apps/backend/src/{routes,controllers,services,middleware}/
apps/backend/src/integrations/ai/{ai.client.ts,ai.schemas.ts,ai.config.ts}/
apps/backend/prisma/{schema.prisma,migrations/}
apps/ai-service/app/{api/routes/recommendations.py,schemas/recommendations.py,
  services/recommendation_service.py,models/interfaces.py,models/registry.py,
  integrations/pgvector_gateway.py,core/config.py}
apps/ai-service/{training/,tests/,requirements*.txt,pyproject.toml}
.github/workflows/ and migration policy (read-only release consequence review)
docs/05_Features/RECOMMENDATIONS.md
docs/07_AI/RECOMMENDER.md
```

Do **not** open the full monorepo, review Stripe settlement, rewrite auth/email/order flows or re-audit 04.3 without a demonstrable direct dependency. Existing conventional catalog/recommendation DTOs and product ownership are the authority.

### 1.2 Verified `develop` baseline at document preparation

- **04.3 is merged**: existing `ProductImage` includes `storageProvider`, immutable `storagePath`, `sourceRevision`, `sourceSha256`, `mediaState`, and `CatalogMediaEvent`; 04.3's AI private overlay and worker-health migrations exist. Do not rebuild its media sync.
- FastAPI already mounts `POST /internal/v1/recommendations` with `RecommendationRequest`, `RecommendationMode` (all five approved modes), `RecommendationService`, and a `RecommendationRanker` protocol. **The registry currently has no recommendation ranker loader configured**, so Task 04.4 must make readiness and ranking real rather than add a second competing endpoint.
- `apps/backend/src/integrations/ai/ai.client.ts` already has `recommend(...)` and strict Zod contracts. **Extend and reuse** instead of creating a parallel HTTP proxy or exposing internal FastAPI to the browser.
- FastAPI's source-aware pgvector reader already considers `ai.catalog_media_sources`, immutable base `ai.product_image_embeddings`, and current `ai.media_image_embeddings`; **reuse the exact eligibility logic** for recommendation candidate generation.
- Current `ProductDetailPage.tsx` calls `useSearchResults({q:'',category:product?.category.slug,page:1,pageSize:5})`, filters the current product and displays four **“More in {category}”** cards. That is conventional search, **not** ML-based Similar Products.
- Prisma has real `User`, `Product`, `ProductImage`, `Order`, `OrderItem`, `CartItem`, `WishlistItem` and `Review`, but no dedicated recommendation interaction/recently viewed/profile/impression models in the inspected schema.
- `HomePage.tsx` currently uses product arrivals, deals and categories; `CartPage.tsx` has existing cart item and summary composition. Use their established layout and query patterns.
- The historical Task 04.2 document specifies EfficientNet-B0 fine-tuning and comparison; the more recent accepted shared DEV vision state reports D3 SigLIP2 `siglip2-b16-p256-d1-b3900dd9fad5`. **Confirm actual active DB/model state before relying on the reported version.** Some foundation documents still say EfficientNet; reconcile relevant current descriptions without rewriting prior milestones/history.
- Repository package configs include frontend React 19, TanStack Query, SCSS, Radix, Storybook 9, Playwright, Vitest; backend Express, Prisma, Supertest, Zod; Python pytest/Ruff/mypy. Use actual installed versions and command scripts.
- **Do not assume** current eligible product/image counts, behavior-event volume, purchasing support, browser locale/RTL mode, user consent settings or Kaggle GPU availability without checking.

---

## 2. SCOPE, TASK OWNERSHIP AND SUCCESS DEFINITION

### 2.1 Entire Task 04.4 scope — REQUIRED

1. ML-based product-level similarity derived from **current learned visual embeddings** and source-aware pgvector retrieval.
2. Personalized embedding-based recommendations from authorized, quality-controlled user behavior when enough real signal exists.
3. Five distinct supported recommendation modes and honest strategy provenance/fallback metadata.
4. Safe interaction events: views, recommendation impressions/clicks, and bounded useful behavior without trusting client claims of purchase.
5. Recently Viewed persistence/display for appropriate signed-in users; anonymous ephemeral history only where privacy policy permits.
6. User-profile construction/versioning/invalidation; do not maintain unbounded raw event or profile data.
7. Real co-purchase aggregates for Frequently Bought Together where eligible order data supports it; no invented bundles.
8. Popular Products based on genuine time-bounded demand signals; data-absent cold-start behavior documented truthfully.
9. Backend public recommendation APIs, input/response validation, auth/consent, rate limits, business-authoritative product hydration and caching.
10. FastAPI private ranking service and restricted pgvector candidate/retrieval code; actual ranker readiness and exact model/index version checks.
11. Additive Prisma/SQL migrations, private AI queries and indexed data access appropriate to observed data volume.
12. Complete customer UX: Home, Product Detail, Cart, appropriate category/discovery placements; reuse shared components, existing layout/tokens and working cart/wishlist actions.
13. Storybook stories for reusable recommendation cards/rails and meaningful empty/loading/partial/fallback states.
14. Real Playwright browser flows, focus/keyboard/accessibility/responsive inspection; no need to create Phase 05's full admin management dashboard.
15. Offline reproducible evaluation: learned-vector baseline, profile/cold-start ranking and co-purchase metrics, coverage/diversity/latency, evidence and failure analysis.
16. **Conditional** additional behavior-ranker training pipeline on Kaggle Free GPU if actual permissioned behavior labels/volume justify it. Set a formal GO/NO-GO data gate; never simulate training or imply a GPU run occurred if not executed.
17. Operational readiness: structured telemetry, ranker/model-version health, coverage/fallback statistics, privacy-safe events, retention cleanup and rollback.
18. Relevant Swagger/OpenAPI, AI docs, database/runbook updates and **one concise** Task 04.4 evidence report.

### 2.2 Explicitly OUT OF SCOPE

- Re-training/replacing the accepted Task 04.2 D3 visual encoder without separate model-change authorization.
- Rebuilding/altering Task 04.3 Storage media lifecycle, source eligibility, outbox/worker or immutable ACTIVE model snapshots.
- Fake embeddings, deterministic random recommenders, synthetic purchases represented as actual customer demand, scraped customer data or unlicensed model-training datasets.
- A mandatory separate deep collaborative-filtering model when user/product interaction density cannot support it.
- Automatically downloading random Kaggle datasets, transmitting private customers/orders to Kaggle, or spending paid GPU credits.
- Product catalog CRUD, category/brand management, admin recommendation pinning/config and enterprise analytics reserved for Phase 05 (unless needed as a narrowly scoped read-only QA view).
- Delivery tracking, Leaflet, Socket.IO, Stripe/payments, authentication redesign or email/PDF rewrites.
- Production deployment, PROD vector/index activation, destructive cleanup, direct-to-browser FastAPI or unrestricted DB grants.

### 2.3 Acceptance semantics

**A. Must be real now:** A live learned-vector Similar Products flow, a legitimate behavior-derived learned-vector Recommended for You flow when a consenting user has adequate history, contextual You May Also Like using more than random category adjacency, truthfully sourced FBT/Popular rails or honest empty/fallback states, backend hydration and real browser evidence.

**B. Conditional on data:** A distinct behavior-*trained* ranker is required to be trained/served **only** after a predeclared, genuine labeled-history/holdout readiness gate passes. A recommendation based on a **real pretrained/fine-tuned D3 neural embedding space** plus current behavior-derived vectors is genuinely ML-based; it is **not** a separately trained behavior model, and must be described accurately.

**C. No false completeness:** If there is no actual order co-purchase support, FBT must be suppressed or explicitly presented as a non-co-purchase alternative under a different label—not fake “frequently bought together.” If there is no reliable behavioral history, Recommended for You must say “Popular Products” or another honest nonpersonalized label rather than pretend to know the user. If the D3 model/index is unavailable, clearly label fallback content or hide that mode.

---

## 3. THE FIVE RECOMMENDATION MODES — EXACT DATA AND RANKING CONTRACTS

| Mode / UI name | Anchoring context | Primary legitimate signal | Algorithm path | Fallback / sparse-data behavior | Recommended placement |
|---|---|---|---|---|---|
| `SIMILAR_PRODUCTS` / **Similar Products** | Current product UUID/slug | Current eligible D3 image-derived product representation | Real same-version cosine/dot pgvector retrieval with product-level aggregation and source eligibility | Honest **“More in {category}”** category results when ML is unavailable, not labeled Similar Products | Product detail |
| `RECOMMENDED_FOR_YOU` / **Recommended for You** | Authorized returning user profile | Weighted learned embeddings of genuine recent interacted products | Normalized user-interest vector → pgvector candidates → diversity/availability rerank | Explicit Popular Products / contextual fallback; never falsely personalized | Home; permitted signed-in recommendation surface |
| `YOU_MAY_ALSO_LIKE` / **You May Also Like** | Current product and optionally user/context | Current D3 semantic similarity + trusted co-view/co-purchase/category/attribute signals where available | Hybrid candidate union and bounded hybrid rerank, not randomly different category products | Safe embedding-similar alternatives; distinguish complements where evidence absent | Product detail, appropriate discovery |
| `FREQUENTLY_BOUGHT_TOGETHER` / **Frequently Bought Together** | Product or current cart product set | True eligible distinct order co-occurrences | Bounded pair statistics: support/confidence/lift; no neural model required | Hide when insufficient support; optionally separately labeled “Explore Accessories” only if true compatibility evidence exists | Product detail, Cart |
| `POPULAR_PRODUCTS` / **Popular Products** | Global or optional category/time window | Valid impressions/views, meaningful clicks, wishlist/cart and eligible paid/confirmed purchases where present | Abuse-resistant, age-decayed aggregate with minimum evidence; real metrics, stable ties | Show verified catalog discovery/new arrivals under correct label if no genuine popularity data | Home, discovery, cold-start |

### 3.1 Similar Products is not “same category”

A router vs USB Wi-Fi dongle can share `Networking & Wi-Fi` yet have very different appearance/use. Current D3 learned vectors are the primary similarity input. Category, brand and specs can refine scores or diversify ties but cannot replace the trained embedding signal while still claiming AI.

- Prefer canonical per-product representation(s) formed from current eligible image vectors; avoid choosing the maximum over an unbounded number of image vectors if photo-count bias is material. Define and test mean-of-unit-vectors normalization, quality weighting, or a bounded best-image aggregation supported by data.
- For mixed photography, score products with multiple current views consistently; never mix legacy and overlay vectors without applying 04.3's source-eligibility rules.
- Discard the anchor, duplicate products/variants as required, invisible products, test fixtures and unavailable products under the chosen storefront availability policy.
- No claim that a photo can determine hidden storage capacity, exact router revision or mechanical accessory compatibility; appearance-family relevance and exact SKU relevance are different.
- Product detail should dynamically replace/supplement the old category row. Do not silently rename a category-only query “Similar Products.”

### 3.2 Recommended for You — real personalization

- Extract **authorized, minimally necessary** product IDs, event types, age/window and bounded weights from the current user’s accepted events, wishlist/cart/purchase state, subject to product eligibility and privacy policy.
- Build a current embedding profile, e.g. `normalize(sum(event_weight × time_decay × current_product_vector))`; event weights are hyperparameters that must be declared/evaluated, not purchase probabilities. Exclude low-information duplicates and cancel/remove negative interactions as justified.
- Prevent one accidental click or a brief impression from dominating the profile; require a minimum evidence threshold before displaying a personalized label.
- Enforce a version-specific profile identity `(userId, embeddingVersion, featureSpecVersion, eventWatermark)`; stale cached profiles are recomputed/rejected when D3 active version, source eligibility or relevant user history changes.
- Read user history through Express with live authorization, then send bounded `productId/weight` features to FastAPI—not names, JWTs, emails, raw events, private orders or passwords. FastAPI must not query general user/order tables.
- If insufficient history, prefer a contextual learned-embedding rail when product context exists, otherwise a clearly identified Popular Products fallback.

### 3.3 You May Also Like — contextual alternatives

- Start with same-version D3 candidates and optionally combine verified contextual signals such as co-views, wishlist co-interest or true co-purchases.
- Use candidate-source provenance to explain whether results are **similar items** or **complementary interests**; embedding closeness alone does not prove that a mouse, cable or power adapter is compatible.
- Diversify safely (bounded category/appearance-family exposure) without randomization that changes behavior unpredictably or inventing an ML claim.
- Do not force this rail to duplicate all items in Similar Products; suppress or alter candidates when dedupe would leave trivial overlap.

### 3.4 Frequently Bought Together — evidence-based association

- Source data from existing authoritative `Order` + `OrderItem` tables. Define and verify which exact `OrderStatus`/`Payment` states represent genuine completed eligible purchases and which exclude cancelled, failed, reversed, refunded, fixture/test, duplicate checkout attempts or unpaid transactions.
- Aggregate **distinct order-level** `(anchorProductId, otherProductId)` pairs; multiple quantities in one order are not extra co-purchase votes. Never permit product self-pairs.
- Compute support (distinct qualifying orders), conditional confidence and optionally lift against eligible global product prevalence. Set a conservative minimum support and evaluate sparse-data uncertainty before displaying “Frequently Bought Together.” Do not expose individual buyer/order data.
- For cart anchors, aggregate across distinct cart products and dedupe candidates; do not alter the customer's basket or imply an automatic discount/bundle.
- Recompute on a bounded schedule or via validated recent-order change tracking, not one massive full purchase scan per page request.

### 3.5 Popular Products — truthful demand

- Use time-windowed event aggregates (e.g. 7-day and 30-day signals), verified order events, de-duplication, rate limits, event-time constraints and sensible time decay. Proposed weighting is a **baseline for evaluation**, not a claim of trained ranking.
- Separate recorded impressions from actual engagement: impression alone is weaker than deliberate product view/click/wishlist/cart/purchase. Avoid bot-fueled popularity and dominant repeat clicks from one session.
- If the platform has little genuine traffic, be honest: label “Featured,” “New Arrivals,” “Explore Products” or other truthful fallback, not “Most Popular” supported only by arbitrary prices or seed order.

---

## 4. END-TO-END ARCHITECTURE, TRUST BOUNDARIES AND RUNTIME FLOWS

### 4.1 Primary online request flow

```text
CUSTOMER REACT / TYPE SCRIPT                    (public browser)
  Home / Product Detail / Cart / Search discovery
  -> GET /api/recommendations?...          [ordinary same-origin Express API]
  -> POST /api/product-interactions        [only when collection permitted]
                  |
                  v
EXPRESS / TYPESCRIPT / ZOD / PRISMA             (public gateway + business authority)
  public route validation + auth/session/consent + rate limits + request ID
  -> resolve current anchor, eligible catalog and bounded user signal IDs
  -> choose source strategy; check cached version/visibility
       |                       |                         |
       | ML-supported modes    | FBT/popularity           | activity capture
       v                       v                         v
  PRIVATE AI CLIENT       reviewed Prisma/SQL      minimized user-scoped
  signed internal call    order/event aggregates    PostgreSQL records
       |
       v
FASTAPI / PRIVATE NETWORK                     (AI processing only)
  internal auth + environment binding + Pydantic validation
  -> recommendation service / ranker readiness
  -> version-aware D3 product-profile retrieval
  -> current-image/source eligibility SQL (same 04.3 policy)
  -> candidate product IDs + finite scores + model/index version
       |
       v
EXPRESS
  -> verify response schema/version, source product exclusion and candidate uniqueness
  -> one bounded authoritative Prisma catalog/inventory lookup
  -> discard hidden/inactive/test/retired/unavailable per storefront policy
  -> stable rank/dedupe/different-rail overlap policy
  -> response with truthful strategy/fallback/cache provenance
       |
       v
REACT / TANSTACK QUERY
  -> ProductCard & existing cart/wishlist action
  -> viewable impression, click attribution where authorized
  -> navigable, accessible, responsive recommendations

OFFLINE / OPTIONAL DATA-QUALIFIED TRAINING
  consented/sanitized event export + version-matched D3 item features
  -> frozen chronological train/val/test splits
  -> private Kaggle PyTorch genuine ranker experiment (if GO)
  -> Recall/NDCG/coverage/calibration limitations
  -> safe versioned artifact, checksums and separate activation review
```

**Error boundary:** Recommendation calls are optional enhancements. A failure must not fail product details, cart loads, checkout or search. The browser never contacts private FastAPI or vector DB. FastAPI has no general access to `User`, `Order`, payment, inventory or commerce write privileges.

### 4.2 Source-of-truth table

| Concern | Owner | Consumers must not assume |
|---|---|---|
| Product ID, slug, current name/category/brand/price/stock, visibility | Express + Prisma | AI score conveys purchasability or exact SKU variant |
| Media ownership, revision, source digest and published state | Task 04.3 Prisma + AI eligibility projection | Old base vector is automatically current |
| Vector model, exact embedding version, current source-eligible vectors | Restricted AI model/pgvector | 256 dimensions imply compatible model |
| Logged-in user, consent and permitted interaction history | Express + authorized DB | Client-provided `userId` is truthful |
| Paid and accepted order state | Commerce tables | Browser click means purchase |
| Recommendation algorithm, evaluated weight/feature revision | FastAPI/ranking logic and versioned metadata | A score is calibrated purchase probability |
| UI state and visible impressions | React | DOM render means customer actually saw a card |
| Deployment/role/approval state | Reviewed DevOps and migration policy | Merge is safe without checking the automatic PROD migration workflow |

### 4.3 Model/index compatibility and source eligibility

- Query exact active D3/compatible model descriptor from the approved restricted AI index state; match **embeddingVersion, modelVersion, preprocessVersion, artifact hash, dimension, and status**.
- Extend the existing `PgVectorGateway` through a **separate, narrowly scoped recommendation repository** or safe shared lower-level eligible-vector helper. Do **not** copy a simplified query that bypasses `ai.catalog_media_sources` or `ai.media_image_embeddings` revision/digest matching.
- In one coherent read transaction (e.g. REPEATABLE READ where needed), obtain active version, source-eligible base/overlay vectors and candidate score; refuse conflicting activation/version state. Do not create an exposed PostgREST vector endpoint.
- Normalize/aggregate only genuine nonzero finite vectors; avoid combining D3 and Candidate C or RETIRED EfficientNet embeddings. The recommendation service may remain available when some images are unindexed; reflect coverage and exclude unindexed sources.
- Tag recommendation result/caches with embedding version, algorithm/ranker version, profile watermark/feature version and freshness boundary. Media revision changes must invalidate/defeat stale cached results through eligibility filtering before public response. A TTL alone is insufficient for hiding a retired or newly hidden product.
- Do not mutate Task 04.3 base ACTIVE vectors or activate STAGING/RETIRED models. An independently trained ranker has a separate artifact identity and requires compatible D3 item representations.

### 4.4 Candidate generation and scoring

Choose an explicit versioned ranking recipe only after the initial data audit. Illustrative **baseline** (not prescriptive weights):

```text
Candidate pool: eligible current D3 item embeddings (bounded topN)
Similar score: normalized cosine similarity to anchor product representation
Personal score: cosine similarity to normalized consented behavior profile
Hybrid signals: verified co-view/interaction, relative popularity, category/brand, stock
Rerank: explicit bounded feature coefficients + source diversity + stable tie-break
Output: unique eligible product UUIDs, rank order, strategy, source version
```

- Candidate union must not mix source identities across versions. Retrieve e.g. 3–5× the desired final `limit` (bounded by verified AI_MAX_CANDIDATES) to account for Express visibility/stock filtering; then dedupe.
- Product-level photos aggregation must be bounded and order-independent. Explain whether a text-specification embedding exists; **do not invent text embeddings** just because D3 supports text in theory.
- Document score normalization and weight selection with an evaluation script. Never label uncalibrated cosine score “85% likely to buy.”
- Apply source-product self-exclusion, invalid product IDs, duplicate SKU/variant policy, category safety and listing visibility **both** at the candidate layer where feasible and always at authoritative Express resolution.
- For all sections, define stable ties by `productId` or another deterministic immutable field. No SQL `ORDER BY random()` as purported recommendation intelligence.
- Do not silently show stale personalized data across user switching, account deletion or model rollout.

### 4.5 Recommendation readiness

Current `ModelRegistry` has separate `imageSearch` and `recommendations` slots; the existing recommendation service refuses if `ranker` is unconfigured. Task 04.4 must provide a **real** ranking adapter/loader with appropriate descriptor and access to the version-compatible pgvector repository.

- Examine and reconcile the existing synchronous `RecommendationRanker.rank(...)` protocol with actual **asynchronous PostgreSQL vector retrieval**. Do not block the FastAPI event loop with synchronous DB calls. Either adapt orchestration to async candidate generation then bounded CPU scoring in `InferenceExecutor`, or evolve the protocol safely with backward-compatible tests.
- If recommendations reuse D3 without a separate model artifact, do **not** fabricate a “trained recommender checkpoint.” A versioned recommendation engine can load a real D3 descriptor/adapter and declared algorithm version, where its `feature_status` also confirms the required vector index is genuinely ready.
- `GET /health` remains process liveness; private `/internal/v1/ready` and `/internal/v1/capabilities` separately report `imageSearch` and `recommendations`. A missing ranker or incompatible D3 index must return truthful not-ready; one feature's unavailability must not bring down the other or core commerce.
- Cache readiness briefly and refresh after active-index changes; do not cache an out-of-date READY forever.

---

## 5. EXPRESS PUBLIC API AND PRIVATE FASTAPI CONTRACTS

**Reconcile exact existing routing, Zod/Pydantic envelope and camelCase conventions first. The paths below are proposed task contracts, not assertions they already exist.**

### 5.1 Proposed Express endpoints

| Method | Path | Auth | Responsibility |
|---|---|---|---|
| `GET` | `/api/products/:slug/recommendations?mode=SIMILAR_PRODUCTS&limit=8` | Public; validated visible anchor | Similar or You May Also Like/FBT anchored results with explicit strategy |
| `GET` | `/api/recommendations?mode=RECOMMENDED_FOR_YOU&surface=home&limit=8` | Optional user session; use only legitimately personalized data for auth+consent | Home personalized or honest cold start |
| `GET` | `/api/recommendations?mode=POPULAR_PRODUCTS&surface=home&limit=8` | Public | Authentic popular results or transparent discovery fallback |
| `GET` | `/api/me/recently-viewed?limit=20` | Live authenticated CUSTOMER and permitted tracking | User-only bounded recently viewed products |
| `DELETE` | `/api/me/recently-viewed` | Live authenticated CUSTOMER | Clear history and invalidate user profile/cache |
| `POST` | `/api/product-interactions` | Authenticated & permitted; optional policy-approved anonymous session | Bounded view/click/wishlist-context/impression tracking, not fabricated purchase |
| `POST` | `/api/recommendations/events` | Authenticated & permitted when attributed; optionally approved anonymous telemetry | Validated impression/click attribution using server-issued bounded impression token |
| `GET` | `/api/me/recommendation-preferences` | Authenticated | Consent/personalization setting if existing settings have no equivalent |
| `PATCH` | `/api/me/recommendation-preferences` | Authenticated | Opt-in/out/clear controls with live recheck and stale-cache invalidation |

For cart, prefer an endpoint accepting a **bounded list of current cart product IDs validated server-side** or deriving them from authoritative cart session; never trust a client assertion of purchase/ownership. Do not introduce six redundant endpoints per rail if one typed shared route fits existing patterns.

### 5.2 Sample client-facing recommendation response

```json
{
  "data": {
    "mode": "SIMILAR_PRODUCTS",
    "surface": "product_detail",
    "strategy": "EMBEDDING_SIMILARITY",
    "isPersonalized": false,
    "isFallback": false,
    "modelVersion": "<actual-registered-D3-model-version>",
    "embeddingVersion": "<actual-active-embedding-version>",
    "strategyVersion": "recommendations-v1",
    "items": [
      { "rank": 1, "product": { "id": "<real-uuid>", "slug": "<real-slug>", "name": "<real-title>", "price": "<current-price>", "images": [] } }
    ],
    "meta": { "limit": 8, "returned": 1, "nextCursor": null }
  }
}
```

This is illustrative. Use existing public `ProductSummary`/`ProductCard` data contract instead of introducing conflicting fields or a second catalog schema. Do not expose unreviewed raw user features, customer history, vector arrays, secret DB references, internal image object keys or arbitrary private scores. `modelVersion`/`embeddingVersion` must be **nullable/omitted** for non-ML co-purchase/popularity fallback strategies, not fabricated.

**Response strategy enum (proposed):** `EMBEDDING_SIMILARITY`, `BEHAVIOR_EMBEDDING`, `HYBRID_EMBEDDING`, `CO_PURCHASE`, `MEASURED_POPULARITY`, `FALLBACK_CATEGORY`, `FALLBACK_POPULAR`, `NO_DATA`. Validate at the Express boundary and use it for honest labeling. The customer should not see developer jargon; UI should display understandable names and avoid “For You” when only generic items were retrieved.

### 5.3 FastAPI internal recommendation route

Reuse **existing** `POST /internal/v1/recommendations` and the five already declared `RecommendationMode` values. Preserve authenticated private service key and environment header, Pydantic input bounds and established envelope.

An additive version of the current `RecommendationRequest` may include:

```json
{
  "mode": "RECOMMENDED_FOR_YOU",
  "productId": null,
  "candidateProductIds": [],
  "limit": 8,
  "context": {
    "surface": "home",
    "profileSignals": [
      { "productId": "<current-permitted-product-uuid>", "weight": 0.8 }
    ],
    "featureSpecVersion": "profile-v1"
  }
}
```

Only add fields genuinely needed by the chosen design; validate strict bounds, finite numbers, unique UUIDs, supported surface, profile length and declared feature version. **Do not pass user ID/email/JWT/order rows to FastAPI.** FastAPI may derive the profile by retrieving eligible vectors for those product IDs using its restricted AI reader.

- Private response: valid unique `RankedProduct` IDs and finite similarity/ranking scores, mode, compatible model version, embedding version, algorithm version/strategy metadata; no prices/inventory/customer PII.
- Express validates the private response using existing `ai.schemas.ts`, `AiServiceClient.recommend(...)`, Zod, exact mode, bounds, dedupe, version check and correct environment; it then fetches current catalog state via a bounded Prisma query.
- `POPULAR_PRODUCTS` and `FREQUENTLY_BOUGHT_TOGETHER` may be implemented entirely by trustworthy Express/SQL aggregation, **without pretending to call a neural ranker**. Do not force these modes through the private model contract just to make all five look ML-based.
- Keep timeouts (recommendation-specific budget), connection/admission caps, aborts, sanitized errors and no leak of internal AI credentials. Avoid passing the browser's cookies or authorization header to FastAPI.

### 5.4 Input, error and privacy behavior

| Scenario | Correct handling |
|---|---|
| Public request for hidden/nonexistent anchor | Existing consistent 404/visibility behavior; do not leak hidden product identity |
| Requested mode requires anchor but none supplied | 400/422 validated error, no random fallback pretending success |
| Invalid `limit`, `surface`, UUID, weight or batch size | Bounded 400/422 with stable error code |
| Signed-out visitor requests personal history | 401 or intentional public nonpersonalized result per route; no private data |
| CUSTOMER attempts another user's history/profile | 403/404 as appropriate; never trust client userId |
| User declines tracking or requests erasure | Stop collection, clear history/cache and show nonpersonalized strategy |
| Forged purchase/conversion event or order UUID | Reject; derive paid purchase from trusted commerce state only |
| Forged recommendation impression/click token | Reject/ignore safely without falsely incrementing attribution |
| AI not ready/down/timeout/bad version/malformed response | Safe fallback or hidden rail; core commerce remains healthy |
| No useful user history | Honest cold start, not fake personalized recommendations |
| No genuine co-purchases | No FBT claim; hide or differently labeled alternate rail |
| D3 model switched or media retired during response | Refresh/validate version and current catalog eligibility; never serve invalid product |
| Duplicate/replayed events | Idempotent acceptance with bounded uniqueness/TTL |

Apply existing rate limit, identity checking, tracing, abort and structured error standards. No raw image bytes/customer search photos belong in behavioral telemetry.

---

## 6. SUPABASE POSTGRESQL, PRISMA, PGVECTOR AND DATA PERSISTENCE

### 6.1 Current foundations — do not duplicate

- `User`, `Product`, `ProductImage`, `Category`, `Brand`, `Cart`, `CartItem`, `Wishlist`, `WishlistItem`, `Order`, `OrderItem`, `Review` already exist. Retain their ownership and foreign keys.
- `OrderItem` already stores line-item purchase facts, quantity and product identity. The recommendation system should derive co-purchases from eligible orders, **not** create another shadow orders table.
- Task 04.3 already owns media source revisions and the AI eligibility/overlay. Never create a second ProductImage, source-of-truth vector index or D3 model record.
- Interaction/history/profile models are **not present** in the inspected current Prisma schema. Add only what the implemented use cases need.

### 6.2 Proposed additive application models

Final names/relations/unique indexes must follow actual Prisma conventions. These are **logical schemas**, not mandatory redundant tables.

| Model / table | Essential fields | Purpose and constraints |
|---|---|---|
| `ProductInteraction` (`product_interactions`) | `id`, `userId?`, `productId`, `eventType`, `sourceSurface`, `occurredAt`, `receivedAt`, `sessionKey?`, `idempotencyKey`, `metadataVersion` | Server-validated opt-in view/click intent; unique de-dupe, retention; index `(userId, occurredAt)`, `(productId, eventType, occurredAt)` as justified |
| `RecentlyViewedProduct` (`recently_viewed_products`) | `userId`, `productId`, `lastViewedAt`, `viewCount` bounded | One row per user/product, upsert; capped number/history and last-view sort |
| `UserInterestProfile` (`user_interest_profiles`) | `userId`, `embeddingVersion`, `featureSpecVersion`, `eventWatermark`, `status`, `recomputedAt`, `expiresAt`, safe vector representation/reference if necessary | Cached ML preference state; exact version identity and race-safe rebuilding. Do not duplicate full raw history or expose vectors publicly |
| `RecommendationImpression` (`recommendation_impressions`) | `id`, pseudonymous allowed subject/session, `surface`, `mode`, `strategy`, `algorithmVersion`, `shownAt`, bounded `productId`, `rank`, `batchId`, `tokenHash`/expiry | Verified visible exposures for evaluation/click attribution; not every API request becomes an impression |
| `RecommendationEvent` or normalized attribution | `impressionId`, `eventType`, `occurredAt`, optional trusted user/session id, immutable product ID | Idempotent click/add-to-cart/conversion association **only** if actually supportable by trusted lifecycle events |
| `RecommendationJob` / `RecommendationModelVersion` (only if required) | strategy/version, artifact sha, snapshot/watermark, evaluation and state | Offline precomputation/trained ranker reproducibility; avoid table if current artifact registry already suffices |

**Minimalism rule:** `ProductInteraction` and `RecentlyViewedProduct` can cover basic activity; a dedicated `RecommendationEvent` table is optional if securely typed events and impression attribution already fit the existing ledger. A stored dense profile is optional if safe recomputation or bounded cache is cheaper/safer for ~200 products. Do not create five tables merely to satisfy a document.

### 6.3 Data ownership, retention, privacy and deletion

- Enforce server-derived user scope and authenticated role; do not trust `userId` from public JSON. Real product foreign key identity; appropriate `onDelete` behavior checked against account deletion and preserved order history.
- Define the actual consent/personalization default based on accepted project privacy policy. If no preference mechanism exists, add a small explicit account-level control and require user permission before persistent behavior tracking; anonymous visitors can receive contextual recommendations without persistent identification.
- Proposed retention targets **for implementation decision**, not asserted company policy: raw event history up to 90 days; impression/attribution up to 30–90 days; recent viewed capped to 20–50 items with rolling age limit; aggregated non-identifying popularity up to 180 days. Document policy, provide cleanup job, verify erasure/opt-out and align any legal requirements applicable to deployment.
- Avoid storing IP, exact device fingerprint, location, personal email, health data, addresses, payment data, private search images, tokens or arbitrary HTTP referrers in recommendation tables.
- Session/guest keys, if genuinely necessary, must be short-lived, random, scoped, consented where required, nonreversible and not used as persistent surveillance identifiers.
- Account deletion should remove/erase recommendation history and personal profiles without rewriting historical valid orders. Logout/cache clearing must eliminate private recommendation data in React Query; account switch is a critical cross-user privacy test.
- Test referential integrity and deletion/retention of profile, events, impressions and associated product records. Do not join private tables into public storefront search responses.

### 6.4 Behavioral event ingestion without fake activity

- First record the true existing click/view lifecycle: actual product navigation, ProductCard click, wishlist/cart mutation acknowledgments, and backend-confirmed eligible purchase, not every render or component mount.
- A view event must represent a meaningful page visit with dedupe and visibility/time criteria. Recommendation impression requires visibility (suggested IntersectionObserver ≥50% for ≥1 second while tab is visible); these are proposed practical defaults, not legal guarantees or measured behavior.
- Click attribution requires a verified impression/token or an explicitly typed genuine customer navigation; forged client-side purchase status never becomes a valid conversion.
- Wishlist/cart signals should be confirmed against actual backend mutations, and paid purchase signals should come from trusted order/payment state; prevent double-counting retries and duplicates.
- Validate timestamps (reasonable skew), event schema allowlist, maximum batch size, per-identity/session limits, idempotency, abuse controls, and retention. Never let telemetry failures block click navigation, add to cart or checkout.
- Provide opt-out, clear history and disable personalization endpoints/UI appropriate to current account settings. Test stale profile invalidation and event delivery after consent withdrawal.

### 6.5 Popularity/co-purchase aggregation

- Avoid heavy full-table scans per request; use indexed bounded SQL plus summarized counts/materialized projections only where justified by measured size/latency.
- Use parameterized SQL, explicit eligible order/payment states, distinct order IDs, test-fixture exclusion, minimum support and stable ties. Do not incorporate unpaid or cancelled purchases as completed co-purchase evidence.
- For popularity, store or compute bounded day/window aggregates, unique legitimate intent where available, timestamps and data freshness. Distinguish recent product arrival lists from measured popularity.
- Separate ingest jobs from product/customer API threads where periodic aggregation cost warrants it; make replay idempotent and updates monotonic/versioned.
- If stores are empty or no credible positive samples exist, return a truthful empty or differently labeled catalog fallback; do not seed fictitious demand into shared DEV/PROD.

### 6.6 AI-specific persistence and pgvector

Existing private AI tables remain immutable outside their approved writers. Options:

1. **Preferred for current catalog:** derive product-level representations inside a guarded AI query/CTE from source-eligible current D3 vectors, with a bounded per-product image aggregation and no second copy of base vectors.
2. **If measurements justify it:** a private `ai.current_product_representations` materialized/versioned projection keyed by `(product_id, embedding_version, source_revision_manifest_hash)`, refreshed on 04.3 current-source changes and rejected on mismatch. This is derived state, **not** the catalog authority.
3. User-interest vector may be computed per request from a few product IDs or cached privately with the exact active embedding version and event watermark. Restrict access; never expose through PostgREST or frontend.

Use the existing private AI read-only role or a strictly scoped recommendation read role. Do not grant the ranker access to general users/orders, modify `ai.active_index`, or overwrite immutable ACTIVE/RETIRED/STAGING base rows.

### 6.7 Prisma migration and environment policy

- Inspect actual migration history and `_prisma_migrations`; keep already applied 04.2/04.3 files immutable (including byte-sensitive SQL and `.gitattributes`).
- Write one or few **additive forward-only** 04.4 migrations for actual tables/indexes/AI projections and smallest necessary grants. Test from an empty disposable database replaying all migrations in canonical order, then second deploy/no-op; generate/validate Prisma client and check SQL role denies.
- No `prisma db push` / `migrate reset` against shared DEV/PROD; never manually edit `_prisma_migrations`, manually mark applied or copy DEV customer/event rows into PROD.
- Verify exact target identity and DSN, privileges, role grants, current active embedding descriptor and database schema **immediately before** shared writes. Separate migration/operator credentials from runtime AI reader and Express credentials.
- **Shared DEV migration:** only with explicit scoped owner authorization after clean QA replay, identity check and compatibility review; do not invent authority from environment access alone.
- **PROD:** NO write/deploy/seed/migration merely from this task specification. The repo currently has an automatic `develop`-push PROD migration workflow; review its exact ordered allowlist, safety policy, no-op mode and release consequence **before** seeking merge approval. A future merge must not unintentionally run unreviewed new migration SQL. PROD backup/PITR is not a Task 04.4 **source-code acceptance** gate by itself; do not remove identity/checksum/destructive-SQL/integrity safeguards.
- Rollback: disable new recommendation API/telemetry, keep additive schema/history, invalidate active ranker/profile caches, retain 04.3 vector protections, and restore verified prior recommendation strategy without downgrading the media reader.

---

## 7. REAL ML / DEEP LEARNING STRATEGY, TRAINING READINESS AND KAGGLE

### 7.1 What is already learned vs what is new

**Do not confuse “deterministic score computation” with “simulated AI.”** The D3 SigLIP2 encoder is a learned neural embedding model; cosine similarity over its genuine, version-correct embeddings is a real ML content-based recommendation technique. The formula after neural inference is deterministic, but the representation is learned. The AI system must serve those actual vectors—**not** random, hand-authored or pseudo-ML embeddings.

The current Task 04.4 engineering work is **recommendation modeling on top of existing real D3 representations**, not automatic re-training of Task 04.2 EfficientNet/SigLIP2. The earlier EfficientNet-B0 plan is historical; confirm which artifact is genuinely ACTIVE now. No new computer-vision backbone training is part of the mandatory 04.4 deliverable unless an approved comparison shows the existing D3 encoder is unfit and the owner authorizes a separate model version/reindex migration.

Task 04.4 introduces:

1. **Learned item representations:** source-correct D3 vector derived from approved product photos.
2. **Learned-feature-based user preferences:** combine actual consented behavior with those learned item representations.
3. **Candidate retrieval:** normalized pgvector similarity, version-checked, product-level.
4. **Context/behavior reranking:** bounded, explicit and measurable signals rather than arbitrary random category choices.
5. **Optional separately trained ranking network:** only if genuine behavior labels make meaningful supervised learning and independent evaluation possible.

If no trustworthy user history exists, ship real embedding-based Similar Products and contextual learned recommendations; supply honest cold-start fallback and show precisely what the data gate prevented. Do not fake a trained recommender merely to satisfy a schedule.

### 7.2 Mandatory existing data inventory / training GO-NO-GO

Using an authorized **read-only** DEV snapshot (or disposable representative snapshot), report sanitized counts:

```text
Eligible visible non-fixture products and categories
Eligible CURRENT revision D3 vector coverage, number of products vs images
ACTIVE D3 embedding version, model artifact hash and expected dimension
Anonymous vs signed-in users with valid opted-in interaction data
Valid view/click/cart/wishlist activity by date/window and unique subject/product
Eligible confirmed/paid orders and distinct co-purchased product pairs
Per-product action sparsity and popularity skew
Existing recent-viewed storage, consent/erasure/account-deletion controls
Candidate labeled ranking examples and approximate positive-label rates
Available independent chronological train/validation/test windows
Any user-level/privacy restrictions that prohibit Kaggle export
```

Do **not** copy emails, names, addresses, payment credentials, whole orders or raw photos into evidence. Aggregate counts with no reidentifiable small-cell disclosure. Report actual numbers; do not extrapolate from historical 206/211/229 snapshots.

**GO for separate trained behavior ranker** requires: real authorization for the data purpose and Kaggle processing; sufficient distinct user-product interactions; meaningful positive/negative preference labels; independent chronological windows; low leakage risk; a representative baseline and evaluation design; and a feasible serving budget. Thresholds should be chosen with evidence from the actual sparse/dense distribution, not arbitrary promises like “10,000 users” or a mandatory 95% accuracy.

**NO-GO:** Too few consented interactions, no trustworthy labels, all orders from test seeds, only a few users, no independent holdout, or unclear third-party processing rights. A NO-GO means *do not claim trained-ranker success*, not “replace all ML with category rules.” Retain D3-powered real content-based methods and an honest data-readiness report.

### 7.3 Dataset and leakage safety for a future trained ranker

Use product UUID plus exact `embeddingVersion`, event time, event type, context/surface, impression eligibility, rank/exposure and accepted outcome; add valid purchase labels only from authoritative commerce state. Features must be available **at recommendation time**—avoid target leakage from future events or purchase fields that occur after the prediction.

- Prefer chronological split (e.g. train older period, validate later, test strictly newest), with user/session grouping as appropriate. Do not allow the same impression/click event to appear in multiple splits.
- Freeze the test window/labels before iterative tuning. Run duplicate, replay, bot and leakage checks. Avoid assigning synthetic negative labels to unseen/unexposed products as if every unclicked item were disliked.
- Account for exposure and position bias: impressions are not interchangeable with random product sampling. Use observed clicks as biased positives and, if appropriate, propensity-aware or reweighting evaluation; record assumptions and limits.
- Ensure model features and candidate IDs refer to the **same D3 embedding version** across training and evaluation. If the embedding version changes, rebuild/revalidate features; do not silently mix model spaces.
- Use verified category/brand/spec, price-band and stock *at event time* if justified; do not leak current stock/current price into old labels as if historically observed. The authoritative current price/stock still comes from Express when serving.
- Keep only purpose-allowed event features; no human names, emails, JWT, shipping addresses, precise locations, private photographs or unrelated account secrets.
- Store reproducible manifests/checksums, counts, distribution and deletion policy. A genuine small, well-labeled holdout is more valid than a large fake dataset.

### 7.4 Suggested repository training/evaluation layout

Inspect existing `apps/ai-service/training/` conventions first. If a dedicated ranker training package is warranted, use something like:

```text
apps/ai-service/training/recommendations/
  README.md                              # prerequisites + privacy + GO/NO-GO
  requirements-training.txt             # pinned after environment validation
  notebooks/electrohub_recommender.ipynb # real Kaggle run if authorized/data-ready
  manifests/
    feature_schema.json                  # documented versioned inputs
    split_manifest.example.json          # safe shape, no actual private data
  src/
    collect_snapshot.py                  # approved sanitized export from authorized source
    build_profiles.py                    # real profile/feature extraction
    build_labels.py                      # temporal & event-integrity rules
    split_data.py                        # chronology/leakage validation
    baselines.py                         # D3 content-based / popularity / co-purchase
    train_ranker.py                      # genuine optimization only if GO
    evaluate.py                          # rank/coverage/cold-start metrics
    export.py                            # safe artifact + manifest + checksum
  tests/
    test_data_contracts.py
    test_split_leakage.py
    test_metrics.py
    test_artifact_parity.py
```

The folder is illustrative; do not create empty files everywhere. If the data gate is NO-GO, implement reusable evaluator/split tests and a private notebook template if valuable, but **do not call the notebook executed or a ranker trained**.

### 7.5 Kaggle Free GPU setup — execute ONLY after GO and permission

Kaggle is for **offline training**. It is not the web service or a DB host. User access to a Kaggle account and previously selectable NVIDIA T4 accelerators is historical context, not proof that the current session has free GPU quota.

1. Create a **private** notebook and private, permission-cleared, sanitized dataset package. Never upload raw customer records/images, Supabase keys, DB URLs, auth tokens or unapproved company/customer data.
2. Enable GPU accelerator (one T4 to start). Verify actual GPU assignment; `T4 x2` does **not** merge VRAM into one 32 GB accelerator.
3. At notebook startup record versions/devices and available VRAM; e.g.:

   ```python
   import platform, torch
   print("Python", platform.python_version())
   print("PyTorch", torch.__version__)
   print("CUDA available", torch.cuda.is_available())
   print("GPU count", torch.cuda.device_count())
   if torch.cuda.is_available():
       print("GPU", torch.cuda.get_device_name(0))
   ```

4. Resolve and install **verified compatible pinned** versions of PyTorch, data tools, NumPy/Pandas/Scikit-learn if used, safetensors and plotting packages. Do not paste obsolete unverified `pip install` versions or assume the current CUDA stack. Save resolved version manifest.
5. Run data/rights/leakage checks on Kaggle input **before** GPU training. Fix malformed labels or cancel if privacy gate fails.
6. Run frozen baseline rankings using the existing D3 representations and appropriate popularity/co-purchase baselines; record benchmark queries/candidates.
7. If GO, train a genuine ranker (e.g. a compact PyTorch MLP or pairwise BPR-style neural reranker over user/item embedding interactions, context and justified features). Do **actual gradient-based updates**, not hardcoded score rules relabeled as “training.” Choose pairwise/listwise objective, negatives and regularization based on observed labels and position bias.
8. Record seeds, split hashes, feature normalizers, epochs, optimizer, learning-rate schedule, batch size, mixed-precision configuration, GPU memory and per-epoch train/validation metrics. Use bounded early stopping and save the best validation checkpoint; never tune against frozen test data.
9. Verify nonzero intended parameter/weight deltas and valid finite loss. Compare fine-tuned ranker against the same frozen D3 and popularity baselines on an independent test window. Report negative results transparently; do not cherry-pick users or hide coverage deterioration.
10. Export only reviewed, non-executable inference artifacts (e.g. `safetensors` plus JSON schema/checksum, or validated ONNX). Verify CPU inference parity, feature-schema compatibility and safe artifact loading. Do not load untrusted pickle checkpoints in the production runtime.
11. Deploy/activate a new ranking artifact only after separate architecture/model review, exact identity and rollback validation. Preserve the previous viable ranker and the D3 active encoder/index without modifying Task 04.2/04.3.

**No GO, no dataset rights, no GPU or missing credible labels:** return the precise external constraint and continue with the production-quality D3 embedding recommender. Do not use fabricated purchases or substitute a category-only system and call it ML.

### 7.6 Model serving and performance

- Reuse existing `ModelRegistry`, FastAPI lifespan and `InferenceExecutor`. Load any optional trained ranker once and close cleanly; do not download weights or train inside request handlers.
- CPU-first serving on the current HP laptop/production container; benchmark and bound candidate count, inference concurrency, RAM, p50/p95 latency, cold vs warm path and SQL time. Ensure upstream Express recommendation timeout is compatible with measured CPU behavior, not an arbitrary inherited image-upload timeout.
- Product similarities can be precomputed/reused for a small catalog when safe; any cache needs embeddingVersion/eligibility/version protection and fresh authoritative filtering.
- Prefer simple vectorized NumPy/pgvector nearest-neighbor operations over unnecessarily invoking the full image encoder on every recommendation request: D3 product vectors were generated by Task 04.2/04.3.
- User profile scoring may be CPU-light; avoid dedicated high-GPU serving infrastructure without measured need. Real offline training can require Kaggle Free GPU while production inference does not.
- If a separately trained ranker offers no verified improvement, do not promote it over the reliable D3 baseline for appearance of sophistication.

---

## 8. RECOMMENDATION RELEVANCE / COVERAGE / BUSINESS-SAFETY EVALUATION

### 8.1 Reproducible evaluation contract — mandatory even with no new training

Before finalizing ranking weights/strategy, define frozen evaluation scenarios across representative categories and visually similar/confusable products. For a small catalog, combine **human-judged topical/appearance relevance** with genuine permitted behavior holdout where available. Separate evaluation populations:

1. **Similar Products:** anchor SKUs and visually similar valid products, including different appearance families, near-identical variants and hard negatives. Human labels: exact/equivalent appearance, related, irrelevant. Do not conflate category match with appearance relevance.
2. **Recommended for You:** consented users with sufficient legitimate history and chronologically later outcomes; separately evaluate no-history and sparse-history. If user data is not enough for statistics, show a small controlled demonstration as functionality proof, not generalizable accuracy.
3. **You May Also Like:** contextual relevance and useful diversity; count duplicate/overlap and unsupported “compatible accessory” claims.
4. **FBT:** actual order support/confidence/lift, out-of-time co-purchase repeatability and support threshold. Do not compute fake FBT accuracy from seeded QA purchases as production demand.
5. **Popular:** agreement with genuinely observed time-windowed demand, category skew, recency, stable ranking and fallbacks when low traffic.

Compare **same anchors, same candidate pool, same holdout and same availability rules** for baseline vs ML-based/hybrid strategy. Keep raw predictions, judgment manifest hashes and metric calculations. Do not invent “95% success” or report cosine similarity as purchase confidence.

### 8.2 Metrics and definitions

| Metric | Interpretation / required detail |
|---|---|
| Recall@1/@5/@10 | Relevant items present in top K against frozen labels and defined candidate gallery; specify relevance rule and query count |
| NDCG@5/@10 | Ranking quality for graded relevance, normalized by ideal order; define treatment of anchors with no relevant candidates |
| MRR / MAP@K | Optional where genuine first-relevant/precision objectives support it; specify eligible-query denominator |
| Catalog coverage | Unique recommended eligible products ÷ eligible products over evaluation query set; prevent a handful of popular products dominating all users |
| User/segment coverage | Fraction of eligible users/contexts that receive at least N valid recommendations; distinguish personalized from fallback |
| Intra-list diversity | Pairwise semantic/category/appearance diversity; avoid duplicates and extreme sameness; compare relevance cost |
| Novelty / long-tail | Exposure outside historically dominant products, with catalog visibility safeguards |
| Cold-start behavior | Clear fallback label and useful choices for signed-out/new/sparse-history sessions |
| FBT support/lift | Actual co-purchase sample size and conditional rate; avoid overclaiming tiny samples |
| Strategy fallback rate | Percent of requests using embedding profile, embedding similarity, co-purchase, popularity and unavailability separately |
| End-to-end p50/p95 | Browser → Express → FastAPI/SQL → hydrated results with catalog size, CPU/concurrency and cache warm/cold disclosure |
| Impression/click attribution | Explicit denominator (viewable exposures vs API responses), dedupe window, bot exclusions, conversion time window |

**Data gate for performance:** Predeclare reasonable target baselines after source audit and a small benchmark. A model improvement claim must be backed by measured results on the same evaluation protocol. If the dataset is tiny, report uncertainty and representative misses; do not inflate generalizability or invent statistical significance.

### 8.3 Evaluation acceptance / failure analysis

- At least one measurable real D3 learned-vector path must produce correct relevant products and beat a meaningful **category-only or unconditioned-popularity** baseline on a defensible representative test set, or provide a documented evidence-backed alternative criterion showing useful ML value. Do not lower a locked test set after looking at failures.
- Verify stale images, hidden products and wrong model versions never enter output, even if their vectors are highly similar.
- Characterize cold-start/sparse behavior honestly; deterministic fixtures are acceptable for **code correctness tests**, not for claiming user-engagement lift or genuine model training.
- Evaluate hard cases: visually indistinguishable SKU variants, category-bridging accessories, low-stock, brands with few images, one-image vs many-image products and test fixtures.
- Keep a compact failure table of false positives/negatives, zero-result contexts, similarity bias and response latency. Do not spend days tuning weight constants without real evidence; fix high-impact failures, document remaining limits.

---

## 9. FRONTEND UX — COMPLETE CUSTOMER JOURNEY AND DESIGN STRATEGY

### 9.1 Preserve ElectroHub design and reuse components

Use actual React 19/TypeScript/Vite/SCSS Modules/TanStack Query architecture, existing Poppins/brand tokens/spacing, Radix accessibility primitives, Lucide React and `ProductCard`/`ProductCardSkeleton`. Do not introduce a second component library, Tailwind template or new state framework. Do not implement fake cards with hardcoded products/prices.

**Figma pixel-by-pixel verification is deferred until Phase 05 as directed by the Project Owner.** Task 04.4 still requires polished, consistent production-quality visuals and accessibility. Inspect current UI, Storybook, accepted screenshots and source tokens; no blocker merely because a new Figma screen is absent.

### 9.2 Page placement and content hierarchy

| Page | Primary recommendation UI | Conditional sections and decisions |
|---|---|---|
| Home | **Recommended for You** when legitimately personalized; otherwise **Popular Products** or clearly titled Explore Products | Popular Products may appear separately if nonduplicative; preserve Hero, Deals, arrivals, categories and existing CTAs |
| Product Detail | **Similar Products** replacing existing “More in {category}” only if embedding results are real and ready | **You May Also Like** only when distinct useful candidates; **Frequently Bought Together** only with sufficient real order support; avoid three near-identical rows |
| Cart | One unobtrusive **Frequently Bought Together** or supported complementary-products section, after cart items but outside totals/checkout critical path | Never auto-add a product, change totals or interrupt checkout if AI fails |
| Category/Search | Optional contextual discovery rail, relevant filters and similarity | Never hijack ordinary search sorting, pagination, text search or 04.2 image search; user can browse normally |
| Recently Viewed (account or compact home module) | Private signed-in list with clear-history control, if consented | Do not label it ML recommendations; zero history/opt-out is normal |
| Guest / no consent | Safe anonymous contextual Similar and genuine popular/new arrival discovery | No personalized claim or hidden long-term activity tracking |

**Do not** force all five headings on one page. Distinctness, evidence and clean page composition matter more than the number of sections rendered simultaneously.

### 9.3 Suggested UI composition

```text
Homepage
  Existing Hero / Benefits / Categories / Arrivals / Deals
  [Recommended for You]   // only if real personal profile, else honest alternative
  [Popular Products]      // if genuine popularity data, no duplicate product flood

Product Detail
  Breadcrumb / Gallery / Price / Stock / Purchase / Description / Reviews
  [Similar Products]      // D3 source-eligible true model ranking
  [You May Also Like]     // contextual, distinct from Similar Products
  [Frequently Bought Together]  // only with real co-purchase evidence

Cart
  Existing Cart Items / Totals / Checkout CTA (unaffected)
  [Frequently Bought Together]  // distinct, optional, never modifies cart automatically
```

### 9.4 Reusable component architecture

Proposed files (adapt to actual repo, do not create unused wrappers):

```text
apps/frontend/src/features/recommendations/
  api.ts                         # typed Express API client
  types.ts                       # mode/strategy/public DTOs
  queryKeys.ts / queries.ts      # TanStack Query + user isolation
  components/
    RecommendationRail.tsx       # shared responsive grid/controlled carousel
    RecommendationRail.module.scss
    RecommendationCard.tsx       # preferably existing ProductCard adapter
    RecommendationSkeleton.tsx
    RecommendationStatus.tsx     # honest fallback/no-match/error treatment
  interactionTracking.ts         # consent, intersection visibility, idempotency
  recentlyViewed.ts             # opt-in user-only view / clear
  __tests__/                     # focused components/queries/events
  *.stories.tsx                  # Storybook stories for meaningful states
```

- **Prefer existing `ProductCard`** rather than a divergent recommendation card with separate price/stock/cart logic.
- Define one shared rail that supports semantic heading, supporting copy, skeleton, empty/hidden, retry, result count, cards and optional next/previous controls. Use CSS Grid for responsive multi-column layout; if using a carousel, arrow+keyboard/scroll behavior must be accessible and no scroll traps.
- Scope each Query key by mode, surface, anchor, current **user/consent identity**, relevant filter and server strategy/version when necessary. Clear private cached results on logout/account switch/opt-out; stale anonymous results must not mix with logged-in profiles.
- Preserve previously fetched usable cards during background revalidation, but recheck invalid/hide state as backend dictates. A failed optional rail must not replace product details with a page-level error.
- Link recommendation click to the same route as normal ProductCard. Real cart and wishlist actions use existing contexts and stock safeguards; do not duplicate optimistic inventory state.

### 9.5 State machine and truthful labels

```text
NOT_REQUESTED -> LOADING -> ML_RESULTS
                      |        |-> BACKGROUND_REFRESH
                      |        |-> PROFILE_UPDATED
                      |-> FALLBACK_RESULTS (strategy says why, no fake ML label)
                      |-> NO_ELIGIBLE_RESULTS (hide or useful restrained empty)
                      |-> AI_UNAVAILABLE / TIMEOUT (fallback or optional retry)
                      |-> AUTH_OR_CONSENT_REQUIRED (no private fetch/track)
                      |-> PAGE_NAVIGATION/CANCEL (abort/ignore stale responses)
```

**Copy rules:**

- Good: “Similar Products” for real embedding similarities; “Recommended for You” for consented real profile; “Popular Products” for actual measured activity; “More in Networking & Wi-Fi” for category fallback.
- Bad: “AI picked these just for you” for a signed-out guest; “Frequently Bought Together” when there are no actual co-purchases; “98% match” for cosine score; fabricated loading percentage or “trending now” with no activity.
- If AI is down but a valid generic fallback is returned, show a useful ordinary section without frightening banner text. Show unobtrusive retry/status if no suggestions are available; preserve other page sections.

### 9.6 Event collection UX and privacy

- Record actual visible recommendation card impressions, not all backend-returned results or every rerender.
- Allow navigation immediately; event delivery is best effort with bounded retry and no network delay blocking the click. Never blindly queue private events after logout/opt-out.
- Show a clear account preference for personalization/tracking consistent with existing privacy settings and current language, plus a “Clear recently viewed” action; avoid coercive consent dialogs or deceptive defaults.
- A recently-viewed strip should be genuinely user history, not ranking results disguised as history; never leak previously authenticated history into guest state.

### 9.7 Visual layout, responsive, accessibility and animation

Check actual layouts at **390, 768, 1440 and 1920px**; additionally 320px and 200% zoom for critical horizontal-rail controls where practical. Preserve square-ish ElectroHub design language, stable `aspect-ratio` and `object-fit: contain` electronics images, consistent ProductCard dimensions, no clipped shopping controls, appropriate section spacing and no excessive visual stacks.

- Semantic `<section aria-labelledby>` headings for each rail; correct hierarchy (`h2`/`h3` as applicable), not repeated unrelated h1.
- Loading skeletons are not keyboard targets or screen-reader noise; live status messages do not announce every item repeatedly.
- Arrow controls have explicit names, disabled states, no hidden swipe-only interaction; keyboard focus order returns correctly on navigation or remove/clear history.
- Product cards preserve meaningful image alt fallback and current price/availability labels; selected rails must not trap keyboard users.
- Support reduced-motion and avoid autoplay carousels; no unnecessary animation for ranking freshness. Contrast and focus indicators meet existing accessibility standard.
- Handle long names, missing images, out-of-stock and zero-results gracefully without layout shifts.
- RTL: use logical CSS properties and test existing Arabic/direction mode if the app already exposes it; do not implement an entirely new i18n system in 04.4.

### 9.8 Storybook stories — required, not a substitute for browser E2E

For new reusable recommendation components, add stories consistent with `apps/frontend/.storybook/` and existing ProductCard/CartPage stories:

```text
RecommendationRail / Similar Products — 4 live-shaped fixture cards
RecommendationRail / Personalized — genuine mock API strategy metadata only
RecommendationRail / Popular — truthful strategy
RecommendationRail / Loading skeleton
RecommendationRail / Empty, hidden/sparse, fallback, partial cards
RecommendationRail / API unavailable + retry
RecommendationRail / Long names / missing image / out of stock
RecommendationRail / Mobile 390 + desktop 1440 + RTL if supported
RecommendationRail / Keyboard focus and reduced motion
RecentlyViewed / signed-in, empty, cleared, consent-off
```

Story fixture data must be clearly artificial and never reported as live ML output. Add Storybook accessibility addon checks, interactive `play` assertions where useful and screenshot review for meaningful visuals. Do not generate dozens of redundant stories for the same state.

---

## 10. SECURITY, PRIVACY, ABUSE, AUTHORIZATION AND FAILURE ISOLATION

### 10.1 Threat model and negative cases

| Threat | Protection and mandatory verification |
|---|---|
| Forged user ID/session | Derive identity from authenticated backend session; never trust browser-supplied user ID; cross-user history denied |
| Forged click, view, purchase/conversion | Server allowlisted event types, valid impression token when applicable, trusted commerce status for purchases, dedupe/rate caps |
| Consent opt-out racing a pending event | Enforce current preference at write/commit; stop retries after opt-out, erase existing personal history/cache as policy requires |
| Unauthorized customer event-history retrieval | User-scoped relational query, role check and 401/403/404 negative tests; no public PostgREST exposure |
| FastAPI credential in browser | Private Express-to-FastAPI key, per-environment binding and private network; scan Vite build and browser network |
| Excessive candidate/weight/topK payload | Zod/Pydantic strict schemas, unique IDs, bounded list/weight, cost budgets and rate limits; no raw SQL identifiers |
| SQL injection and overbroad vector read | Parameterized pgvector queries; private schema/grants; restricted reader cannot read users/orders/payment tables |
| Prompt/metadata injection through product names | Treat catalog strings as plain data; React escapes content; no execution of model-provided HTML/JS |
| User or product visibility leakage | Backend authoritative eligibility, active/category/fixture/stock controls, post-ranking validation and safe 404 |
| Cached personalized results leaking after logout | Query-key subject scope, cache clear on logout/user switch, no shared HTTP/proxy cache of private responses, `Cache-Control: private`/no-store as appropriate |
| Cross-model vector mixing or stale media | Exact active index, source-revision/digest eligibility, profile version invalidation, safe no-ready fallback |
| Bot/inflated popularity | Rate limits, per-session/event dedupe, timestamp checks, weighted action quality, anomaly diagnostics; no blind trust of traffic volume |
| Training-data privacy/license breach | Private data export gate, rights+consent ledger, no Kaggle secrets/customer raw records; sanitized cohort dataset only if approved |
| Denial of service by expensive ranking | Candidate/input caps, bounded pgvector timeout, AI executor concurrency, circuit-breaker/fallback; no commerce critical-path dependency |
| Recommender altering commerce state | Read-only/vector privileges and backend products resolution; no order/stock/price mutation by AI service |

Do not log private user histories, event bodies with identifiers, embedding arrays, JWTs, database URLs or internal keys. Permit minimal request ID, strategy, version, candidate count, duration, fallback reason and anonymized aggregate metrics. Any telemetry dashboard must follow admin authorization; Task 05.7 full admin analytics remains separate.

### 10.2 Privacy decisions that must be documented before collecting data

1. Which types of events are strictly necessary to provide a requested feature? Which require optional tracking consent under the deployment policy?
2. Are anonymous visitors tracked at all? If yes, for how long and on what pseudonymous authority? Default to contextual no-persistence when unclear.
3. How does a customer view, clear, opt out of or delete their recently viewed and recommendation profile?
4. Does existing account deletion remove related rows and in-memory/browsing caches? Verify, don't just assert Prisma cascade.
5. Are impression/click attribution events retained as personally linked data? Establish TTL and erasure implementation.
6. Can real interaction data be sent to Kaggle? If not explicitly approved, **do not export it**. Offline training is optional; the existing D3 model remains usable.
7. Does the site have a current language/consent mechanism that Task 04.4 should reuse rather than duplicating?

This document is an engineering privacy specification, not a claim that any specific jurisdiction's legal requirements have already been satisfied. Surface any material policy decision for owner approval; continue independent functionality without inventing consent.

### 10.3 Fallback and dependency isolation

- **Recommendation AI down:** Express can return honest measured popularity/category fallback (when data exists), or an empty optional rail; regular product/detail/cart/search/checkout/orders continue.
- **Behavior DB write down:** Customer navigation/cart actions remain successful; log a safe aggregate failure; do not replay stale user events after revoked consent. Fail open for optional tracking, not for privacy/security.
- **Vector DB down:** `SIMILAR_PRODUCTS` learned mode is unavailable; do not call a category-sort result “AI Similar Products.”
- **Active model changed:** cached profiles/vectors with prior embeddingVersion are invalidated; never score one user vector against a different model space.
- **No suitable products:** gracefully hide rail or show a constrained useful empty message; never repeat same product to fill count.
- **No co-purchase activity:** FBT remains hidden or renamed non-co-purchase discovery; do not seed bogus orders into shared environments.
- **Commerce stock changes during recommendation:** Always validate actual stock/visibility in Express and again in checkout; recommendations are advisory.

---

## 11. TESTING AND QA — MEANINGFUL EVIDENCE, NO REDUNDANT CYCLES

### 11.1 Actual installed tools and execution expectations

| Layer | Tools | Non-mock evidence required |
|---|---|---|
| React | Vitest, React Testing Library, `user-event`, Storybook 9 + a11y addon, Playwright/Chromium, TypeScript/ESLint/Vite | Actual browser recommendation cards, route/navigation, keyboard, private-state reset |
| Express | Vitest, Supertest, Zod, Prisma, TypeScript/ESLint/build | Real DB-backed eligibility, security and event lifecycle |
| PostgreSQL | Prisma validate/generate/migrate, `psql`/pgvector and isolated DB harness, SQL role tests | Clean migration replay, uniqueness/deletion, correct D3 current source eligibility |
| FastAPI | pytest, httpx/TestClient, Ruff, strict mypy, actual D3 artifact and restricted pgvector | Real recommendation endpoint with model/index version checks and ranked UUIDs |
| ML evaluation | NumPy/Pandas/Scikit-learn if justified, Python scripts, manifest/metric assertions, PyTorch when training | Frozen relevant candidate/label set, baseline metrics and real D3 retrieval |
| GPU training (conditional) | Kaggle Free GPU, PyTorch CUDA, version-pinned notebook, safetensors/ONNX | **Actual** epochs/gradients/weight delta/checkpoints; not notebook existence alone |
| Operations | Existing Docker/CI workflow, log/health tools, controlled AI-down tests | Fallback and commerce isolation, no secrets |

Run focused tests during implementation; run the relevant full suites **once at integrated acceptance**. Reuse credible existing Task 04.2/04.3 evidence for unchanged source/environment, without blindly repeating image-upload/model training benchmarks. Test count alone does not establish correctness.

### 11.2 Backend/API security and business test matrix

- Public Similar/Popular correct; personal history requires live CUSTOMER session; other user's personal queries denied; revoked account/consent-off stops personalization.
- Anchor required for relevant modes; invalid slugs/UUIDs, malformed surface/limit/cursor and excessive payloads rejected; duplicate candidate UUIDs and nonfinite scores rejected.
- Real Product/ProductImage/Category/status/fixture filters exclude inactive, hidden, fixture, retired, recently deleted and out-of-stock per chosen policy. Never expose another user's wishlist/history.
- Same product excluded, deterministic order, no duplicate cards, stable tie-break, page-size bound and sensible zero-results handling.
- Exact public response uses current Prisma name/image/price/stock/slug; AI cannot invent pricing or claim a product purchasable.
- Valid client click/impression dedup; forged userId and purchase labels rejected; no event on unauthorized/tracking-off state.
- Idempotent event ingestion under repeated requests; retention clear, account deletion and consent withdrawal invalidate profiles and caches.
- Real OrderItem pair queries enforce distinct qualifying order IDs, statuses/payment states and minimum support; never double count quantities or repeated callbacks.
- Legitimate popularity/time decay wins over low-quality spam; no “Popular Products” output when no measured evidence and no policy-approved fallback of that label.
- AI service timeout/refusal/malformed result does not alter add-to-cart, search, product detail, checkout or order behavior.
- Guest/session cache and two distinct CUSTOMER sessions cannot share personalized products; logout clears cached personal data.

### 11.3 pgvector/AI and model test matrix

- Use actual current D3 artifact/descriptor and current-source eligible base + overlay vectors from disposable QA; no fake embedding vectors in claimed real ML integration.
- Query anchor product with several eligible images; show aggregated product vector is stable and results unique irrespective of image count/order.
- Replace/retire image and verify old vector no longer contributes, including while 04.3 worker pending; wrong source revision/digest fails closed.
- Mixing D3 active with STAGING Candidate C or RETIRED old vectors is rejected despite matching dimension.
- `ModelRegistry` recommendation readiness reflects actual vector availability and correct artifact/model identity. Model missing/mismatched means NOT_READY and safe fallback.
- Profile vector computed from current consented history changes predictably when genuine new behavior is recorded; identical events do not accumulate infinitely; zero-norm/empty cases fall back.
- Out-of-order profile job, model activation race and account opt-out cannot overwrite newer watermark/consent state.
- Fixed candidate set and same query produce deterministic ranking; finite scores only, bounded results, stable tie-break and no stale product UUID leak.
- Tested AI-down/pgvector-down, timeout and malformed response use safe fallback without breaking other FastAPI image-search readiness.
- If a separately trained ranker is deployed, test artifact checksum, feature schema, CPU parity, versioning, rollback and actual held-out advantage; no dummy pretrained-only claim.

### 11.4 Frontend/Storybook unit-state tests

- Modes render correct headings and honest provenance: real ML Similar, real profile Recommended for You, co-purchase FBT, measured Popular, and correctly renamed category/new-arrival fallback.
- RecommendationRail cards map to existing ProductCard functions; wishlist/cart pending/error events and product navigation remain correct.
- Initial loading, fallback, no-data, partial list, AI outage, retry, background refresh, cancellation and stale-response prevention.
- Personal results are never shown for anonymous/consent-off or previous account after logout/switch; clear recently viewed removes local state and calls only own API.
- Impression is emitted only after visibility threshold, tab visible and accepted policy; per-item dedupe; click navigation is not blocked by event post failure.
- Refetch after recent activity updates profile/user rail, but unrelated product detail UI does not refetch endlessly or flicker.
- Keyboard nav, visible focus, screen reader labels, reduced motion, missing image alt fallback and touch controls work at responsive widths.
- Storybook accessibility checks and real responsive story rendering; do not confuse mock stories with a live ML integration test.

### 11.5 Actual Playwright integrated QA

Run against **isolated QA** with real Express, disposable PostgreSQL/pgvector, FastAPI and a verified existing D3 artifact, not only intercepted responses. Separately use safe authorized DEV read/integration when its identity and permission gates pass.

**Customer E2E scenarios:**

1. Open product detail for a visible electronics SKU; **Similar Products** section loads real ranked cards and excludes the anchor. Click one and verify real product detail/price/stock.
2. Verify the former `More in {category}` row is either genuinely replaced with ML Similar Products or is still correctly labeled as a transparent fallback; never silently relabel category sort as learned similarity.
3. Open Home signed out: no personal recommendation data; measured Popular or other honestly named discovery appears, with no persistent unauthorized behavior events.
4. Sign in as test user A with approved test history; inspect Recommended for You. Perform legitimate views/clicks, refresh through authenticated API, verify an actual profile/vector change where signal is sufficient. Log in as user B: **no overlap through cached private data** beyond independent legitimately similar public products; no leaked A identity/history.
5. Opt out/clear history then refresh: personal rail disappears or turns into honest cold-start and no further private events are written. Account deletion erases permitted recommendation state.
6. Open product with enough legitimate order evidence: FBT results show true co-purchase products; for sparse/empty order dataset, FBT is hidden or appropriately renamed. Do not pretend QA fixtures demonstrate live purchase demand.
7. Cart page: optional suggestions never change basket, shipping total or checkout CTA; add a suggested item only after explicit customer action and existing inventory validation.
8. Stop FastAPI (isolated QA only): product details, category search and cart remain functional; related rail is fallback/empty, not page crash. Restore and verify recovery.
9. Fail/slow event API only: clicks still navigate and cart still works, no infinite retries or duplicate events.
10. Navigate/back/refresh at 390, 768, 1440, 1920; use keyboard-only rail controls, 200% zoom and reduced motion; inspect actual screenshots and relevant browser console/network errors.
11. Verify recommendation image URL is current (including 04.3 immutable revision), missing-media fallback and alt text; no private URL/service token in network responses.
12. Verify existing Task 04.2 Discovery Console image search continues to work; recommendation changes must not alter image-search model readiness or error handling.

**Interception-only Playwright suites** are valuable for UI states but are **not** acceptable proof of actual recommendation inference/pgvector integration. Label test evidence accurately.

### 11.6 Suggested commands — confirm scripts before use

```bash
# Backend
npm run lint --workspace=@electrohub/backend
npm run typecheck --workspace=@electrohub/backend
npm run test:ci --workspace=@electrohub/backend
npm run build --workspace=@electrohub/backend

# Frontend
npm run lint --workspace=@electrohub/frontend
npm run typecheck --workspace=@electrohub/frontend
npm run test --workspace=@electrohub/frontend
npm run build --workspace=@electrohub/frontend
npm run build-storybook --workspace=@electrohub/frontend

# AI service (in its approved virtual environment)
python -m pytest
python -m ruff check .
python -m mypy app

# Task-specific browser and real PG commands must be discovered from existing scripts
# and added with suitable Playwright config instead of inventing a command.
```

Use `npm run storybook --workspace=@electrohub/frontend` for interactive component review where available; Playwright configs should be scoped to recommendation tests and supported actual Chrome/Chromium installation. Existing tests and CI are not automatically current after new uncommitted changes. Report actual commands, counts, environment and source SHA.

### 11.7 Performance/observability acceptance

- Measure request latency components separately: Express validation/profile fetch, private HTTP, pgvector, ranker, Prisma hydration, serialization. Report cold vs warm, p50/p95 and sample size.
- Establish budget from measured CPU and storefront UX. Illustrative target (confirm under actual local constraints): cached popular <250ms backend, learned candidate retrieval commonly <1s, bounded total public recommendation response and fast safe fallback if timeout. Do **not** invent pass measurements.
- Limit event batch size, per-request user-history count and candidates; explain memory/concurrency. No full-table order scans, per-card AI requests or per-render re-ranking.
- Track safe aggregate counters: total recommendation requests by strategy/surface, fallback/no-data rate, active model/embedding version, eligible product coverage, queue/profile lag, request error/status and p95, impression/click volume after dedupe. No raw user history/vector content in logs.
- Demonstrate recommendation failure cannot degrade main commerce latency or correctness materially.

---

## 12. WORK PACKAGES, MULTI-AGENT COORDINATION AND STREAMLINED IMPLEMENTATION

### 12.1 Recommended implementation order

| Package | Scope | Completion evidence |
|---|---|---|
| WP0 — Discovery / Plan Mode | Confirm `develop`, 04.3 closed, current D3 index, existing 04.1 placeholders, real data availability, privacy decisions, related-file manifest | One-page plan + explicit training GO/NO-GO |
| WP1 — Contract and DB | Typed recommendation strategy, event/recency/consent schema, Prisma migrations and narrow AI read permissions; disposable QA replay | Real PG migrations, role/negative tests, data contract |
| WP2 — Real embedding engine | Source-eligible current product representation; D3 versioned similarity; profile feature projection; FastAPI ranker adapter/readiness | Real D3 nearest-neighbor + model/index identity proof |
| WP3 — Backend public API | Shared routes, auth/consent, attribution, co-purchase/popular, FastAPI client, authoritative ProductSummary hydration | Supertest/Prisma/negative integration |
| WP4 — Frontend UX | Shared rail, Home/ProductDetail/Cart placements, recently viewed, event tracking, fallback/empty/load/error UX | Storybook/Vitest + browser screenshots |
| WP5 — Evaluation/training | Actual D3 baseline and held-out relevance/coverage tests; behavior-ranker Kaggle only on data/rights GO | Metric report; optional genuine checkpoint evidence |
| WP6 — Integrated QA | Exact DEV/QA identity, real vector-serving/API/browser, guest vs signed-in, two-user privacy, outage; performance and regressions | One concise QA matrix, current test outputs |
| WP7 — Operations/handoff | Runbook, API/OpenAPI, privacy/retention, migration release effect, focused diff/source review | One implementation evidence file, Architect review-ready |

Independent packages should proceed in parallel only after shared API/schema/feature definitions are fixed. Critical contract files have one writer; reviewers are read-only.

### 12.2 Optional subagent plan (capable tools only)

When the runtime supports real parallel collaborators, use a coordinating lead and **up to 5–8 narrowly assigned agents**, not forced concurrency that causes overlapping edits:

1. **Architecture & evidence auditor (read-only):** existing route/schema/04.3/04.2 contract, data-inventory facts, requirement matrix.
2. **Database/Prisma engineer:** event/recent-viewed/profile/privacy migrations, order aggregation and real PostgreSQL tests.
3. **FastAPI/ML engineer:** current D3 source-aware recommendation repository, ranker readiness, exact-version pgvector and AI tests.
4. **Express engineer:** public APIs, consent/security/attribution and current catalog resolution.
5. **Frontend UX engineer:** Home/ProductDetail/Cart rails, React Query, existing components, Storybook and unit tests.
6. **Evaluation/training engineer:** frozen relevance labels, metrics, Kaggle readiness and honest conditional ranker experiment.
7. **Browser/QA engineer:** Playwright real stack, accessibility/responsive visual inspection and privacy two-user scenarios.
8. **Independent integration reviewer (read-only):** changed-file engineering review and prioritized defects.

Use actual available models/agents and record their use truthfully; never claim an unavailable GPT version or eight agents if only three slots exist. Do not let multiple agents edit schema, AI contract, route aggregator or shared component files concurrently. The coordinating lead must integrate all changes and independently verify cross-layer behavior.

### 12.3 Explicit time-box and stop rules

**Efficiency policy:** small issue investigations 5–15 minutes; significant investigations 15–40 minutes; high-risk DB/privacy/version issues receive proportionate full verification. Overall two-day recommendation implementation target assumes the current D3/04.3 foundation is usable; collecting/trainable real user behavior may require longer and is an honest external data gate, not permission to fake training.

- Stop repository discovery once task-related source paths/contract are known; no speculative audit of unrelated packages.
- Fix actual defects as encountered, add narrow regression, rerun only affected tests; run relevant full suite once at final acceptance.
- Reuse credible 04.2/04.3 proof when source/model/database/environment are unchanged. Do not repeat D3 encoder training, Storage QA or whole checkout verification without direct regression cause.
- Track **code defects**, **training-data/permission gaps**, **infrastructure limitations**, and **optional Phase 05 enhancements** separately.
- Stop optional polishing when all mandatory behavior, security and real E2E acceptance criteria pass; deliver a clear Architect-ready handoff rather than another multi-hour theoretical review.
- Never weaken a real safety or privacy gate, invent offline labels/behavior, seed PROD or misreport a mock as a live ML result to hit a time budget.

---

## 13. RELEASE SEQUENCING, ENVIRONMENT ISOLATION AND ROLLBACK

### 13.1 Risk-aware rollout order

1. Verify exact QA identity and replay current canonical migrations. Add only Task 04.4 app-owned event/privacy/profile schema and private AI recommendation query/role changes; test RLS/grants.
2. Confirm current 04.3 media-source eligibility and D3 descriptor are correct; implement and test version-compatible restricted recommendation reader.
3. Enable backend safe event/consent endpoints and readonly recommendation APIs in isolated QA. No automatic user tracking until permission policy is implemented.
4. Enable FastAPI ranking with truthful readiness and fallback. Source-eligible D3 current product representations only.
5. Enable React UI placements gradually; use a feature flag only where needed for compatibility. No premature 04.4 admin management dashboard.
6. Evaluate current D3 relevance/coverage and optional trainable-data gate. Promote no new ranker artifact without explicit review.
7. Apply shared DEV changes **only after explicit owner authorization**, exact Supabase identity, migration preflight and focused QA; run bounded live DEV smoke and check no customer data leaks.
8. Before merge, inspect `.github/workflows/prod-migration.yml` and migration allowlist: it has a `develop`-push PROD-targeting trigger in the inspected baseline. Prepare a reviewed deterministic release plan; **never merge assuming the task's new migration is automatically approved**.
9. Production deployment/promotion separate from source approval. No automatic PROD behavior tracking/backfill based solely on this document. No PROD seed. Source acceptance does not require PROD backup/PITR by itself, but integrity and exact-environment checks remain mandatory.

### 13.2 Rollback / degraded mode

- A feature flag or safe version switch may hide 04.4 UI and stop event ingestion without changing product availability or login/cart flows.
- Preserve additive migration tables and existing valid event history according to retention; do not use destructive down migration or manually rewrite Prisma migration ledger.
- Invalidate private recommendation caches/profiles on model/profile-strategy version rollback. Keep current Task 04.3 source-aware AI query; never revert to stale image vectors.
- Preserve D3 index and 04.3 worker from unrelated recommendation rollback. If new ranker unavailable, fall back honestly to existing D3 learned-similarity or measured popularity, depending on the surface.
- Verify no stale personal response is delivered through shared caches, CDN, browser back navigation or task worker retry after disabling personalization.
- Release packet must pin: exact schema migrations/checksums, code SHA, D3 model and index version, ranker/feature version if trained, eligible-product coverage, consent/retention policy, FastAPI API version and rollback/feature-flag plan.

---

## 14. CONCISE REQUIRED DOCUMENTATION AND IMPLEMENTATION EVIDENCE

Update the existing feature docs and architecture where actual behavior changes. Especially reconcile currently general/simulated-language recommendations docs with the **required real D3** ML path. Preserve historical 04.2/04.3 records; do not rewrite their acceptance evidence.

Suggested repository deliverables:

```text
docs/tasks/Phase-04/TASK_04.4_ML_POWERED_PRODUCT_RECOMMENDATIONS.md
  # authoritative task specification (this document)
docs/tasks/Phase-04/TASK_04.4_IMPLEMENTATION_EVIDENCE.md
  # one compact living handoff; append final verified facts, no duplicate reports
docs/ADR/ADR-011-recommendation-strategy-and-privacy.md
  # actual event/consent/profile/index/strategy choice, if ADR necessary
docs/05_Features/RECOMMENDATIONS.md
  # current real UI modes, API and fallback behavior
docs/07_AI/RECOMMENDER.md
  # real model/version/profiles/evaluation/training GO/NO-GO
docs/06_Database/ ...          # actual migration/persistence changes only
docs/10_Operations/ ...         # minimal recommendation metrics/rollback if necessary
apps/backend/src/docs/swagger/ ... # public API and auth/privacy contracts
apps/frontend/...stories.tsx  # reusable meaningful stories
apps/frontend/tests/...       # actual task E2E and screenshots
apps/ai-service/training/recommendations/... # data/eval scripts; training only with GO
```

**Evidence report minimum:**

| Dimension | Exact evidence required |
|---|---|
| Git baseline | Branch, merge base, HEAD, staged/unstaged/untracked, changed-file manifest, no unapproved commit/push/merge |
| Model/index | Actual active D3 descriptor/version/hash/dimension, current source eligibility and coverage, no pointer/base mutation |
| Data | Eligible catalog count, consented behavior/order availability, privacy choices, trained-ranker GO/NO-GO reasons |
| DB | QA migrations replay/no-op/checksums, table/index/role/erasure tests; DEV/PROD operations **only if actually authorized and performed** |
| ML | Real ranker adapter, profile vector generation, current pgvector query/response with real product IDs and model metadata |
| Ranking evaluation | Frozen query/label or holdout digests, baselines, Recall/NDCG@K, coverage/diversity, latency and mistakes |
| Conditional training | Kaggle notebook run ID/GPU/device, dataset authorization, gradient/weights/checkpoint/metrics, or explicit NOT RUN due to NO-GO |
| APIs | FastAPI private and Express public auth/validation/fallback, correct current catalog hydration |
| Tracking | Legitimate event write, dedupe, consent/erase, two-user isolation, no forged purchase, retention cleanup |
| UI | Five modes and deliberate placements, Storybook stories/a11y and actual responsive browser evidence, honest labels |
| QA | Commands + pass/fail/skip, isolated real E2E and negative cases, typecheck/lint/build, CI **only for the tested SHA** |
| Risks | Critical/high blockers vs non-blocking residuals vs Phase 05 scope; exact needed owner approvals |

Do not dump raw event data, payment/customer identity, private Kaggle datasets, tokens, vectors or environment URLs with secrets into the report.

---

## 15. ACCEPTANCE MATRIX — T44-01 THROUGH T44-60

Use **PASS / FAIL / NOT VERIFIED / NOT APPLICABLE WITH REASON**, each with a compact real test/source/evidence pointer. Conditional trained-ranker items must be visibly marked GO/NO-GO, not silently omitted or marked PASS merely because a notebook exists.

| ID | Acceptance requirement | Evidence |
|---|---|---|
| T44-01 | Actual local/remote `develop`, worktrees, branch and task ownership verified before edits | Git/status snapshot |
| T44-02 | Closed/merged 04.3 source is base; no duplicate Storage/media catalog or index | Diff/architecture review |
| T44-03 | Existing 04.1 recommendation FastAPI route/service/registry and Express AI client reused | Source/API diff |
| T44-04 | Current active D3 artifact/index version and source eligibility verified | Read-only model/AI SQL evidence |
| T44-05 | Current real catalog/product, category, activity and order data availability audited | Sanitized inventory/GO-NO-GO |
| T44-06 | Actual consent/tracking/retention/erasure decisions recorded before collection | Privacy policy/negative tests |
| T44-07 | Current image vectors use exact active D3 model/preprocess/artifact/embedding version | Real pgvector/descriptor test |
| T44-08 | Current-source revision/digest gate reused; stale 04.3 vectors not ranked | SQL/source replacement test |
| T44-09 | Current multi-image product representation and product aggregation defined and tested | Real vector/fixture tests |
| T44-10 | Similar Products performs real learned-vector retrieval | Actual FastAPI+pgvector result |
| T44-11 | Similar Products excludes anchor, duplicates, hidden/ineligible/fixture products | Express/API tests |
| T44-12 | You May Also Like uses meaningful contextual/hybrid signal with truthful provenance | ML/hybrid comparison tests |
| T44-13 | Returning-user profile uses genuine authorized behavior and learned item vectors | Consent/profile vector integration |
| T44-14 | Profile weights/windows and sparse-history threshold are versioned and justified | Feature spec/eval |
| T44-15 | Changing meaningful user behavior updates appropriate recommendations; no fake per-user claim | Two-step authenticated E2E |
| T44-16 | Model/profile version changes invalidate stale cached user vectors | Version/race tests |
| T44-17 | Anonymous/new/consent-off users receive an honest fallback without private tracking | API/privacy/browser |
| T44-18 | Real co-purchase aggregation uses distinct qualifying orders, excludes invalid/test/unpaid | SQL/OrderItem integration |
| T44-19 | FBT support/confidence/lift thresholds are appropriate; no bogus “bought together” claim | Sparse/real order evidence |
| T44-20 | Measured popularity uses valid time-bounded, deduped signals | Aggregate unit/DB test |
| T44-21 | No-traffic state uses honestly named discovery instead of fake popularity | UI/API negative test |
| T44-22 | Event endpoints authenticate/validate/limit requests; client cannot forge user or purchase | Supertest/security |
| T44-23 | Product views/clicks/impressions are emitted only under legitimate triggers | Browser/network and unit |
| T44-24 | Impression/click idempotency and attribution prevent duplicates/replays | DB unique/retry tests |
| T44-25 | Recently viewed upsert, cap, clear and private access work | Prisma/API/E2E |
| T44-26 | Consent withdrawal/account deletion erases personal recommendation data safely | DB/authorization regression |
| T44-27 | Private cache isolation on logout/account switch/opt-out works | Two-user browser test |
| T44-28 | No passwords, tokens, addresses, raw customer images or unrestricted DB secrets sent to AI/Kaggle | Config/log/export audit |
| T44-29 | Prisma changes additive; clean full migration replay and second no-op pass | Isolated PG/Prisma |
| T44-30 | Runtime DB reader/AI roles cannot read/write unauthorized commerce/private tables | Actual SQL role denial |
| T44-31 | Current `ProductImage`, `OrderItem` and product APIs remain backward compatible | Schema/API regressions |
| T44-32 | FastAPI recommendation adapter real, bounded and version-aware | pytest + actual model execution |
| T44-33 | Recommendation readiness truthful; mismatched/missing index/adapter fails safely | Private ready/capabilities tests |
| T44-34 | `AiServiceClient.recommend` and schemas handle additive contracts/errors/limits | Zod/Pydantic contract |
| T44-35 | Express resolves candidates through current authoritative catalog, price, stock and slug | DB-backed public API test |
| T44-36 | AI outages, stale vectors and wrong versions never degrade core commerce | Fault-isolated real stack |
| T44-37 | Cached public/private strategies have appropriate version/subject/consent identity | Cache invalidation tests |
| T44-38 | No unbounded queries/inference/event memory, CPU resources measured | Bounded load/latency report |
| T44-39 | Home placement shows appropriate personalized or truthful fallback rails | React + browser |
| T44-40 | ProductDetail correctly replaces/supplements category-only row with real Similar Products | Source + real browser |
| T44-41 | ProductDetail You May Also Like distinct and justified; no forced duplicates | E2E/card overlap |
| T44-42 | FBT appears on product/cart only with order evidence, doesn't mutate cart | Browser/order fixture |
| T44-43 | Popular/Recently Viewed displayed only where their data/consent permit | Browser/state test |
| T44-44 | All cards use existing ProductCard, live images/alt, real cart/wishlist/navigation | UI/API E2E |
| T44-45 | Loading, empty, partial, sparse, error, fallback and background refresh truthful | Storybook/Vitest/browser |
| T44-46 | Storybook component/state stories implemented and inspected, a11y checked | Storybook evidence |
| T44-47 | Responsive mobile/tablet/desktop/large desktop, keyboard, focus, reduced motion, 200% zoom | Playwright screenshots/notes |
| T44-48 | RTL/localization compatible with actual supported app behavior | Existing locale directional smoke or justified N/A |
| T44-49 | Existing text/catalog/04.2 image search/04.3 product media/cart/checkout directly unaffected | Focused regression |
| T44-50 | Independent frozen relevance/query or genuine chronological holdout defined | Evaluation manifest |
| T44-51 | Same-pool category/popularity vs learned-vector baseline comparisons recorded honestly | Predictions + metrics |
| T44-52 | Recall@K/NDCG@K, coverage, diversity, cold-start/fallback and latency calculated correctly | Tested evaluation script |
| T44-53 | Important bad examples and data sparsity/identity limitation documented | Failure analysis |
| T44-54 | Behavior-ranker training GO/NO-GO is evidence-based, with data rights | Data gate report |
| T44-55 | If training GO: actual Kaggle CUDA/gradients/checkpoint/held-out eval; if NO-GO: NO fictitious trained-model claim | Executed run **or** explicit conditional N/A |
| T44-56 | If trained-ranker deployed: safe artifact, feature schema, CPU parity, version gate/rollback | Artifact tests **or** explicit N/A |
| T44-57 | Real ML → private FastAPI → Express hydrated public API → React render demonstrated | Unmocked isolated QA / authorized DEV |
| T44-58 | Tests, lint, typecheck, builds, focused + final affected suites credible | Commands/counts/source SHA |
| T44-59 | Production migration workflow/allowlist and rollout consequences reviewed before any merge | Exact workflow/policy evidence |
| T44-60 | One concise honest evidence report, complete changed-file review and clear Architect approval request | Final handoff |

**Assessment rule:** A *conditional* training row can be N/A only with a genuine data-readiness NO-GO and a functioning learned D3 recommender. T44-07/08/10/13 (where valid history exists)/15 (where valid history exists)/32/35/50/51/52/57 cannot be marked PASS solely via mocks or a notebook template. A security bypass, user-history leakage, mixed model versions, or category-only AI claim is a blocking defect.

---

## 16. FINAL REVIEW, SCORING AND HANDOFF — ONE DECISIVE CYCLE

### 16.1 Engineer's first-handoff report

```text
ELECTROHUB TASK 04.4 — IMPLEMENTATION REPORT

STATUS: COMPLETE / PARTIAL / BLOCKED
READY FOR PRINCIPAL ARCHITECT REVIEW: YES / NO

Repository / base SHA / feature HEAD / local worktree:
Exact changed/new/deleted paths, migration IDs/checksums:
Task 04.3 prerequisite state (merged; actual active D3 identity):
Current QA/DEV/PROD environment identities and actions (read/write):
Actual data rights, consent policy and training GO/NO-GO:
Actual recommendation strategies and where UI renders:
Prisma migrations / role grants / replay results:
FastAPI source-eligible learned-vector query and readiness:
Express authorization, product hydration and fallback:
User profile, recently viewed, impressions/clicks, erasure:
True co-purchase / measured popularity evidence or honest sparse limits:
Evaluation protocols, baselines, Recall/NDCG, coverage/diversity, latency:
Conditional Kaggle training evidence or explicit no-run justification:
Storybook / visual a11y / Chromium Playwright viewports:
Tests (focused/final), lint, types, build, relevant CI SHA:
Bugs reproduced and fixed, security findings, regressions:
Remaining BLOCKERS vs ACCEPTABLE RISKS vs PHASE 05 DEFERRED:
No commit / no push / no merge / no unauthorized PROD writes:
```

Only evidence from actually performed steps may be marked PASS. Link to minimal privacy-safe logs/screenshots/results, no large redundant audits. An implementer must not award their own Architect approval.

### 16.2 Principal Architect review policy

The Principal Architect reads the task and report, establishes the full branch-versus-`develop` diff **including untracked files**, inspects every changed human-authored source file and relevant direct consumers, verifies security/AI/index/database contracts, evaluates credible QA and real browser/ML evidence, and scores out of 100. Identify only actionable blockers/material verification gaps and separate optional Phase 05 work.

Decision:

- **✅ Approve:** mandatory acceptance criteria met, real D3-based recommendations proven, data/privacy secure, test evidence credible and residual risks acceptable.
- **⚠ Request Changes:** concrete defect, missing mandatory behavior, unsafe migration, privacy leak or essential unverified real ML/E2E remains; return a consolidated smallest necessary fixes list.
- **❌ Reject:** fundamentally incompatible architecture, fabricated model/data evidence or severe unrecoverable security/integrity failure.

Do not demand a separate behavioral ranker where the data GO gate is legitimately NO-GO. Do not claim 100/100 because the interface looks polished. Accept meaningful current evidence, avoid repetitive check runs and approve when no material blocker remains.

### 16.3 Scope stop conditions

**Stop development and present for review when:** all five modes have appropriate genuine or honestly empty/fallback implementations, real D3 Similar and behavior-profile flows are verified when sufficient history exists, eligibility/version/privacy/security and one real browser ML path pass, frozen evaluation is reproducible, Storybook/Playwright QA and relevant suites pass, source review finds no material blocker, evidence is concise and truthful. Do not turn Task 04.4 into Phase 05 admin recommendation management or a new 04.2 encoder-training project.

**Escalate exactly when:** consent/data rights are unresolved for tracking/Kaggle; training labels cannot support a trained ranker; a non-destructive migration cannot be proven safe; DEV/PROD identity differs from expected; required protected credential/role unavailable; active embedding version incompatible; or a mandatory real ML E2E cannot be exercised with available approved tools. Finish independent work while reporting the precise gate, not vague “needs more research.”

### 16.4 Exact implementation authorization boundary

The implementing agent **may** edit the assigned feature branch, add source/tests/docs, launch isolated disposable services, migrate disposable QA, run bounded fake/unit tests, evaluate genuine approved local D3 vectors and produce local screenshots/evidence.

The implementing agent **may not** without separate owner approval: write/migrate/seed shared DEV or PROD, provision shared database credentials/roles, upload private data to Kaggle, start paid GPU jobs, activate a new model, deploy, modify unrelated stored catalog media, or commit/push/merge. A merge to `develop` is particularly sensitive because current production-migration workflow behavior must be reviewed before integration.

---

## 17. FINAL EXECUTION DIRECTIVE — TASK 04.4

**Inspect the actual merged `develop` repository FIRST.** Enter Plan Mode, establish the exact active D3/source-correct vector contract, inspect real behavior and commerce data, design minimal safe migration/consent/API contracts, then implement real learned-embedding similarity and profile-based personalization through existing FastAPI → Express → React boundaries. Deliver five honest recommendation modes and corresponding Storybook/Playwright UX, preserve all existing product/cart/media behavior, and evaluate relevance/coverage/latency against frozen baselines. If behavior training is genuinely data-ready and permitted, execute an actual Kaggle GPU optimization and report weight/metric evidence; if not, don't invent it—use the genuine D3 learned-embedding recommender as the core ML implementation and truthfully declare the trained-ranker NO-GO.

**The intended result is a strong, production-quality first handoff with no repeated “basic bug” cycles.** Use focused tests while coding, one integrated final affected-suite run, source/diff review and concise evidence. Stop theoretical investigations once acceptance is established.

**NO FAKE ML. NO CUSTOMER-DATA LEAKAGE. NO MIXED EMBEDDING VERSIONS. NO UNAUTHORIZED REMOTE WRITES. NO COMMIT. NO PUSH. NO MERGE. NO SELF-APPROVAL.**

> **Task 04.4 succeeds when ElectroHub's recommendation UI demonstrably uses source-correct learned product embeddings and legitimate behavior/order signals to provide genuinely useful, accurately labeled, secure, measurable recommendations—without ever becoming an authority over commerce or a dependency of checkout.**

---

## 18. REFERENCE SNAPSHOT AND IMPLEMENTATION LINKS

**Project references inspected:** `docs/01_Project Foundation/ROADMAP.md`, `TECH_STACK.md`; `docs/03_Architecture/AI_ARCHITECTURE.md`; `docs/05_Features/RECOMMENDATIONS.md`; `docs/07_AI/RECOMMENDER.md`; Phase 04 Task 04.1/04.2/04.3 specifications/evidence; current Prisma schema and AI schema roles; `apps/ai-service/app/{api/routes/recommendations.py,schemas/recommendations.py,services/recommendation_service.py,models/interfaces.py,models/registry.py,integrations/pgvector_gateway.py,main.py}`; `apps/backend/src/integrations/ai/{ai.client.ts,ai.schemas.ts}` and catalog/routes; `apps/frontend/src/pages/{HomePage.tsx,customer/ProductDetailPage.tsx,customer/CartPage.tsx}`; existing package/tooling, Storybook, Playwright. Baseline `develop` SHA is stated in the header and **must be reverified at implementation start**.

**External technical foundations to consult when needed (not substitutes for actual source):**

- PyTorch training/eval: <https://pytorch.org/docs/stable/index.html>
- PyTorch CUDA availability: <https://pytorch.org/docs/stable/cuda.html>
- FastAPI security/dependency injection: <https://fastapi.tiangolo.com/tutorial/security/>
- Pydantic validation: <https://docs.pydantic.dev/latest/>
- pgvector distance/index semantics: <https://github.com/pgvector/pgvector>
- Supabase PostgreSQL/roles: <https://supabase.com/docs/guides/database>
- Prisma migrations: <https://www.prisma.io/docs/orm/prisma-migrate>
- Storybook for React and a11y: <https://storybook.js.org/docs>
- Playwright E2E: <https://playwright.dev/docs/intro>
- Kaggle notebooks: <https://www.kaggle.com/code>

**Documentation precedence:** Explicit current Task 04.4 acceptance requirements → actual merged code/approved architecture → valid model/index/data evidence → existing older generalized docs. If an older AI architecture paragraph permits “simulated recommendations,” that is **superseded by Task 04.4's explicit real ML requirement**; do not silently downgrade this task.
