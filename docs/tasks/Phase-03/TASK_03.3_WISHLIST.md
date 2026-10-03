# ELECTROHUB — TASK 03.3 / WISHLIST

**Phase:** 03 — Commerce  
**Task:** 03.3 — Wishlist  
**Branch:** `feature/Wishlist`  
**Target branch:** `develop`  
**Status:** Authoritative implementation task  
**Primary area:** Guest Wishlist / Authenticated Wishlist / Product-to-Wishlist interactions / Wishlist page  
**Implementation type:** Full-stack + UI + state + API + persistence + reconciliation + validation + Storybook + automated/manual QA  

---

# 1. Task Objective

Implement ElectroHub's complete Wishlist experience on top of the approved Product Catalog, Authentication, Cart, State/API, Product Review/Rating, Inventory, and existing database foundations.

TASK 03.3 must deliver:

- Add Product to Wishlist;
- Remove Product from Wishlist;
- View Wishlist;
- navigate from Wishlist Product → Product Details;
- guest Wishlist support;
- authenticated Wishlist support;
- guest persistence across navigation and refresh;
- authenticated persistence through the backend;
- guest → authenticated Wishlist reconciliation;
- ProductCard heart action;
- Product Details heart action;
- Product Details rating/review-star presentation aligned with the supplied Make reference while reusing the existing Reviews foundation;
- `/wishlist` page;
- current Product hydration/availability;
- empty/loading/error/unavailable states;
- responsive and accessible behavior;
- polished Wishlist interactions;
- Storybook component/state verification;
- focused backend/frontend/integration/E2E verification;
- documentation and final evidence.

Wishlist is a **set of unique Products**.

There is:

- no Wishlist quantity;
- no stock reservation;
- no price snapshot;
- no Checkout behavior;
- no Order behavior.

```text
02.2 Database Foundation
        ↓
User / Product / Wishlist foundation where already present
        ↓
02.5 Product Foundation
        ↓
Product / Images / Current Price / Inventory / Availability
        ↓
02.7 State + API Foundation
        ↓
React Query / API client / cache / errors / loading
        ↓
03.1 Product Catalog
        ↓
ProductCard / Product Details / Reviews / ratings / imagery
        ↓
03.2 Shopping Cart
        ↓
Add-to-Cart integration / app-shell / auth transition patterns
        ↓
03.3 Wishlist
        ↓
Guest + authenticated Wishlist / heart state / merge / Wishlist page
```

03.3 must **consume and extend** the current architecture.

It must not create a parallel:

- Product architecture;
- Review architecture;
- Auth architecture;
- Cart architecture;
- state-management architecture;
- API client;
- design system.

---

# 2. Fixed Roadmap Scope

The roadmap defines TASK 03.3 as:

- Add Product;
- Remove Product;
- View Wishlist;
- Product navigation.

This task expands those bullets into the complete production-quality customer experience required by the approved Make screenshots and guest/auth persistence requirements.

## 2.1 Included

1. Guest Wishlist.
2. Authenticated Wishlist.
3. Add Product.
4. Remove Product.
5. View `/wishlist`.
6. Navigate Wishlist Product → Product Details.
7. ProductCard heart.
8. Product Details heart.
9. Product Details existing review stars/rating presentation.
10. Guest local persistence.
11. Authenticated server persistence.
12. Guest → authenticated reconciliation.
13. Set-union merge policy.
14. Current Product data hydration.
15. Product current price display.
16. Product current availability display.
17. Out-of-stock Wishlist handling.
18. Inactive/unavailable Product handling where repository architecture permits.
19. Empty Wishlist.
20. Loading states.
21. Error/retry states.
22. Optimistic Add/Remove where safe.
23. Current Header Wishlist entrypoint when such an icon already exists in the approved shell.
24. Responsive behavior.
25. Keyboard/accessibility behavior.
26. Reduced-motion behavior.
27. Storybook states.
28. Backend/service/API tests.
29. Frontend component/hook/storage tests.
30. Integration tests.
31. Focused Playwright/browser E2E.
32. Manual visual/responsive/keyboard verification.
33. Task-relevant documentation updates.

## 2.2 Explicitly Excluded

Do **not** implement:

- Checkout;
- shipping;
- tax;
- Stripe;
- payment;
- Order creation;
- Cart redesign;
- Inventory reservation;
- stock decrement;
- Wishlist folders;
- multiple named Wishlists;
- shared/public Wishlists;
- Wishlist collaboration;
- price-drop alerts;
- back-in-stock notifications;
- Wishlist email notifications;
- AI recommendations;
- frequently bought together;
- Cloudinary work;
- admin Wishlist management;
- new Reviews API;
- new rating calculation system;
- review-writing UI merely because stars are shown in the reference;
- delivery tracking;
- PDFs;
- transactional email.

Do not expand TASK 03.3 into future Commerce tasks.

---

# 3. Core Domain Decision — Wishlist Is a Set

Wishlist Product identity is unique.

```text
Wishlist = Set<Product>
```

The same Product must not appear twice.

```text
Add Product A
Add Product A again
        ↓
one Wishlist entry for Product A
```

There is no quantity.

Do not introduce:

- `quantity` on WishlistItem;
- Wishlist line totals;
- Wishlist subtotal;
- Wishlist stock reservation;
- Wishlist price snapshot.

---

# 4. Guest + Authenticated Philosophy

TASK 03.3 follows the same source-isolation philosophy established by Cart, while remaining simpler because Wishlist has no quantities.

```text
Unauthenticated
→ Guest Wishlist
→ local browser persistence

Authenticated
→ Server-backed Wishlist
→ React Query

Login transition
→ union Guest + Server Wishlist
→ server becomes authoritative
```

User identity is owned by the current Auth architecture.

Wishlist state must not create another Auth model.

---

# 5. Guest Wishlist

Unauthenticated customers must be able to:

- save a Product from ProductCard;
- unsave a Product from ProductCard;
- save/unsave from Product Details;
- open `/wishlist`;
- view saved Products;
- refresh without losing Wishlist;
- navigate away and back without losing Wishlist;
- remove Product from Wishlist page;
- navigate from Wishlist Product to Product Details;
- use existing Add-to-Cart behavior from Wishlist where the approved/current ProductCard presentation provides it;
- sign in later without losing saved items.

Authentication must **not** be required merely to save a Product.

---

# 6. Guest Wishlist Persistence

Use a small versioned browser-storage representation.

Recommended key:

```text
electrohub.wishlist.v1
```

Recommended shape:

```ts
type GuestWishlistState = {
  productIds: string[];
};
```

Persist only Product identity.

Do **not** persist authoritative:

- Product name;
- Product slug;
- Product price;
- Product image;
- category;
- brand;
- stock;
- availability;
- average rating;
- review count;
- Product status;
- Cart state;
- private User data.

All Product presentation data must be hydrated from current Product/backend truth.

## 6.1 Defensive Storage Handling

Guest Wishlist hydration must survive:

- missing storage key;
- empty storage;
- malformed JSON;
- wrong object shape;
- non-array `productIds`;
- invalid Product IDs;
- duplicate Product IDs;
- excessive Product IDs;
- browser storage unavailable;
- browser storage exceptions.

Malformed guest state must not crash ElectroHub.

Normalize duplicate IDs into a set.

Never allow a malformed storage value to become authoritative.

## 6.2 No Sensitive Data

Do not store in Wishlist localStorage:

- auth tokens;
- refresh tokens;
- User IDs;
- emails;
- addresses;
- payment data;
- profile data;
- server Wishlist IDs.

---

# 7. Authenticated Wishlist

Authenticated Wishlist is server-owned.

Required behavior:

- Wishlist belongs to authenticated customer;
- frontend does not choose `userId`;
- Wishlist persists across page refresh;
- Wishlist persists across logout/login;
- Wishlist can be used from different sessions/devices where backend architecture supports it;
- same Product cannot create duplicate Wishlist entries;
- Product data returned to UI is current and bounded.

Backend ownership must come from the authenticated principal.

```text
request
→ auth middleware
→ current authenticated CUSTOMER
→ current customer's Wishlist
```

Never trust:

```text
userId from request body/query
```

as ownership authority.

---

# 8. Guest → Authenticated Wishlist Reconciliation

This task locks the merge policy:

# **SET UNION**

```text
Server Wishlist
∪
Guest Wishlist
=
Merged Authenticated Wishlist
```

Example:

```text
Server:
- iPhone
- MacBook

Guest:
- MacBook
- AirPods

Merged:
- iPhone
- MacBook
- AirPods
```

MacBook appears once.

## 8.1 Why Union Is Required

Union is:

- deterministic;
- idempotent;
- duplicate-safe;
- retry-safe;
- natural for a set domain;
- preserves both customer sources.

Do not implement:

- Guest replaces Server;
- Server replaces Guest;
- duplicate rows;
- quantity-like merge logic.

## 8.2 Required Login Flow

```text
guest Wishlist exists
        ↓
successful authentication confirmed
        ↓
authenticated Wishlist source established
        ↓
server Wishlist loaded/available
        ↓
guest Product IDs validated
        ↓
union reconciliation
        ↓
server persists unique result
        ↓
returned merged Wishlist installed in React Query cache
        ↓
guest localStorage cleared ONLY after confirmed success
        ↓
UI immediately shows merged Wishlist
```

The customer must not temporarily lose their server or guest Wishlist during the source transition.

## 8.3 Merge Failure

If reconciliation fails:

- do not clear guest storage;
- do not delete server Wishlist;
- do not claim success;
- keep guest IDs recoverable;
- show a sanitized retryable error;
- allow Retry;
- avoid duplicate rows on retry.

## 8.4 Reconciliation Retry

Repeating the same reconciliation request must produce the same set.

```text
server = {A, B}
guest = {B, C}

retry 1 → {A, B, C}
retry 2 → {A, B, C}
retry 3 → {A, B, C}
```

Never create duplicate B/C entries.

---

# 9. Logout Isolation

On logout:

- authenticated Wishlist remains on server;
- do not copy server Wishlist into guest localStorage;
- do not leak authenticated Wishlist into the next guest session/User;
- browser returns to its separate guest Wishlist source.

If no separate guest Wishlist exists after logout:

```text
guest Wishlist may be empty
```

That is valid.

Logging back into the same authenticated account must restore the server Wishlist.

Avoid an auth→guest transition flicker that falsely suggests the server Wishlist was deleted if navigation leaves the page.

---

# 10. Product Hydration / Validation

Guest storage contains IDs only.

The Wishlist UI must hydrate them using current Product data.

Avoid:

```text
one Product HTTP request per Wishlist item
```

Preferred:

1. reuse an existing bounded bulk Product/public hydration endpoint if suitable;
2. otherwise add the smallest public Wishlist validation/hydration endpoint consistent with current API standards.

Conceptual input:

```json
{
  "productIds": ["...", "..."]
}
```

Return only public Product fields required by Wishlist UI.

If current project has a standard bounded collection size, use it.

If no standard exists, choose a conservative documented upper bound and validate it.

Do not expose private User data.

---

# 11. Database Foundation / Migration Rule

Before writing any migration:

1. inspect current `schema.prisma`;
2. inspect migration history;
3. inspect database docs;
4. confirm whether Wishlist/WishlistItem already exist;
5. inspect uniqueness and ownership relationships.

Expected outcome:

```text
existing Wishlist foundation sufficient
→ no new migration
```

If the existing foundation includes a direct User↔WishlistItem relation rather than an explicit Wishlist parent model, reuse the repository truth.

Do not force a new model just to match conceptual naming.

## 11.1 Required Data Integrity

Regardless of exact model names, authenticated Wishlist must enforce:

```text
one unique saved Product per authenticated customer
```

Conceptually:

```text
unique(userId, productId)
```

or equivalent through a Wishlist parent + WishlistItem relationship.

## 11.2 Do Not Add

Do not add:

- guest Wishlist DB rows;
- anonymous User rows;
- browser-session Wishlist tables;
- quantity fields;
- price snapshot fields;
- availability snapshot fields;
- Checkout fields;
- Cart duplication.

## 11.3 Migration Allowed Only If Proven Necessary

A migration is allowed only when current repository truth proves the existing schema cannot satisfy mandatory 03.3 behavior safely.

If schema change is proposed, final handoff must explain:

- why current schema is insufficient;
- exact migration;
- data-loss assessment;
- uniqueness strategy;
- DEV/PROD operation status;
- rollback/forward safety.

Never use `prisma db push` as a migration substitute.

---

# 12. Mandatory Repository-First Workflow

Before implementation:

1. Read root `AGENTS.md`.
2. Confirm branch and HEAD.
3. Work on `feature/Wishlist`.
4. Synchronize safely according to repository Git workflow.
5. Read this task completely.
6. Inspect current `docs/` tree.
7. Identify only documents materially relevant to 03.3.
8. Read those docs before implementation.
9. Inspect current:
   - Wishlist schema/models if present;
   - Product;
   - Inventory;
   - Authentication;
   - ProductCard;
   - Product Details;
   - Reviews/rating presentation;
   - Header Wishlist icon if present;
   - API client;
   - React Query architecture;
   - Cart integration only where Wishlist page reuses Add-to-Cart;
   - current tests;
   - Storybook;
   - supplied Make screenshots.
10. Compare Make screenshots against task/business requirements.
11. Classify screenshot elements:
   - approved + in scope;
   - already existing/reused;
   - controlled refinement allowed;
   - future/out-of-scope;
   - stale app-shell context.
12. Produce the smallest complete implementation plan.
13. Implement only 03.3.
14. Update affected docs.
15. Verify final docs and implementation agree.

Do not trust previous chat summaries over current repository truth.

---

# 13. Task-Specific Documentation Discovery

Do **not** blindly read every project document.

Identify only task-relevant documentation.

Likely relevant:

## Project Foundation

- Roadmap;
- Project structure;
- Tech stack;
- dependencies;
- decisions/ADRs where materially relevant.

## Design

- Figma/Make reference docs;
- design system;
- components;
- layouts;
- colors;
- typography;
- icons;
- motion;
- responsive;
- UI guidelines.

## Architecture

- system architecture;
- frontend architecture;
- backend architecture;
- API architecture;
- database architecture.

## Engineering Standards

- coding standards;
- TypeScript;
- SCSS;
- component guidelines;
- API guidelines;
- state management;
- error handling;
- security;
- performance.

## Feature Docs

- Wishlist;
- Products;
- Inventory;
- Authentication;
- Reviews;
- Cart only where existing Add-to-Cart is reused.

## Database

- Prisma schema;
- tables;
- relationships;
- indexing;
- migrations;
- seeding only if actual schema/seed work becomes necessary.

## Quality

- Testing;
- Integration;
- E2E;
- Accessibility;
- Performance;
- Storybook;
- Definition of Done.

## Workflow

- Git workflow;
- branching;
- code review.

Do not spend task time reading:

- Stripe;
- Delivery;
- AI;
- Cloudinary;
- PDF;
- Email;
- Admin analytics;
- unrelated future Commerce domains;

unless current code proves a direct dependency.

Final handoff must list:

- docs read;
- docs updated.

---

# 14. Source / Authority Hierarchy

When sources conflict:

```text
1. ROADMAP
   → Phase/task boundaries

2. TASK_03.3_WISHLIST.md
   → exact 03.3 behavior

3. current repository schema/API/domain/code
   → implementation truth

4. supplied Figma Make screenshots
   → approved starting visual intent

5. current ElectroHub design system
   → tokens/components/motion/responsive rules

6. current 03.1/03.2 customer implementation
   → ProductCard/Product Details/Cart/Header/Footer integration truth

7. Storybook foundation
   → isolated visual/state QA
```

Never fabricate Product/Wishlist/Review/Auth behavior merely to copy pixels.

---

# 15. Mandatory Figma Make Screenshot Inspection Before Implementation

No live Figma Design link is required for TASK 03.3.

The supplied Figma Make screenshots are the required visual evidence.

Before coding, inspect all supplied screenshots and compare them against current requirements.

Required screenshot set:

1. `product details page(1).png` — **1920 × 907**
2. `product-details-page(1).png` — **1920 × 906**
3. `Wishlist page.png` — **1920 × 906**

The agent must explicitly determine:

- what is approved;
- what already exists;
- what may be refined;
- what is stale shell context;
- what is prototype-only;
- what belongs to another task.

Do not claim `Figma inspected` without reviewing these files.

---

# 16. Screenshot 1 — Product Details Heart + Review Stars

## Source

`product details page(1).png`

Size:

```text
1920 × 907
```

Use as reference for:

- Product Details action hierarchy;
- Product title;
- existing rating stars;
- rating number;
- review count;
- current price;
- availability;
- Cart quantity area from 03.2;
- Add to Cart placement;
- Buy Now visual context only;
- heart/Wishlist action placement;
- spacing relationship between heart and Cart actions;
- tabs area where visible.

## 16.1 03.3 Approved Elements

For 03.3:

- heart action is approved;
- Wishlist saved/unsaved behavior is approved;
- rating stars presentation is approved as **existing Review data presentation**;
- current review count presentation may be visually aligned.

## 16.2 Existing / Reused

Reuse:

- existing Product Details;
- existing Product rating data;
- existing review count;
- existing Reviews API/hook;
- existing Cart quantity/Add behavior from 03.2;
- current Product availability behavior.

## 16.3 Future/Out-of-Scope Visual Context

`Buy Now` does not authorize 03.3 to implement Checkout.

Wishlist work must not change Cart/Checkout boundaries.

---

# 17. Screenshot 2 — ProductCard Heart / Related Product Cards

## Source

`product-details-page(1).png`

Size:

```text
1920 × 906
```

The screenshot shows:

- `More in Phones`;
- Product Cards;
- Product image;
- heart icon overlay near image;
- category;
- Product name;
- rating stars;
- review count;
- description;
- current/discounted price;
- Add to Cart;
- light page background.

Use this screenshot as the primary 03.3 **ProductCard heart placement/state** reference.

## 17.1 ProductCard Rules

Do not create a second ProductCard.

Extend the current approved ProductCard.

Preserve the current:

- image behavior;
- hover primary→secondary image where implemented;
- title;
- category;
- price;
- rating;
- Add to Cart;
- card navigation;
- current responsive hierarchy;
- current app design-system refinements.

Add/reuse the heart without destroying the current 03.1/03.2 ProductCard.

---

# 18. Screenshot 3 — Wishlist Page

## Source

`Wishlist page.png`

Size:

```text
1920 × 906
```

Reference for:

- breadcrumb;
- Wishlist heading;
- Wishlist item count;
- card/grid presentation;
- heart saved state;
- image;
- category;
- Product title;
- rating/review count;
- description;
- price;
- Add to Cart;
- whitespace/composition;
- desktop page hierarchy.

The screenshot shows a single Product.

03.3 must additionally design/verify:

- multiple Products;
- empty Wishlist;
- loading;
- errors;
- unavailable Product;
- out-of-stock Product;
- mobile/tablet/desktop layouts.

---

# 19. Current App Shell Wins Over Stale Screenshot Shell

Do not revert the current Header/Footer because the Make screenshots show an older shell.

Preserve current approved:

- navigation;
- auth visibility;
- profile/account treatment;
- About/Contact if current;
- Header Cart behavior;
- current Footer;
- current brand treatment;
- current shell motion;
- current responsive shell.

The screenshots define Wishlist/Product content and actions.

They do not authorize regression of newer app-shell work.

---

# 20. Prototype Overlay Exclusion

Never implement Make prototype controls visible in screenshots, including:

```text
Customer | Admin | Flows | Components
```

They are not ElectroHub product UI.

---

# 21. Figma Refinement Rule

The Make screenshots are the **first approved design reference**, not an immutable pixel prison.

Start from them.

Preserve:

- information architecture;
- hierarchy;
- heart placement intent;
- content grouping;
- card composition;
- page composition;
- ElectroHub identity.

Controlled refinement is allowed when it clearly improves:

- accessibility;
- responsiveness;
- keyboard behavior;
- touch behavior;
- guest/auth transition;
- optimistic feedback;
- loading/error states;
- multiple Wishlist items;
- empty Wishlist;
- out-of-stock/unavailable states;
- long Product names;
- current design-system consistency;
- current app shell.

Refinement is not permission to:

- ignore screenshots;
- randomly redesign;
- change unrelated ProductCard behavior;
- implement future features;
- invent another design system;
- undo current approved UI.

Use this test:

> Does this still clearly look like the approved Wishlist/Product-heart experience, but more complete, polished, accessible, responsive, and state-safe?

If yes, controlled refinement is allowed.

Document meaningful refinements in final evidence.

---

# 22. ProductCard Heart

Update the existing ProductCard.

Required states:

```text
♡
not saved

♥
saved
```

## 22.1 Add

Click unsaved heart:

```text
→ save Product
→ heart changes immediately
```

For guest:

```text
→ update guest Wishlist storage/state
```

For authenticated:

```text
→ optimistic/reactive authenticated Wishlist cache update
→ backend Add
```

## 22.2 Remove

Click saved heart:

```text
→ remove Product
→ heart changes immediately
```

On failure:

- rollback heart state;
- preserve correct Wishlist;
- show sanitized feedback where appropriate.

## 22.3 Interaction Isolation

Click ProductCard:

```text
→ Product Details
```

Click heart:

```text
→ Wishlist mutation only
→ MUST NOT navigate
```

Correctly stop card-click propagation.

The Add-to-Cart button from 03.2 must also continue to avoid Product navigation.

## 22.4 Accessibility

Accessible names:

```text
Add <Product> to wishlist
Remove <Product> from wishlist
```

Requirements:

- keyboard reachable;
- visible focus;
- pressed/saved state conveyed appropriately;
- no color-only state;
- touch target large enough.

## 22.5 Rapid Toggle

Handle:

```text
♡ → ♥ → ♡
```

rapidly without ending in stale state.

The latest user intent must win.

Do not allow slower network responses to overwrite a newer toggle.

---

# 23. Product Details Heart

Follow screenshot 1.

Product Details heart must consume the **same Wishlist feature boundary** as ProductCard and `/wishlist`.

```text
ProductCard heart
        ↕
Product Details heart
        ↕
Wishlist page
```

All must remain synchronized.

Required:

- unsaved state;
- saved state;
- Add;
- Remove;
- optimistic feedback;
- rollback;
- keyboard;
- accessible label;
- reduced-motion safe.

Do not create Product-Details-only Wishlist state.

---

# 24. Product Details Review Stars / Ratings

03.1 already owns Reviews and Ratings.

TASK 03.3 must **not** create another Review system.

Use the existing:

- average rating;
- rating display;
- review count;
- Review query/API;
- star component/presentation where current architecture provides it.

The screenshot reference shows:

```text
★★★★★  4.9 (318)
```

03.3 may refine the Product Details display to match the approved Make hierarchy where current Review data supports it.

Do not:

- invent ratings;
- hard-code review count;
- create another rating service;
- duplicate average calculations;
- add review-writing behavior solely for this task;
- fetch Reviews unnecessarily just to toggle a heart.

Wishlist mutation must not invalidate Reviews.

---

# 25. Wishlist Page Route

Implement/reuse:

```text
/wishlist
```

The route must work for:

- guest;
- authenticated customer.

Do not require login merely to view a guest Wishlist.

---

# 26. Wishlist Page — Desktop Composition

Use `Wishlist page.png` as the starting authority.

Expected hierarchy:

```text
Breadcrumb
Home > Wishlist

Wishlist                              n item(s)

Wishlist Product cards/grid
```

Use current layout/container standards.

For one Product, page should retain intentional whitespace rather than stretching the card unnaturally.

For multiple Products, use a responsive Product-card/grid composition consistent with current ElectroHub.

---

# 27. Wishlist Product Presentation

Each Wishlist Product should show current useful public Product data where supported by current ProductCard/current design:

- primary image;
- category;
- Product name;
- current rating;
- review count;
- concise description where current ProductCard supports it;
- current price;
- discount presentation if current ProductCard supports it;
- heart saved state/remove action;
- Add to Cart;
- current availability state.

Do not return full:

- Review collection;
- specifications;
- image gallery;
- private User relations;

just to render Wishlist.

Keep DTO bounded.

---

# 28. Wishlist Product Navigation

Clicking Product card/content:

```text
→ current Product Details route
```

Clicking:

- heart/remove;
- Add to Cart;

must not trigger Product navigation.

Use pointer cursor only on genuinely clickable Product/card regions.

Keyboard behavior must be unambiguous.

---

# 29. Wishlist Remove Behavior

From `/wishlist`:

```text
♥ click
→ Product removed from Wishlist
```

Preferred UX:

- optimistic immediate visual removal;
- count updates immediately;
- other cards remain interactive;
- no full-page refetch;
- no whole-page skeleton.

Failure:

- restore Product;
- restore count;
- restore heart state;
- sanitized message;
- no false success.

Do not require a confirmation modal for normal Wishlist removal.

---

# 30. Add to Cart From Wishlist

The supplied Wishlist screenshot includes `Add to Cart`.

Reuse existing 03.2 Cart behavior.

Requirements:

- Add to Cart works using current Cart feature boundary;
- guest Cart remains guest-capable;
- authenticated Cart remains server-backed;
- Add to Cart must not navigate to Product Details;
- no Wishlist refetch merely because Cart changed;
- adding to Cart does **not** automatically remove the Product from Wishlist unless current repository already has an explicit approved rule.

03.3 does not redesign Cart.

---

# 31. Empty Wishlist

Required polished state:

# **Your wishlist is empty**

Suggested copy:

> Save products you love and come back to them anytime.

Primary action:

```text
Explore Products
→ /products
```

Requirements:

- not a blank page;
- current Header/Footer remain;
- responsive;
- keyboard accessible;
- current design-system visual language;
- subtle approved motion allowed.

---

# 32. Wishlist Loading States

Use current loading philosophy.

Keep shell visible:

```text
Header
Wishlist loading content
Footer
```

## 32.1 Authenticated Initial Load

Use structural Wishlist skeletons.

Match:

- heading/count area;
- ProductCard geometry;
- image block;
- text lines;
- action area.

Do not display raw:

```text
Loading...
```

when structural skeleton is appropriate.

## 32.2 Guest Hydration

Guest IDs are local.

Hydration should begin immediately.

Do not add fake loading delays.

## 32.3 Background Refetch

If usable Wishlist data exists:

```text
background refetch
→ keep current Wishlist visible
```

Do not reset to full skeleton.

## 32.4 Mutations

Heart Add/Remove uses local/inline feedback.

Do not skeleton the page for a toggle.

---

# 33. Wishlist Error States

Handle:

- authenticated Wishlist fetch failure;
- guest hydration failure;
- malformed local storage;
- Add failure;
- Remove failure;
- reconciliation failure;
- Product unavailable;
- Product deleted/missing;
- temporary network error.

Requirements:

- sanitized message;
- retry where sensible;
- preserve recoverable Wishlist;
- no false empty state caused by error;
- no raw Prisma/SQL/stack output.

---

# 34. Product Availability in Wishlist

Wishlist does not represent purchase eligibility.

A Wishlist Product may remain saved when it becomes:

- low stock;
- out of stock;
- temporarily unavailable.

## 34.1 Out of Stock

Keep Product visible.

Show:

```text
Out of stock
```

or current design-system equivalent.

Heart/remove must still work.

Product navigation may still work if Product Details remains available.

Add to Cart must follow current 03.2 availability rules.

Do not silently remove Product solely because stock is zero.

## 34.2 Inactive / No Longer Purchasable

Where Product data remains available:

- keep a recoverable Wishlist item;
- mark unavailable;
- allow Remove.

If current Product deletion architecture physically removes Products and the relation cannot be preserved, handle missing IDs explicitly during hydration:

- do not crash;
- explain that a saved Product is no longer available if feasible;
- allow local guest cleanup;
- never fabricate Product data.

## 34.3 Price Changes

Wishlist always displays current Product price.

Guest localStorage contains no price.

Authenticated Wishlist item must not become a price snapshot.

---

# 35. Wishlist Count

Wishlist count means:

```text
number of distinct saved Products
```

There are no units/quantities.

Example:

```text
iPhone
MacBook
AirPods

Wishlist count = 3
```

The `/wishlist` page should show appropriate singular/plural:

```text
1 item
2 items
```

---

# 36. Header Wishlist Icon

If the **current approved Header already contains a Wishlist/heart control**, connect it to:

```text
/wishlist
```

Do not reintroduce an obsolete Header design solely because the screenshot contains a heart icon.

If current approved shell has no Wishlist icon and project/task requirements explicitly require a discoverable Header Wishlist entry, integrate the smallest design-system-consistent heart control without reverting newer shell work.

## 36.1 Badge

A Wishlist badge/count is **not automatically mandatory**.

Only use one when:

- current approved Header design already supports it; or
- task-relevant design documentation explicitly requires it.

If used:

```text
count = distinct Wishlist Products
```

Do not use Cart's total-unit semantics.

---

# 37. One Wishlist Feature Boundary

UI components must consume one Wishlist feature boundary.

Conceptually:

```ts
useWishlist()

items
productIds
totalItems
isWishlisted(productId)
addItem(productId)
removeItem(productId)
toggleItem(productId)
isGuest
isLoading
error
```

Exact API may follow current repository conventions.

Rules:

- ProductCard must not implement its own guest/auth storage logic;
- Product Details must not implement its own guest/auth storage logic;
- Wishlist page must not implement another source switch;
- Header must consume the same state.

Do not introduce a second global Wishlist store.

---

# 38. React Query Architecture

Authenticated Wishlist is server state.

Use the existing single QueryClient.

Use user-scoped Wishlist keys consistent with current query-key factory.

Conceptually:

```text
wishlistKeys.all
wishlistKeys.current(userId)
```

Exact implementation follows repository conventions.

## 38.1 Mutation Cache Behavior

Authenticated Add/Remove should update only relevant Wishlist cache/state.

Do not broadly invalidate:

- Products;
- Search;
- Categories;
- Brands;
- Reviews;
- Home;
- Product Details;
- Cart;

unless a specific dependency genuinely requires it.

Heart toggles must not cause the entire catalog or Product Details content to refetch.

## 38.2 Source Switch

Auth transition must not expose one User's Wishlist under another User's key.

User-scoped query identity is required.

Logout source switch must not leak authenticated Wishlist into guest state.

---

# 39. Guest Wishlist Adapter

Guest adapter responsibilities:

- read versioned localStorage;
- normalize IDs;
- deduplicate;
- bound;
- safely persist;
- expose Product IDs;
- hydrate current Product data in one bounded request;
- update immediately on Add/Remove;
- survive storage failure.

Do not store React Query server data into localStorage.

---

# 40. Suggested API Surface

Inspect current routes first.

Reuse existing routes if present.

If missing, implement the smallest REST surface consistent with current API conventions.

Conceptually:

```text
POST   /api/wishlist/validate
GET    /api/wishlist
POST   /api/wishlist/items
DELETE /api/wishlist/items/:productId
POST   /api/wishlist/reconcile
```

Exact route naming and response envelopes must follow repository standards.

Do not create duplicate Wishlist APIs.

---

# 41. Public Guest Validation Endpoint

If needed:

```text
POST /api/wishlist/validate
```

Conceptual body:

```json
{
  "productIds": [
    "product-id-1",
    "product-id-2"
  ]
}
```

Requirements:

- public;
- input validated;
- deduplicated;
- bounded;
- IDs only;
- current public Product data returned;
- no User relation;
- no private data;
- current Product status/availability represented;
- rate limit/current API safeguards reused where applicable.

Do not accept:

- client price;
- client image as truth;
- client rating as truth;
- User ID.

---

# 42. Authenticated GET Wishlist

Conceptually:

```text
GET /api/wishlist
```

Must:

- derive User from auth;
- return current customer's Wishlist only;
- return bounded Product presentation;
- preserve uniqueness;
- include current Product data required by UI;
- not expose private User fields.

---

# 43. Authenticated Add Wishlist Item

Conceptually:

```text
POST /api/wishlist/items
```

Body:

```json
{
  "productId": "..."
}
```

Rules:

- Product ID validated;
- Product existence validated;
- ownership derived from auth;
- duplicate Add remains one entry;
- idempotent semantics where consistent with API style;
- no quantity;
- no client price;
- no inventory mutation.

If Product is no longer saveable according to current Product-status policy, return a sanitized explicit response.

---

# 44. Authenticated Remove Wishlist Item

Conceptually:

```text
DELETE /api/wishlist/items/:productId
```

Rules:

- current authenticated Wishlist only;
- cannot remove another User's data;
- current API missing-item semantics reused;
- no Product mutation;
- no Inventory mutation.

---

# 45. Authenticated Reconciliation Endpoint

Conceptually:

```text
POST /api/wishlist/reconcile
```

Input:

```json
{
  "productIds": ["...", "..."]
}
```

Required semantics:

```text
server set ∪ valid guest set
```

Must be:

- transactionally safe where required;
- unique;
- retry-safe;
- idempotent;
- bounded;
- ownership-safe.

If some guest IDs are invalid/unavailable:

- handle deterministically;
- preserve valid IDs;
- report/return enough information for safe UI recovery where current API style permits;
- do not fail the entire merge unnecessarily unless transaction/domain rules require it.

Document exact behavior.

---

# 46. Backend Wishlist Service

Core business logic belongs in service layer.

Controller/route remains thin.

Service responsibilities include:

- resolve/create authenticated Wishlist structure where applicable;
- validate Product ID;
- Add;
- Remove;
- hydrate current Product presentation;
- union reconciliation;
- enforce uniqueness;
- return bounded DTO;
- sanitize errors.

Do not scatter Prisma Wishlist operations through route handlers.

---

# 47. Wishlist Response Semantics

Regardless of exact response envelope, UI needs enough current data for:

- Product ID;
- slug;
- name;
- primary image;
- category where used;
- brand where used;
- current price;
- discount presentation if supported;
- current Product status;
- current availability/out-of-stock state;
- average rating;
- review count;
- Wishlist saved state implied by presence;
- total Wishlist item count.

Do not return:

- full Review arrays;
- full Product specifications;
- all Product images;
- private User fields;
- unrelated relations.

---

# 48. Wishlist API Security

## 48.1 Ownership

Authenticated endpoints derive User from auth middleware.

Never trust:

```text
userId in body/query
```

## 48.2 Input

Validate:

- Product ID format;
- request body shape;
- collection size;
- duplicate IDs;
- Product existence/status where required.

## 48.3 Client-Controlled Product Data

Never trust frontend-provided:

- Product price;
- Product name;
- Product image;
- Product rating;
- Product availability.

## 48.4 Errors

Never expose:

- SQL;
- Prisma internals;
- stack traces;
- credentials;
- private account fields.

---

# 49. Duplicate / Concurrency Safety

Wishlist operations must remain correct when:

- user double-clicks heart;
- rapid heart toggle occurs;
- two tabs modify Wishlist;
- duplicate Add reaches backend;
- reconciliation retries;
- unique row already exists.

Use existing database uniqueness plus safe upsert/create/delete patterns.

Do not create duplicate Wishlist items.

Latest user intent should win in frontend toggle UX.

---

# 50. Multiple Browser Tabs

Where practical:

- local guest Wishlist updates should converge across tabs using current storage event patterns if the application already supports them;
- authenticated Wishlist can converge through refetch/window-focus/current React Query behavior.

Do not add complex realtime synchronization solely for 03.3.

If multi-tab guest synchronization is not implemented, document it as a non-blocking limitation unless project standards already require it.

---

# 51. Performance Requirements

Wishlist must remain lightweight.

Required:

- no N+1 Product HTTP hydration;
- no N+1 Inventory hydration;
- bounded Wishlist response;
- one bounded guest hydration request;
- no request per ProductCard merely to determine heart state;
- ProductCard heart state comes from shared Wishlist state;
- no all-catalog refetch on heart toggle;
- no Product Details refetch on heart toggle;
- no Review refetch on heart toggle;
- no Cart refetch on heart toggle;
- current images follow existing lazy-loading standards;
- background refetch keeps known Wishlist visible;
- no fake loading delay.

Do not add indexes speculatively.

Only add an index if current schema lacks necessary uniqueness/query support and evidence proves it.

---

# 52. ProductCard Responsive Integration

Adding the heart must not:

- break card height consistency;
- overlap important image content excessively;
- obscure badges;
- cause mobile overflow;
- interfere with secondary-image hover;
- interfere with Add-to-Cart;
- interfere with card navigation;
- create layout shift when heart state changes.

Verify ProductCard wherever reused:

- Home;
- Products;
- related/More-in-category;
- Wishlist page if same component is reused.

---

# 53. Product Details Responsive Integration

Heart/rating presentation must:

- remain usable at 390;
- preserve Cart controls from 03.2;
- preserve availability;
- preserve gallery;
- preserve tabs/Reviews;
- wrap actions cleanly;
- avoid horizontal overflow;
- maintain usable touch targets.

Do not regress Product Details.

---

# 54. Wishlist Responsive Requirements

Verify:

```text
390
768
1440
1920
```

## 54.1 Mobile — 390

Required:

- single-column or appropriately compact Product grid;
- useful Product image size;
- readable title/price/rating;
- heart reachable;
- Add-to-Cart reachable;
- no overflow;
- current Header/Footer usable;
- empty state centered/readable;
- skeleton mirrors mobile card geometry.

## 54.2 Tablet — 768

Use responsive grid consistent with current ProductCard conventions.

Verify:

- card width;
- spacing;
- heart;
- Add to Cart;
- count/heading;
- no clipping.

## 54.3 Desktop — 1440

Use balanced Wishlist grid/list based on current design system and screenshot intent.

Do not stretch a single card unnaturally.

## 54.4 Large Desktop — 1920

Follow screenshot spacing and content hierarchy.

Multi-item layouts should make effective use of space without over-expanding card width.

---

# 55. Accessibility

## 55.1 Heart Control

Accessible labels:

```text
Add <Product> to wishlist
Remove <Product> from wishlist
```

Use suitable pressed/state semantics where current component patterns support them.

## 55.2 Product Navigation

Card/link semantics must remain clear.

Avoid nested interactive controls that produce invalid or confusing keyboard behavior.

## 55.3 Remove

Heart/remove must be keyboard activatable.

## 55.4 Add to Cart

Existing Add-to-Cart accessibility remains intact.

## 55.5 Status

Out-of-stock/unavailable status must be visible text, not color alone.

## 55.6 Errors

Success/error feedback should use appropriate live-region behavior without excessive announcements.

## 55.7 Focus

Verify logical focus for:

- ProductCard heart;
- ProductCard link;
- Add to Cart;
- Product Details heart;
- Wishlist card heart/remove;
- Explore Products;
- retry action.

When a Wishlist Product is removed, focus should move/retain logically.

## 55.8 Reduced Motion

Respect:

```text
prefers-reduced-motion
```

Wishlist remains fully understandable without motion.

---

# 56. Motion / Advanced UX

Use the current ElectroHub motion system.

Allowed polished interactions:

- subtle heart fill transition;
- subtle heart scale/pulse;
- card removal fade/collapse after successful optimistic action;
- Wishlist count transition;
- page/card entrance consistent with existing motion;
- empty-state transition.

Rules:

- no huge bounce;
- no distracting animation;
- no layout thrash;
- no animation-triggered fetch;
- no component remount solely for motion;
- prefer transform/opacity;
- reduced-motion fallback.

Heart feedback should feel immediate.

---

# 57. Storybook — Mandatory

Storybook is the development-only isolated state/visual QA environment.

Required workflow:

```text
Make screenshot
        ↓
Storybook isolated state
        ↓
browser/Playwright screenshot
        ↓
visual comparison
        ↓
real-page integration
        ↓
E2E verification
```

Use current:

- global styles;
- deterministic fixtures;
- isolated QueryClient conventions;
- a11y addon;
- 390/768/1440/1920 viewports.

Stories must not call live APIs by default.

Do not expose Storybook through customer routes.

---

# 58. Required Storybook Coverage

Add/update **actual components only**.

## 58.1 ProductCard Wishlist States

Required:

- Not Wishlisted;
- Wishlisted;
- Add pending if visible state exists;
- Remove pending if visible state exists;
- Add failure rollback presentation where component owns it;
- Out of Stock + Wishlisted;
- Long title + heart;
- discounted Product if already supported.

## 58.2 WishlistButton / Heart Component

If a dedicated reusable component is created, stories:

- unsaved;
- saved;
- loading/pending;
- disabled only when genuinely required;
- focus-visible;
- reduced motion.

Do not create a component solely to satisfy Storybook if architecture does not need one.

## 58.3 Product Details Wishlist Action

Required:

- unsaved;
- saved;
- optimistic Add;
- optimistic Remove;
- out-of-stock Product still wishlisted;
- rating/review presentation alongside heart.

## 58.4 Wishlist Product/Card

If Wishlist uses ProductCard, reuse ProductCard stories.

If it uses a Wishlist-specific wrapper, cover:

- available;
- out of stock;
- unavailable;
- long title;
- Add to Cart;
- Remove.

## 58.5 Wishlist Page

Required:

- Guest one item;
- Authenticated one item;
- multiple items;
- Empty;
- Loading;
- Error/retry;
- Out-of-stock item;
- Unavailable item;
- Merge/reconciliation error where page owns it.

## 58.6 Responsive Storybook

Verify relevant page/card stories at:

- 390;
- 768;
- 1440;
- 1920.

## 58.7 Header Wishlist Entry

Only if current Header includes Wishlist UI and component isolation is useful:

- navigation state;
- optional count if current design supports count.

Header badge stories are not mandatory if there is no approved Wishlist badge.

---

# 59. Storybook Fixture Rules

Use deterministic fixtures matching current DTOs.

Do not fabricate unsupported:

- price alerts;
- notification settings;
- Wishlist folders;
- share permissions;
- fake Review data shapes;
- Checkout state.

No live API by default.

---

# 60. Visual Comparison Workflow

For each screenshot:

```text
source Make screenshot
        ↓
initial implementation
        ↓
Storybook/real route at equivalent viewport
        ↓
browser screenshot
        ↓
manual side-by-side comparison
        ↓
controlled refinement
        ↓
final evidence
```

Do not hide obvious mismatch with huge screenshot-diff tolerance.

---

# 61. Screenshot Evidence Matrix

Final report must include one row per supplied screenshot.

## 61.1 `product details page(1).png`

Source:

```text
1920 × 907
```

Verify:

- Product Details heart;
- saved/unsaved placement;
- rating stars;
- review count;
- relationship to Add-to-Cart/Buy-Now visual region;
- current app shell preserved.

Result:

```text
PASS
PASS WITH DOCUMENTED REFINEMENT
FAIL
```

## 61.2 `product-details-page(1).png`

Source:

```text
1920 × 906
```

Verify:

- ProductCard heart placement;
- card hierarchy;
- stars/review count;
- Add to Cart;
- current card refinements preserved.

## 61.3 `Wishlist page.png`

Source:

```text
1920 × 906
```

Verify:

- breadcrumb;
- title;
- count;
- card;
- saved heart;
- Product metadata;
- price;
- Add to Cart;
- whitespace/hierarchy;
- current shell preserved.

Do not report vague:

```text
Figma checked
```

Record exact differences.

---

# 62. Additional Required Screens / States Not Shown in Make

Design using current ElectroHub system:

- multi-item Wishlist;
- Empty Wishlist;
- guest Wishlist;
- authenticated Wishlist;
- loading skeleton;
- fetch error/retry;
- Add failure rollback;
- Remove failure rollback;
- merge error/retry;
- out-of-stock item;
- inactive/unavailable item;
- long Product title;
- mobile Wishlist;
- tablet Wishlist;
- 1440 Wishlist;
- 1920 Wishlist;
- ProductCard saved/unsaved;
- Product Details saved/unsaved;
- rapid toggle latest-intent state.

These are controlled completion states, not random redesign.

---

# 63. Backend Unit / Service Tests

At minimum verify:

1. resolve/create current authenticated Wishlist structure where needed;
2. Add first Product;
3. duplicate Add does not duplicate;
4. remove existing Product;
5. remove missing Product follows current API semantics;
6. Product ID validation;
7. current User ownership;
8. cannot access another User's Wishlist;
9. Product current data returned;
10. current price returned;
11. rating/review count presentation data returned where current DTO supports it;
12. out-of-stock Product remains in existing Wishlist;
13. no inventory decrement;
14. no Cart mutation;
15. union reconciliation;
16. duplicate Product guest+server results in one item;
17. reconciliation is retry-safe/idempotent;
18. invalid guest Product IDs handled deterministically;
19. bounded reconcile input;
20. no private User data in response.

If a database uniqueness constraint exists, exercise duplicate safety.

---

# 64. API / Integration Tests

Verify current route conventions for:

- guest validation/hydration;
- GET Wishlist;
- Add;
- Remove;
- reconciliation.

Also verify:

- authenticated routes require auth;
- CUSTOMER role rules if current API applies role authorization;
- public validation route remains public if implemented;
- input validation;
- bounded arrays;
- duplicate ID normalization;
- sanitized error envelope;
- Product status semantics;
- current Product fields;
- no private User data;
- no arbitrary userId authority.

---

# 65. Frontend Tests

Verify:

- guest storage empty state;
- guest storage malformed JSON;
- duplicate IDs normalization;
- guest Add;
- guest Remove;
- guest refresh persistence;
- ProductCard saved state;
- ProductCard heart does not navigate;
- card click still navigates;
- Product Details saved state;
- Product Details heart synchronization;
- `/wishlist` renders guest items;
- `/wishlist` authenticated query;
- optimistic Add;
- optimistic Remove;
- rollback on Add failure;
- rollback on Remove failure;
- Wishlist count;
- current Product data hydration;
- out-of-stock remains visible;
- unavailable remains removable where supported;
- background refetch preserves visible Wishlist;
- login reconciliation;
- union merge;
- merge retry safety;
- guest storage clears after success only;
- merge failure preserves guest storage;
- logout source isolation;
- relogin restores server Wishlist;
- Add to Cart from Wishlist does not navigate/remove Wishlist unless explicitly intended.

---

# 66. Playwright / Browser E2E Matrix

Use existing Playwright/browser tooling.

Required focused scenarios:

## A — Guest Add From ProductCard

```text
guest
→ ProductCard
→ click heart
→ heart saved
→ no Product Details navigation
```

## B — Guest Remove From ProductCard

```text
saved Product
→ click heart
→ removed
→ card remains
```

## C — Guest Persistence

```text
save Product
→ refresh
→ heart remains saved
→ /wishlist contains Product
```

## D — ProductCard Navigation Isolation

```text
heart click
→ no navigation

card/image/name click
→ Product Details
```

## E — Product Details Toggle

```text
Product Details
→ save heart
→ state updates
→ return/list ProductCard state agrees
```

## F — Wishlist Page

```text
/wishlist
→ saved Products render
→ current data displayed
```

## G — Product Navigation From Wishlist

```text
click Wishlist Product content
→ Product Details
```

Heart/remove and Add-to-Cart must not navigate.

## H — Remove From Wishlist Page

```text
remove
→ Product disappears immediately
→ count updates
```

## I — Empty Wishlist

```text
remove last Product
→ Empty state
→ Explore Products works
```

## J — Add to Cart From Wishlist

Reuse current Cart behavior.

Verify Wishlist remains intact unless current explicit rule says otherwise.

## K — Out-of-Stock Wishlist Product

```text
saved Product
→ current stock 0
→ remains visible
→ Out of stock shown
→ Remove works
```

## L — Guest → Authenticated Union Merge

```text
server Wishlist = A, B
guest Wishlist = B, C
login
→ authenticated Wishlist = A, B, C
```

No duplicate B.

## M — Merge Retry

Repeat same reconciliation.

Result stays:

```text
A, B, C
```

## N — Merge Failure

Force reconciliation failure:

- guest storage remains;
- server Wishlist preserved;
- retry available;
- no false success.

## O — Authenticated Persistence

```text
authenticated Wishlist
→ refresh
→ saved Products remain
```

## P — Logout Isolation

```text
authenticated Wishlist
→ logout
→ server Wishlist not copied into guest storage
→ login same account
→ server Wishlist restored
```

## Q — Add/Remove Failure Rollback

Force API Add/Remove errors.

Verify heart/card state rolls back correctly.

## R — Responsive

Verify:

- 390;
- 768;
- 1440;
- 1920.

Not only overflow.

Check layout/card readability/action reachability.

## S — Keyboard

Complete key interactions without mouse:

- ProductCard heart;
- Product link;
- Product Details heart;
- Wishlist remove;
- Explore Products;
- Add to Cart where relevant.

## T — Reduced Motion

Wishlist remains usable with:

```text
prefers-reduced-motion: reduce
```

---

# 67. Manual QA

Automated tests do not replace manual verification.

Manually verify:

- heart feel;
- optimistic Add;
- optimistic Remove;
- ProductCard navigation isolation;
- Product Details synchronization;
- guest refresh;
- authenticated refresh;
- login merge;
- logout isolation;
- Wishlist page visual balance;
- multiple Products;
- mobile;
- tablet;
- out-of-stock;
- keyboard;
- focus after removal;
- rating/star presentation.

---

# 68. Accessibility Review Checklist

Verify:

- [ ] ProductCard heart keyboard reachable
- [ ] heart label identifies Product/action
- [ ] saved state perceivable without color alone
- [ ] ProductCard click and heart do not conflict
- [ ] Product Details heart labeled
- [ ] Wishlist remove labeled
- [ ] Add-to-Cart remains labeled
- [ ] visible focus
- [ ] focus remains logical after removal
- [ ] success/error feedback accessible
- [ ] out-of-stock text visible
- [ ] no tooltip-only critical information
- [ ] touch targets usable
- [ ] reduced motion supported
- [ ] no horizontal overflow

---

# 69. Performance Review Checklist

Verify:

- [ ] no Product N+1 guest hydration
- [ ] no Inventory N+1 hydration
- [ ] no all-catalog fetch for Wishlist
- [ ] authenticated Wishlist response bounded
- [ ] guest validation bounded
- [ ] ProductCard heart uses shared state
- [ ] no catalog refetch on heart
- [ ] no Product Details refetch on heart
- [ ] no Review refetch on heart
- [ ] no Cart refetch on heart
- [ ] background refetch preserves visible Wishlist
- [ ] no fake loading delay
- [ ] no heavy dependency added without justification

---

# 70. Security Review Checklist

Verify:

- [ ] Wishlist ownership from auth
- [ ] no arbitrary userId authority
- [ ] Product IDs validated
- [ ] guest localStorage untrusted
- [ ] public validation bounded
- [ ] no private User data
- [ ] no cross-user Wishlist access
- [ ] uniqueness enforced
- [ ] reconciliation idempotent
- [ ] errors sanitized
- [ ] no sensitive guest storage
- [ ] no inventory mutation
- [ ] no Product mutation

---

# 71. Database / Migration Review

Expected result:

```text
Product      reused
User         reused
Wishlist     reused if present
WishlistItem reused if present

new migration:
probably NONE
```

If the repository uses a different valid Wishlist schema, follow repository truth.

If a legitimate migration is created:

- review exact SQL;
- no data loss;
- no unrelated tables;
- no quantity/Checkout fields;
- apply only through approved migration workflow;
- verify migration ledger;
- never seed PROD.

---

# 72. DEV / PROD Rules

Expected:

```text
migration:
NO

seed:
NO
```

Normal DEV application/API testing may create customer Wishlist rows through the app/API.

Do not seed real customer Wishlist contents.

Do not seed PROD.

If no migration exists:

- no live migration operation is required.

If implementation agent lacks live DB access:

- do not claim live ledger verification;
- prepare a precise DB handoff if the project workflow requires one.

---

# 73. Styling Rules

Reuse existing:

- typography;
- spacing;
- ProductCard;
- buttons;
- icons;
- borders/radius;
- colors;
- responsive containers;
- focus states;
- motion primitives.

Do not create parallel global styles.

Where current project uses rectangular/square surfaces, do not introduce arbitrary new rounding just because old Make reference differs.

Semantic heart/icon buttons may use the current icon-control shape.

---

# 74. Icons

Use current project icon strategy.

Expected:

- heart outline;
- heart filled/saved;
- optional warning/unavailable;
- Cart icon from existing 03.2;
- navigation icons already in shell.

Do not add another icon library.

Icon-only heart requires accessible label.

---

# 75. Error / Empty / Edge Cases

Explicitly handle:

## Guest

- no storage;
- malformed storage;
- duplicated Product IDs;
- excessive IDs;
- localStorage unavailable;
- Product missing;
- Product inactive;
- Product out of stock;
- Product price changed;
- rapid Add/Remove toggle.

## Authenticated

- no Wishlist row yet;
- empty Wishlist;
- Wishlist fetch failure;
- duplicate Add;
- concurrent Add;
- remove failure;
- reconciliation failure;
- session refresh;
- logout;
- login with guest Wishlist;
- login with server Wishlist;
- login with both.

## Product UI

- long Product name;
- one image;
- broken image fallback;
- no Reviews;
- out of stock;
- inactive Product;
- discount;
- rating/review count.

## Wishlist UI

- one item;
- many items;
- very large saved count;
- last item removed;
- background refetch error;
- merge error;
- optimistic rollback.

---

# 76. No Random Bug Hunting

TASK 03.3 is already broad.

If unrelated defect is observed:

```text
OUT-OF-SCOPE OBSERVATION
→ record it
→ do not fix it
```

Only fix an apparently unrelated issue when:

- it directly blocks 03.3;
- the smallest safe fix is necessary;
- evidence is documented.

Do not use 03.3 for:

- general Cart cleanup;
- Search redesign;
- Home redesign;
- Reviews refactor;
- Account redesign;
- random CSS cleanup.

---

# 77. Recommended Implementation Order

1. Read AGENTS/task/relevant docs.
2. Inspect all three Make screenshots.
3. Produce approved/reused/refinement/out-of-scope matrix.
4. Inspect current Wishlist schema/migrations.
5. Inspect Auth lifecycle.
6. Inspect Product/current public DTOs.
7. Inspect ProductCard.
8. Inspect Product Details + current ratings/Reviews.
9. Inspect Header Wishlist entry if present.
10. Inspect current Cart action reuse for Wishlist page.
11. Define one Wishlist feature boundary.
12. Implement backend Wishlist service/API if missing.
13. Implement bounded guest Product hydration if needed.
14. Implement guest local persistence.
15. Implement authenticated Wishlist query/mutations.
16. Implement union reconciliation.
17. Integrate ProductCard heart.
18. Integrate Product Details heart/rating layout.
19. Implement `/wishlist`.
20. Implement empty/loading/error/unavailable states.
21. Integrate Header route where appropriate.
22. Complete responsive behavior.
23. Complete accessibility/motion.
24. Add/update Storybook stories.
25. Run backend tests.
26. Run frontend tests.
27. Run integration tests.
28. Run focused Playwright matrix.
29. Capture screenshot evidence.
30. Perform manual visual/keyboard/responsive QA.
31. Update affected docs.
32. Run final validation.
33. Produce implementation report.
34. Stop before commit/push/merge unless explicitly instructed.

---

# 78. Required Validation Commands

Use current repository scripts.

Expected categories:

- Prisma validate if schema touched;
- Prisma generate if schema/client requires it;
- backend typecheck;
- backend lint;
- backend build;
- frontend typecheck;
- frontend lint;
- frontend build;
- focused Wishlist backend tests;
- focused Wishlist frontend tests;
- Wishlist API/integration tests;
- Storybook build;
- Storybook a11y review;
- focused Wishlist Playwright/E2E;
- real localhost manual verification;
- `git diff --check`.

Do not invent commands that do not exist.

Do not invent PASS evidence.

If environment prevents execution, report exact reason.

---

# 79. Storybook Production Isolation

Storybook remains development-only.

03.3 must not:

- import Storybook into production app entry;
- expose Storybook via customer route;
- ship Storybook static output as customer application content;
- depend on Storybook fixtures at runtime.

---

# 80. Documentation Updates

Update only docs materially affected by shipped implementation.

Likely:

- Wishlist feature documentation;
- Wishlist API documentation;
- Product/ProductCard docs if heart action is documented;
- Product Details UI docs;
- state/query-key docs;
- Authentication docs if Wishlist reconciliation behavior is documented there;
- database docs only if schema changes;
- testing/E2E docs;
- Storybook docs where states are added;
- accessibility notes;
- performance notes;
- roadmap/task completion status;
- TASK 03.3 implementation report.

Docs must describe actual shipped behavior.

---

# 81. Definition of Done — Functional

- [ ] guest can Add from ProductCard heart
- [ ] guest can Remove from ProductCard heart
- [ ] guest can Add/Remove from Product Details
- [ ] guest Wishlist persists refresh
- [ ] guest `/wishlist` works
- [ ] authenticated Wishlist persists
- [ ] duplicate Product does not create duplicate entry
- [ ] Wishlist Product navigates to Product Details
- [ ] heart does not navigate
- [ ] Add-to-Cart does not navigate
- [ ] guest/server union reconciliation works
- [ ] duplicate guest/server Product appears once
- [ ] reconciliation retry safe
- [ ] guest storage clears only after merge success
- [ ] merge failure preserves guest storage
- [ ] logout does not leak server Wishlist
- [ ] relogin restores server Wishlist
- [ ] current Product price used
- [ ] out-of-stock Product remains saved/visible
- [ ] no inventory decrement/reservation
- [ ] Empty Wishlist implemented

---

# 82. Definition of Done — UI / Make

- [ ] all three Make screenshots inspected before implementation
- [ ] Product Details heart follows screenshot intent
- [ ] Product Details stars/review count follows existing real Review data
- [ ] ProductCard heart follows screenshot intent
- [ ] Wishlist page follows screenshot hierarchy
- [ ] current Header/Footer not regressed
- [ ] ProductCard current design preserved
- [ ] one-item Wishlist polished
- [ ] multi-item Wishlist polished
- [ ] Empty Wishlist polished
- [ ] out-of-stock/unavailable states polished
- [ ] loading/error states polished
- [ ] 390 verified
- [ ] 768 verified
- [ ] 1440 verified
- [ ] 1920 verified
- [ ] no horizontal overflow
- [ ] prototype overlay absent
- [ ] controlled refinements documented

---

# 83. Definition of Done — Storybook

- [ ] ProductCard saved/unsaved states
- [ ] ProductCard pending/rollback where applicable
- [ ] heart component states if dedicated component exists
- [ ] Product Details heart states
- [ ] rating presentation state
- [ ] Wishlist page one item
- [ ] Wishlist page multiple items
- [ ] Empty Wishlist
- [ ] loading
- [ ] error
- [ ] out-of-stock
- [ ] unavailable
- [ ] deterministic fixtures
- [ ] no default live API
- [ ] a11y addon reviewed
- [ ] reduced-motion behavior checked
- [ ] Storybook production isolation preserved

---

# 84. Definition of Done — Testing

- [ ] backend service tests
- [ ] API tests
- [ ] duplicate Add test
- [ ] ownership/security tests
- [ ] guest storage tests
- [ ] guest hydration tests
- [ ] union reconciliation tests
- [ ] reconciliation retry test
- [ ] frontend Wishlist tests
- [ ] ProductCard heart tests
- [ ] Product Details heart tests
- [ ] Wishlist page tests
- [ ] optimistic rollback tests
- [ ] logout isolation test
- [ ] focused Playwright matrix
- [ ] manual localhost verification
- [ ] `git diff --check`

---

# 85. Definition of Done — Security / Integrity

- [ ] no cross-user Wishlist access
- [ ] no client userId authority
- [ ] no duplicate Product entry
- [ ] guest storage contains Product IDs only
- [ ] no sensitive guest storage
- [ ] Product data hydrated from authority
- [ ] reconciliation idempotent
- [ ] errors sanitized
- [ ] no inventory mutation
- [ ] no Product mutation
- [ ] no Review duplication

---

# 86. Rejection Criteria

TASK 03.3 must be rejected if any remain:

- guest forced to login merely to Wishlist a Product;
- guest Wishlist lost on refresh;
- authenticated Wishlist lost on refresh;
- duplicate entries for same Product;
- guest Wishlist replaces server Wishlist on login;
- server Wishlist replaces guest Wishlist on login;
- reconciliation duplicates items on retry;
- guest storage cleared before confirmed merge;
- merge failure silently loses guest Wishlist;
- ProductCard heart navigates to Product Details;
- Wishlist remove navigates unintentionally;
- client/localStorage Product price treated as authority;
- out-of-stock Product silently removed only because stock reached zero;
- Wishlist Add/Remove causes full catalog refetch;
- heart mutation causes Product Details/Reviews refetch;
- cross-user access possible;
- logout leaks server Wishlist into guest storage;
- current Header/Footer regressed to stale screenshot shell;
- new Review system created;
- Cart/Checkout/Payment scope expanded;
- Storybook-only behavior differs from integrated app;
- no real-page integration evidence;
- fake loading delays;
- raw backend errors exposed;
- mobile horizontal overflow.

---

# 87. Final Implementation Handoff Format

Final implementation report must include:

```text
# TASK 03.3 — WISHLIST IMPLEMENTATION REPORT

BRANCH:
feature/Wishlist

STATUS:
COMPLETE / PARTIAL / BLOCKED

DOCS READ:
- ...

DOCS UPDATED:
- ...

MAKE SOURCES:
- product details page(1).png — 1920x907
- product-details-page(1).png — 1920x906
- Wishlist page.png — 1920x906

FIGMA/MAKE CLASSIFICATION:
Approved/in scope:
- ...

Existing/reused:
- ...

Controlled refinements:
- ...

Future/out of scope:
- ...

ARCHITECTURE:

Guest Wishlist:
<implementation>

Authenticated Wishlist:
<implementation>

Wishlist feature boundary:
<implementation>

Guest/Auth reconciliation:
SET UNION
<implementation + retry/idempotency evidence>

DATABASE:

Existing Wishlist schema reused:
YES / NO

Schema changed:
NO / YES — details

Migration required:
NO / YES — details

Seed required:
NO / YES — details

API:

Guest validation:
PASS / N/A

GET Wishlist:
PASS / FAIL

Add:
PASS / FAIL

Remove:
PASS / FAIL

Reconcile:
PASS / FAIL

GUEST WISHLIST:

Add:
PASS / FAIL

Remove:
PASS / FAIL

Persistence:
PASS / FAIL

Refresh:
PASS / FAIL

Malformed storage:
PASS / FAIL

AUTH WISHLIST:

Persistence:
PASS / FAIL

Ownership:
PASS / FAIL

Refresh:
PASS / FAIL

Cross-user isolation:
PASS / FAIL

RECONCILIATION:

Server items preserved:
PASS / FAIL

Guest items preserved:
PASS / FAIL

Union:
PASS / FAIL

Duplicates:
0 / count

Retry idempotent:
PASS / FAIL

Guest storage cleared only after success:
PASS / FAIL

PRODUCTCARD:

Heart Add:
PASS / FAIL

Heart Remove:
PASS / FAIL

Heart does not navigate:
PASS / FAIL

Card navigation:
PASS / FAIL

Rapid toggle:
PASS / FAIL

PRODUCT DETAILS:

Heart Add:
PASS / FAIL

Heart Remove:
PASS / FAIL

Heart synchronization:
PASS / FAIL

Rating stars/review count:
PASS / FAIL

No duplicate Review architecture:
YES / NO

WISHLIST PAGE:

One item:
PASS / FAIL

Multiple items:
PASS / FAIL

Remove:
PASS / FAIL

Product navigation:
PASS / FAIL

Add to Cart:
PASS / FAIL

Empty:
PASS / FAIL

Loading:
PASS / FAIL

Error:
PASS / FAIL

Out of stock:
PASS / FAIL

Unavailable:
PASS / FAIL

CURRENT PRODUCT DATA:

Price:
PASS / FAIL

Availability:
PASS / FAIL

Rating/review count:
PASS / FAIL

HEADER:

Wishlist entry:
PASS / N/A / FAIL

Wishlist count:
PASS / N/A / FAIL

RESPONSIVE:

390:
PASS / FAIL

768:
PASS / FAIL

1440:
PASS / FAIL

1920:
PASS / FAIL

ACCESSIBILITY:
PASS / FAIL

REDUCED MOTION:
PASS / FAIL

STORYBOOK:
PASS / FAIL

Stories:
<count/list>

A11y:
PASS / FAIL

BACKEND TESTS:
PASS / FAIL — count

FRONTEND TESTS:
PASS / FAIL — count

API/INTEGRATION TESTS:
PASS / FAIL — count

PLAYWRIGHT:
PASS / FAIL — count

TYPECHECK:
Backend PASS / FAIL
Frontend PASS / FAIL

LINT:
Backend PASS / FAIL
Frontend PASS / FAIL

BUILD:
Backend PASS / FAIL
Frontend PASS / FAIL

git diff --check:
PASS / FAIL

MAKE EVIDENCE:

product details page(1).png:
PASS / PASS WITH REFINEMENT / FAIL

product-details-page(1).png:
PASS / PASS WITH REFINEMENT / FAIL

Wishlist page.png:
PASS / PASS WITH REFINEMENT / FAIL

FIGMA/MAKE REFINEMENTS:
NONE
OR
- element / source / change / reason / result

OUT-OF-SCOPE OBSERVATIONS:
NONE
OR
- ...

REMAINING BLOCKERS:
NONE
OR
- ...

READY FOR ARCHITECT REVIEW:
YES / NO
```

---

# 88. DB Operation Handoff If Required

If no schema change:

```text
# TASK 03.3 — DATABASE OPERATION HANDOFF

SCHEMA CHANGED:
NO

MIGRATION REQUIRED:
NO

DEV SEED CODE CHANGED:
NO

DEV SEED REQUIRED:
NO

PROD SEED:
FORBIDDEN

LIVE DEV/PROD VERIFIED BY IMPLEMENTATION AGENT:
NO unless actually verified through authorized tooling
```

If a legitimate migration exists, include exact migration path and safety details.

Do not claim live database verification without evidence.

---

# 89. Final Architecture Principles

> **Wishlist is a set of unique Products, never a quantity list.**

> **Guests can Wishlist Products without authentication.**

> **Guest storage contains Product IDs only.**

> **Authenticated Wishlist is server-backed and ownership comes from auth.**

> **Guest + authenticated Wishlist reconciliation is SET UNION.**

> **Union never replaces either source and never creates duplicates.**

> **Guest localStorage is cleared only after confirmed successful merge.**

> **Logout never copies a server Wishlist into guest storage.**

> **ProductCard, Product Details, Wishlist page, and Header consume one Wishlist feature boundary.**

> **Current Product price, status, imagery, availability, rating, and review count come from authoritative Product/Review data—not guest storage.**

> **Out-of-stock Products may remain wishlisted.**

> **Wishlist does not reserve or decrement inventory.**

> **03.3 reuses the existing Review system; it does not implement Reviews again.**

> **03.3 reuses the existing Cart behavior; it does not redesign Cart.**

> **Make screenshots define the starting visual direction; controlled documented refinements complete missing real-world states.**

> **Current app-shell decisions override stale Header/Footer details in screenshots.**

> **Storybook proves isolated states; browser/Playwright proves integrated behavior.**

---

# 90. Stop Conditions

Stop and report instead of improvising if:

- current Wishlist schema materially conflicts with documented foundation;
- authenticated Wishlist ownership cannot be established safely;
- a migration would require destructive User/Product changes;
- current Product deletion policy makes Wishlist preservation impossible and requires broader domain redesign;
- supplied screenshots are unavailable and exact visual comparison is required;
- Auth transition cannot support safe union reconciliation without unrelated architecture change;
- environment prevents required verification.

Do not solve blockers by expanding into:

- Checkout;
- Payment;
- Inventory reservation;
- Orders;
- Notifications;
- Review redesign.

---

# 91. Completion Gate

TASK 03.3 may be submitted for architect review only when:

```text
GUEST WISHLIST
        +
AUTHENTICATED WISHLIST
        +
SET-UNION RECONCILIATION
        +
UNIQUE PRODUCT INTEGRITY
        +
PRODUCTCARD HEART
        +
PRODUCT DETAILS HEART
        +
EXISTING REVIEW STARS
        +
WISHLIST PAGE
        +
PRODUCT NAVIGATION
        +
ADD-TO-CART REUSE
        +
CURRENT PRODUCT HYDRATION
        +
EMPTY/LOADING/ERROR STATES
        +
OUT-OF-STOCK HANDLING
        +
RESPONSIVE
        +
ACCESSIBILITY
        +
STORYBOOK
        +
AUTOMATED TESTS
        +
PLAYWRIGHT
        +
MANUAL QA
        +
MAKE SCREENSHOT EVIDENCE
        +
DOCS
        =
READY FOR ARCHITECT REVIEW
```

No self-approval.

Do not commit, push, or merge unless explicitly instructed by the project owner.
