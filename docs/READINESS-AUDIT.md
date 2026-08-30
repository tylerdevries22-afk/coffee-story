# Readiness audit — all five surfaces + HQ

Produced 2026-08-23 on `claude/kiosk-ui-checkout-redesign-694fee` by a fan-out of
seven independent auditors (kiosk completeness, cross-app synchronisation,
backend production readiness, franchise scalability, design tokens,
originality/docs, testing/CI), each finding then adversarially verified against
the tree by a separate reader, plus two completeness sweeps. 56 findings were
audited, 51 survived verification, and the sweeps added 38 more.

Competitor names quoted as evidence are redacted here as `<a competitor name>`:
this file lives in the tree, and CLAUDE.md rule 6 covers documentation too.

Every claim below names a file. Where a claim was checked and found FALSE it was
dropped rather than softened, so the absence of a concern is meaningful.

---

## Status as of 2026-08-30

This file is a dated snapshot, not a live checklist. The tree has moved since it
was written; what follows is what a re-read of the current tree found, with the
evidence for each. Everything not listed here still stands as written below.

**Closed since 2026-08-23** — each verified by grep against the tree, not by
recollection:

| Finding | Evidence it is closed |
|---|---|
| `TAX_JURISDICTIONS` / `COMBINED_TAX_RATE` hardcoded one state's authorities in `packages/domain` | Both constants are gone; the only mentions left are comments recording why. Tax reads `tenants/<slug>/brand.json` `tax.jurisdictions` through `TENANT_TAX_JURISDICTIONS`. |
| `PICKUP_LOCATIONS` hardcoded one shop's address | Constant gone; `resolvePickupLocations(config)` reads the tenant's own `location`/`locations`, covered by `fulfillment.test.ts`. |
| `INFORMATION_PAGES` shipped one shop's copy | `information-pages.ts` derives its pages from `brand.json`; the tenant proper nouns that remain are in comments explaining what was removed. |
| `MenuCategoryId` typed one shop's seven categories, so another tenant's menu would not typecheck | Gone from `menu-options.ts`; the shop's vocabulary now lives in `menu-options.fixture.ts`, which is not exported from the package and is imported only by tests. |
| `REWARD_TIERS` shipped one shop's ladder on the live checkout | The ladder is tenant data: `loyalty.tiers` in `brand.json`, read by `resolveRewardTiers`. The shipped fallback names no trade, and `rules.test.ts` fails if it starts to. |
| The order channel was inferred rather than recorded | `resolveOrderChannel` at `apps/hq/app/api/orders/route.ts:11`, tested in `order-channel.test.ts`. |
| The display fell back to an anonymous "Live" read | Gone; the board reads with the server-held device token. |
| No in-app account deletion, and no privacy policy in the tree | `apps/customer/src/screens/client/more/profile-and-preferences.tsx` and `docs/legal/privacy-policy.md`. |
| An unused `@stripe/stripe-react-native` dependency in the customer app | Not in `apps/customer/package.json`. |

**Closed 2026-08-30, and it was not the finding it looked like.** Chasing the
currency literal is what surfaced the worst defect in this pass:

- **Connecting Square never bound a Square location.** `square_connections`
  carries `square_location_id`; `squareRuntimeFor` returns `null` without it,
  and every card order then answers `503 tender_unavailable`. Nothing in the
  application ever wrote that column -- the only `INSERT` naming it in the whole
  repository was an integration test's own fixture. So an owner finished Square
  consent, the callback stored the tokens and set `locations.square_connection_id`,
  and the console drew **Connected** and *removed* the Connect Square button
  behind that same back-pointer. The shop could not take a card and could not
  retry. Fixed in `apps/hq/app/api/square/callback/route.ts`: the callback now
  reads the merchant's locations (`listSquareLocations`), binds one, and writes
  nothing at all if it cannot -- so a failed re-connect leaves a working
  connection alone, and the back-pointer is set last, once "Connected" is true.
- **Currency, consequently, is asserted rather than threaded.** The 8 `'USD'`
  literals are now one exported `PLATFORM_CURRENCY`, checked against the
  merchant's own Square location at connect time (`chooseSquareLocation`). A
  merchant settling in another currency is refused there, in one message, rather
  than at a guest's first checkout. Threading a currency code instead would have
  been decoration: tax is modelled as US jurisdictions, delivery validates a
  two-letter state and a ZIP, and `formatMoney` prints a bare `$`. That would
  take a foreign shop's money into a system that still could not serve it.
- **Square access tokens were never refreshed.** `refreshOAuthToken` was
  exported with zero callers and `square_connections.expires_at` was written by
  the callback and read by nothing -- `squareRuntimeFor` selected only
  `square_location_id, access_token_encrypted`. Square access tokens last thirty
  days, so every connected shop would have stopped taking cards a month after
  connecting, on a 401 nothing in the product explained. Renewal now happens in
  `squareRuntimeFor`, the one chokepoint every money path already crosses,
  rather than on a schedule: a cron that quietly stops running is the same
  failure this was. A token inside the seven-day margin still takes the sale if
  the renewal fails; an expired one is refused rather than sent to Square as if
  it were money. `apps/hq/lib/square-runtime.test.ts` is the first test this
  module has had.
- **D4, the fourth tender vocabulary, is gone.** Three of the four now agree by
  construction -- `contract.ts` imports `@platform/schema`'s `OrderTenderType`,
  and `kiosk-flow.ts` maps `KioskTender` onto it through `settlementFor`, which
  is total or a type error. The fourth,
  `apps/operator/src/features/staff/payment-availability.ts`, was imported by
  nothing but its own test and has been removed, which closes D4 and task 0.1.
- **Four dead modules removed, two of them carrying one shop's money.**
  `pos-totals.ts` (190 lines) was a till register imported by nothing but its
  own test, holding `DISCOUNT_CODE_CENTS = 1500`, `MEMBERSHIP_CREDIT_CENTS =
  2500`, a fixed add-on list and fixed gift amounts as module constants -- the
  same defect as the loyalty ladder, waiting for whoever built the till screen
  to import it. `apps/customer/src/features/intake-forms.ts` was a
  byte-identical copy of the operator's admin agreements catalog, imported by
  nothing, shipping operator copy inside the guest binary against rule 7. Its
  surviving counterpart's doc comment claimed an `intake_forms` table, a
  seeding migration and a catalog test, none of which exist; it now says what
  is actually true.

- **The earn rate was a constant in a migration, so every brand paid the first
  tenant's rate.** `app.apply_order_event_side_effects` credited
  `target.subtotal_cents / 10` -- ten points per dollar, for every guest, at
  every brand, whatever ladder that brand published. 20260722000035 had written
  down what the figure means in its own words ("the earn RATE, which is an
  entitlement") and supplied `app.annual_points_for` to read it; nothing on the
  earn path ever called it. Meanwhile `pointsForPurchase` in `packages/domain`
  reads the rung the guest is standing on, and the customer app promises that
  number in seven places. On Coffee Story's own published ladder a Daily Ritual
  regular is told 11 points per dollar and paid 10; a Coffee Legend is told 13.
  The guest sees the shortfall in their balance and the shop cannot explain it.
  Fixed in `supabase/migrations/20260830010000_tenant_earn_rate.sql`:
  `app.loyalty_earn_rate_for(account, brand)` reads `brand_config.loyalty.tiers`
  with the same all-or-nothing rule as `rewardTiersFrom` -- every rung parses
  and some rung sits at 0, or the ladder is ignored whole rather than
  half-applied -- and the trigger multiplies by what it returns. Three new
  assertions in `tests/consistency/src/one-rule-two-languages.test.ts` compare
  the SQL against `REWARD_TIERS`; each was mutation-checked (change a fallback
  rate, rename a JSON key, restore the constant) and each mutation failed
  exactly its own test.

**Open, and each one is the owner's call rather than a defect to fix:**

- **This migration changes payouts, and should not be described as inert.** The
  ledger's fallback is now the generic four-rung ladder a tenant inherits by
  leaving `loyalty.tiers` empty -- the one `tenants/_template/brand.json`
  documents and `REWARD_TIERS` ships -- rather than the flat 10 the constant
  gave. A guest with 500 or more annual points at a brand with no published
  ladder therefore earns 11 per dollar where they earned 10 the day before.
  That is the number the app was already promising them, but it is live money
  and the owner should know the date it moved.
- **The ledger earns on the subtotal; the app quotes on the subtotal plus tip.**
  `pointsForPurchase` is called with `qualifyingSpendCents`, which includes the
  tip; the trigger uses `orders.subtotal_cents`, which does not. This migration
  deliberately did not close that: whether a tip earns points is a business
  policy about money that goes to staff, not a bug with a right answer, and
  changing it silently would move every tipping guest's balance. Both readings
  are defensible; the owner picks one. Whichever is picked, both sides should
  then read the same base.
- **A tenant's `brand.json` can disagree with its `brand_config`, and nothing
  notices.** Coffee Story's ladder was committed to `tenants/coffee-story/brand.json`
  in `5f0c4b6` and has never reached the database, because `pnpm onboard` has
  not been re-run since; the hosted `brand_config -> 'loyalty'` holds only
  `$note` and `rewards`, with no `tiers` key at all. So the customer binary
  reads the published ladder out of its bundle while the ledger, reading the
  database, falls back to the generic one. Until `pnpm onboard --tenant
  coffee-story` is re-run they agree only by coincidence -- the two ladders
  happen to carry the same thresholds and rates. There is no check anywhere
  that the checked-in tenant file and the row it seeds are the same document.

**Still open**, deliberate, scoped to one market rather than one tenant, so it
does not block a second franchisee in the US:

- **Number and date formatting is `en-US` throughout** the HQ console and both
  apps (`toLocaleString('en-US')`, ~40 call sites). Note this is a *choice*, not
  an oversight: passing `undefined` would format a US shop's pickup times by the
  guest's device locale, so `en-US` is load-bearing until the platform sells
  outside it.

**Not certifiable.** This document says which findings were checked and what was
found. It does not say the platform has no defects; that is not something a
re-read can establish.

---

## Settled: the kiosk reads its menu live

Recorded as an open decision on 2026-08-23 because a test assertion was
settling it. It is settled now, deliberately, and the reasoning is worth
keeping because the deciding fact was not the one either side started with.

**What it was.** `apps/kiosk/src/data/catalog-data.ts` was a 181-line compiled
menu. A second tenant could not change a price, add an item or 86 something
without a rebuild and a store release -- the largest remaining franchise
blocker on this surface. The obvious fix, a direct read, was forbidden by a
guard in `packages/schema/src/surfaces.test.ts` asserting the kiosk built no
Supabase client.

**What decided it.** Not a preference between "client on a public tablet" and
"documented capability", but the RLS: `menu_items_select` admits **anyone**
once `menus.is_published` is true -- no device claim required. So a kiosk
reading the menu directly obtains nothing a lifted tablet could not already
get with the anon key that ships in the customer bundle. The client was never
the risk; what it reads is. The guard was buying no security on that path and
costing both a documented capability (`docs/FIVE-SURFACES.md`'s device table)
and migration 0027's entire stated rationale.

**What shipped.** The read goes through `@platform/data`'s `fetchMenuTree` --
the same read the customer and operator apps make, so there is one assembly of
the menu tree rather than a fourth -- and `subscribeToMenu` keeps it current.
0027 published `menu_items`, `menu_categories` and `drops` so "a change made
once should appear on every kiosk and display at once"; until now nothing
subscribed, so 86'ing an item reached no screen and a guest could order
something the shop ran out of an hour earlier.

**Three things worth knowing, because none were visible from the decision.**

*The mapping was a silent data bug waiting to happen.* `menu_items.sizes` is
stored `{ slug, label, price_cents }`; the kiosk's `CatalogSize` is
`{ slug, ounces?, priceCents }`. Reading one as the other does not throw -- it
yields `undefined` and prices the whole live menu at $0.00. Size slugs are also
bare in the database (`'12'`, not `'latte-12'`), which `sizeLabelFor` reads as
"Each". Both are pinned in `packages/domain/src/kiosk-menu.test.ts` against the
seed's literal shape.

*A pack's `choice_source` had never done anything.* The compiled
`packChoicesFor(pack)` took its argument and ignored it, so a 'lineup' pack and
a 'static' pack offered the same list and this week's rotation narrowed
nothing -- the one behaviour the column exists to express. With live rows the
drop window is readable, so `packChoicesOf` honours it.

*Routing the read through a shared package made the guard vacuous.* With no
`.from(` call left in `apps/kiosk/src`, the allowlist inspected nothing and
would have passed just as happily on `fetchCustomerOrders`. The guard now also
attributes a `@platform/data` module's relations to every export from it, which
immediately failed -- `subscribeToMenu` had been placed in `realtime.ts` beside
two functions that read `orders`. The fix was splitting the module, not
widening the list. Both directions are probe-verified: it fires on a delegated
forbidden read, fires on a direct one, and passes on the menu read.

**What is left.** The bundled catalog stays as a demo fixture for the web
export and the capture recipes. It is deliberately **not** a fallback for a
configured kiosk that fails to read: it is one tenant's menu, and serving it to
another brand's tablet would price their drinks wrong under their own logo with
nothing on screen to say so. A kiosk holding no menu says it is offline; a
kiosk that already has one keeps selling through a brief outage, which is a
stated trade rather than an oversight (`menu-store.tsx`).

---

All load-bearing claims verified against the tree. One new defect surfaced during verification that was not a first-class finding. Here is the report.

---

# FINAL AUDIT REPORT — Coffee Story / white-label ordering platform
Branch `claude/kiosk-ui-checkout-redesign-694fee` · 2026-08-23

---

## 1. VERDICT

No. Not one real order can be taken today, on any surface, and the reason is not polish — it is that three independent chains are each severed at a different link. The kiosk cannot enter its own ordering flow (tapping the attract screen navigates back to the attract screen), and even if it could, 14 of its 15 declared routes have no screen file and the app has no network layer at all — zero imports of `@platform/api-client`, `@platform/data` or `@supabase/supabase-js`, and no `fetch(` anywhere in `apps/kiosk/src`. The card-payment path is dead at the root: nothing in the repo ever writes `square_connections.square_location_id`, and `apps/hq/lib/square-runtime.ts:89` fails closed on exactly that column, so every `square_link` request returns 503 forever no matter how many times an owner completes the Connect Square flow. And the device-JWT model that three of five surfaces are documented to authenticate with has no minter — `app.custom_access_token` emits only `brand_id`, `role`, `location_ids`, `brand_name`, so `app.device_is_active()` is false for every token the platform can issue and the kiosk, display and prep RLS policies can never pass. On top of that, no guest is ever told their order is ready (`sendNotification` has zero production callers), `orders.guest_label` is read by the display and written by nothing, and `placeOrder` never checks drop windows on a platform whose entire category is the rotating-drop model. The engineering underneath is genuinely good — the domain logic is pure, tested and well-reasoned — but it is a very well-built set of parts that have not been connected to each other or to a backend. Treat the 951 green tests as what they are: coverage of pure functions, not evidence that a drink can be bought.

---

## 2. BLOCKERS

Nothing below is optional before a first real order.

### A. The kiosk cannot be used at all

**A1. Tapping the attract screen bounces back to the attract screen.**
`apps/kiosk/src/app/(flow)/_layout.tsx:26` mounts with `useEffect(() => { if (resetSeq > 0) startOver(); }, [resetSeq])`. `AttractScreen` (`apps/kiosk/src/app/index.tsx:26`) fires `onPress={() => { reset(); router.replace('/order/entry'); }}`, and `reset()` (`apps/kiosk/src/state/session.tsx:69`) increments `resetSeq`. So `resetSeq` is already ≥1 when `FlowLayout` first mounts, the mount effect fires, and `startOver()` does `router.replace('/')`. Every subsequent tap remounts with a higher counter and repeats.
**Fix:** seed a ref with the mount-time value and act only on increases — `const seen = useRef(resetSeq); useEffect(() => { if (resetSeq !== seen.current) { seen.current = resetSeq; startOver(); } }, [resetSeq])`. Or stop bumping `resetSeq` from `AttractScreen` and clear the cart directly.

**A2. 14 of 15 `STEP_ROUTES` have no screen file.**
`apps/kiosk/src/features/step-flow.ts:210` declares entry, node, item, options, pack, fill, review, bag, pay, identify, keypad, balance, processing, name, done. `find apps/kiosk/src/app -type f` returns only `(flow)/_layout.tsx`, `(flow)/order/entry.tsx`, `_layout.tsx`, `index.tsx`, and the three legacy screens. `apps/kiosk/src/app/(flow)/checkout/` is an **empty directory**. The `as never` cast at the router call site is what stops typedRoutes catching this at typecheck.
**Fix:** ship the 14 screens; add a test asserting every `STEP_ROUTES` value maps to a file under `apps/kiosk/src/app/`; add `apps/kiosk/src/app/+not-found.tsx` inside the tenant theme (today the export ships expo-router's dev Unmatched Route with a `/_sitemap` link and the raw `coffee-kiosk://` scheme on a lobby device).

**A3. The kiosk has no data layer.**
`apps/kiosk/package.json` declares `@platform/api-client`, `@platform/data`, `@supabase/supabase-js`, `expo-secure-store`, `@sentry/react-native` and `expo-updates`; **grep returns zero import sites for every one of them**, and there is no `fetch(` in `apps/kiosk/src`. `apps/kiosk/src/app/receipt.tsx:27` is still `const ticket = 47;`. `addLine` is called only from the dead legacy `app/order.tsx:88`, so no `(flow)` screen can put anything in the cart. `setCommitted` / `setBuilding` (`state/session.tsx:108-109`) are never called.
**Fix:** wire `createApiClient` behind the checkout screens; have item/options call `session.addLine`; call `setBuilding(true)` during pack construction and `setCommitted(true)` at `processing`; make the idle effect consult `idleMayReset(step)` (currently zero call sites).

**A4. NEW — the double-charge guard is inverted, and untested.**
`apps/kiosk/src/features/checkout.ts:70` — `reusesAttemptKey` returns true only for `'timedOut' || 'failed'`. But `case 'retry'` (line 122-124) returns `{ ...state, phase: 'idle' }`. So the real sequence `timedOut → retry → place` evaluates `reusesAttemptKey('idle') === false` and mints a **fresh** `event.attemptKey`. That defeats the entire idempotency invariant the module exists for: a timed-out request that did create the order produces a second order with a different `client_key`. The file's own docblock claims *"Pure, so `node:test` covers all of it"* — `ls apps/kiosk/src/features/` confirms **there is no `checkout.test.ts`**, and the reducer has zero non-test call sites.
**Fix:** either have `retry` preserve the failing phase, or widen `reusesAttemptKey` to include `'idle'` when `attemptKey !== null`. Then write `checkout.test.ts` pinning: (1) `timedOut → retry → place` keeps the original key; (2) `recoveryAdvice` from `timedOut` is never `'choose-another-tender'` for any `attempts`; (3) from `'succeeded'`, every event but `cartChanged` returns the identical object (`assert.equal`, not deepEqual).

### B. Card payments are structurally dead

**B1. Nothing writes `square_connections.square_location_id`.**
`apps/hq/app/api/square/callback/route.ts:95-108` upserts exactly six columns: `brand_id`, `location_id`, `merchant_id`, `access_token_encrypted`, `refresh_token_encrypted`, `expires_at`. Verified repo-wide: the only occurrences of `square_location_id` are the column definition (`supabase/migrations/20260722000005_orders.sql:13`), the type (`packages/schema/src/types.ts:92`), three reader lines in `apps/hq/lib/square-runtime.ts`, and one hand-rolled INSERT in `tests/integration/src/square-tender.test.ts:181`. **There is no production writer.** `square-runtime.ts:89` is `if (!data || !connection?.square_location_id) return null;`. `location_square_status` (`…000008_views.sql:7-14`) projects only `merchant_id` and `expires_at`, so the console shows the location as connected while every card request 503s.
Note this is **not** a one-line fix: `OAuthTokens` (`packages/engine/src/square/client.ts:87-93`) is `{ access_token, refresh_token, expires_at, merchant_id }` — Square's token response carries no location id, and there is no `/v2/locations` helper anywhere in `packages/engine`.
**Fix:** add a `listLocations` call to `packages/engine/src/square/client.ts` (the OAuth scope list at :77 already requests `MERCHANT_PROFILE_READ`), call it in the callback after `exchangeOAuthCode`, persist the chosen id; add a console picker where a merchant has several. Add an integration test that drives the callback route end to end instead of INSERTing `square_connections` directly.

**B2. The webhook never records `square_payment_id`, so every `square_link` order is permanently unrefundable.**
`apps/hq/app/api/webhooks/square/route.ts:96-150` inserts the `paid` event, calls `recordLoyaltyEarn` and `recordPlatformFee` with `mapped.squarePaymentId`, and never writes it back to the order row — verified: the only writers are `captureSquarePayment` (`packages/engine/src/orders.ts:630`, unreachable — `/api/orders` hard-503s `square_card`) and `scripts/square-sandbox.ts:102`. Consequences: `refundOrderPayment` throws `refund_unavailable` at `orders.ts:982`; `mapSquareEvent` returns `squareOrderId: null` for `refund.updated` (`square/webhooks.ts:85`) so the route falls to `.eq('square_payment_id', mapped.squarePaymentId ?? '')` (route.ts:60), matches nothing, and 404s until Square gives up. **`square_link` is a live tender today** — `apps/hq/app/api/orders/route.ts:41` `LIVE_TENDERS = new Set(['pay_at_pickup', 'square_link'])` — so this is not conditional on future work.
**Fix:** in the `paid` branch, `.update({ square_payment_id: mapped.squarePaymentId })` guarded by `.is('square_payment_id', null)` so replays are no-ops, before recording the fee. Add a webhook integration test driving `payment.updated` then `refund.updated`.

**B3. A guest can cancel a card-paid order and keep the money at Square.**
`packages/engine/src/orders.ts:862` — the only guard is `if (order.square_payment_id) throw new OrderError('cancel_unavailable', ...)`, and per B2 that column is null on every `square_link` order. `GUEST_CANCELLABLE` is `['created','paid']` (:811), `paid → cancelled` is a legal transition, and the function then calls `reverseLoyaltyEarn(... refundedCents: order.total_cents ...)`. Guest gets a 200, points clawed back as if refunded, order off the board, Square still holding the money with no refund issued.
**Fix:** B2 closes this, but do not leave the guard on one nullable column — also refuse when `tender_type = 'square_link'` and `status <> 'created'`. Add a cancel-after-webhook-paid test.

### C. The device-JWT model has no minter

**C1.** `supabase/migrations/20260722000009_claims_hook.sql` — verified: `app.custom_access_token` writes only `brand_id`, `role`, `location_ids`, `brand_name` across all three branches. No `device_id`, `device_role`, or `device_location_id` anywhere. `packages/schema/src/claims.ts` `TenantClaims` has the same three fields. So `app.jwt_device_id()` is NULL for every issuable token, `app.device_is_active(...)` is `exists(... where d.id = NULL)` = false, and `orders_display_select`, `orders_kiosk_select` (`…0023:100,110`) and the prep policies (`…0024:115,124,127`) can never pass.
This is broader than "pairing UI is missing": the claim schema, the minter, and the API's claim parser all have no device concept.
**Fix:** extend `app.custom_access_token` (or add a service-role mint endpoint in `packages/engine`) to emit the three device claims; add a `DeviceClaims` parser beside `parseTenantClaims`; teach `apps/hq/lib/api-auth.ts` `authenticate` to accept a device token distinctly from a user token. Then build pairing (engine module + routes + HQ UI).

### D. The order lifecycle has holes a real shop will hit on day one

**D1. No guest is ever told their order is ready.** Verified: `sendNotification` and `liveTransport` (`packages/engine/src/notifications.ts:53,98`) have **zero callers outside `notifications.test.ts`**. `TEMPLATES.order_ready` exists. `apps/hq/app/api/push-tokens/route.ts` collects tokens and `apps/customer/src/lib/push.ts:28` registers them — registration works, delivery does not exist.
**Fix:** hang the send off a server-side observer of the `ready` transition — a Postgres trigger → Edge Function on `order_events where type = 'ready'`, or route the transition through a new `POST /api/orders/status`. Add a `notifications_sent` ledger keyed on `(order_id, template)` so a retried tick cannot double-send.

**D2. `placeOrder` never checks drop windows.** `packages/engine/src/orders.ts:196` resolves lines with `.eq('is_listed', true).eq('is_86d', false)` and nothing else — no join to `drops`, no `dropVisibility` call. `drops.item_id` FKs `menu_items` (`…0003:58`) and `app.drop_visibility` exists (`…0026:56`). Anyone replaying `POST /api/orders` with a known slug buys a drop item before reveal or weeks after `ends_at`.
**Fix:** left-join `drops` in the slug resolution and reject any line whose `app.drop_visibility(d, now())` is not `orderable`; reject `rotation = 'day_specific'` items off-weekday in the location's timezone; add `OrderError('item_unavailable')` and a test for one second past `ends_at`.

**D3. `orders.guest_label` is written by nothing.** Verified: `placeOrder`'s insert (`orders.ts:256`) lists 14 columns and not this one; `PlaceOrderRequest` (`packages/api-client/src/contract.ts:24-39`) has no field to carry it. Readers exist — `apps/display/app/board/[location]/board-view.tsx:104` `{ticket.guest_label ?? ''}` — plus a whole tested kiosk module (`apps/kiosk/src/features/guest-label.ts`) with zero non-test call sites. `apps/display/lib/demo-board.ts` fixtures all carry names, so the surface demos correctly and fails silently in production.
**Fix:** add `guestLabel?: string` to `PlaceOrderRequest`, validate in the route using the promoted `guest-label.ts` rules, write it in the insert. Add a `packages/schema/src/surfaces.test.ts` assertion that every column `board_tickets` projects has a writer in the engine.

**D4. Tender vocabularies have zero overlap.** *Closed 2026-08-30 -- see the status section.* `packages/domain/src/kiosk-flow.ts:43` `KioskTender = 'card' | 'gift_card' | 'stored_value' | 'cash'` vs `packages/api-client/src/contract.ts:13` `TenderType = 'pay_at_pickup' | 'external' | 'square_link' | 'square_card'` vs the DB CHECK (`…000012:13`) matching the latter. `tenants/coffee-story/brand.json:271` already declares `["card","stored_value"]`. A fourth vocabulary exists at `apps/operator/src/features/staff/payment-availability.ts:1-9`. Not one value the kiosk can emit is postable.
**Fix:** pick one enum. Either widen the CHECK + contract, or make `KioskTender` a mapping onto `TenderType` and assert totality in `kiosk-flow.test.ts`. Do it before the checkout screens are written, not after.

---

## 3. FRANCHISE READINESS

This is the stated goal, so be blunt: **tenant #2 is already in the tree and already broken.** Nothing about tenant #50 is a scale problem — it is the same tenant-#2 problems multiplied by a build pipeline that does not exist.

### What breaks the moment tenant #2 onboards

**The guest is shown Aurora, Colorado tax and charged something else.** `packages/domain/src/tax.ts:32` hardcodes state 0.029 / *City of Aurora Sales Tax* 0.0375 / RTD 0.01 / Arapahoe County 0.0025, and it is the **default parameter** of `orderTotals` (`packages/domain/src/totals.ts:60`) and `taxCentsFor`. The server is correct and data-driven (`parseTaxJurisdictions(brand.brand_config)`, `apps/hq/app/api/orders/route.ts:153`). Verified: **`tenants/demo-roastery/brand.json` has no `tax` key at all** — so the server charges $0 while `apps/customer/src/screens/client/order/checkout-step.tsx:132` renders four Colorado authorities totalling 7.90% by name. A Texas franchise shows *"City of Aurora Sales Tax"* on the checkout screen.
Mitigating: live orders render `result.totalCents` from the server, so no wrong amount is charged — this is a wrong pre-purchase display plus a foreign jurisdiction's name on a guest-facing screen. Live-reachable at exactly one site (`order-screen.tsx:106`); the operator/kiosk call sites are demo branches or dead legacy routes.
**Fix:** delete the default parameter so a missing list is a type error; delete `TAX_JURISDICTIONS`/`COMBINED_TAX_RATE` from `packages/domain`; thread the list from the hydrated brand config (`apps/customer/src/tenant/brand.json` already bundles `tax.jurisdictions` — only the `TenantFile` type omits it).

**`brand_config.kiosk` has neither a producer nor a consumer.** Verified: `scripts/onboard.ts:123-133` writes `brand_config: { identity, tokens, copy, business, ...(tax), ...(loyalty) }` — **no `kiosk` key**, and `BrandFile` has no field for it so TS cannot flag the omission. Verified: `tenants/_template/brand.json` has **no `kiosk` key**, so a tenant following CLAUDE.md step 1 has no documented shape to fill. And nothing reads `brand_config.kiosk` from the DB either — `apps/kiosk/src/app/_layout.tsx:11` imports a **bundled JSON file**.

**The kiosk is a per-brand binary that no pipeline can produce.** Verified: `tenants/coffee-story/brand.json`, `apps/customer/src/tenant/brand.json` and `apps/kiosk/src/tenant/brand.json` are all md5 `4b7f8ef92636b875a9e6c56301c4da25` — identical **by hand**. `scripts/onboard.ts:285` copies to `apps/customer` only. `apps/customer/src/tenant/tenant.test.ts` pins its copy; `apps/kiosk/src/tenant/` contains `brand.json` and nothing else. `tests/consistency/src/duplicates.test.ts:22` walks only CUSTOMER and OPERATOR. `apps/kiosk/app.json` hardcodes `"slug": "coffee-story-kiosk"`, `"bundleIdentifier": "com.coffeestory.kiosk"`, with no `app.config.ts`. There is **no `apps/kiosk/eas.json`** and no build/submit scripts. The menu is compiled in (`apps/kiosk/src/data/catalog-data.ts`, byte-identical to the customer's).
**Do not fix this by cloning `apps/customer/app.config.ts`.** `docs/FIVE-SURFACES.md` assigns the kiosk *device JWT* auth — the right shape is: delete the bundled copy, hydrate brand + menu at pair time the way `apps/operator/src/data/business.ts` does. Until pairing lands (blocker C), the minimum stopgap is a kiosk drift test mirroring the customer's and a second `copyFileSync` in `onboard.ts:285`.

**`packages/domain` ships one tenant's business as shared code.** `information-pages.ts:16` — *"Coffee Story is a specialty coffee shop in Aurora, Colorado…"*, `2222 S Havana St Unit A1`, `(720) 609-2971`, prayer room, *"We proudly serve Corvus Coffee"*; rendered live at `apps/customer/src/screens/client/more/information-page.tsx:51`. `rules.ts:22-25` `REWARD_TIERS` = First Sip / Daily Ritual / House Regular / **Coffee Legend**, imported on the live checkout. `fulfillment.ts:37-47` `PICKUP_LOCATIONS` hardcodes the same address, consumed by both apps. `menu-options.ts:20` types `MenuCategoryId` as Coffee Story's seven categories, so a bakery's options **will not typecheck**, and `tenants/coffee-story/modifiers.json` flows backwards — it is *generated* from that module by `apps/customer/scripts/emit-menu.ts` with the target path hardcoded to `tenants/coffee-story`.
Note `more-screen.tsx:166` already shows the tenant-correct address from `BUSINESS`, and the page that row opens shows Coffee Story's from `INFORMATION_PAGES` — one screen, two sources, one wrong.
**Fix:** move `INFORMATION_PAGES` and `REWARD_TIERS` into `brand.json`/`brand_config` (add `loyalty.tiers` and `informationPages` to `_template`); keep only types and formatters in `packages/domain`; invert the modifiers flow so `menu_items.modifiers` is authored and the apps read option groups from the row; add a test that fails on a tenant proper noun inside `packages/*`.

**Tenant palettes reach one Stack background.** Verified: **46** files in `apps/customer/src` and **35** in `apps/operator/src` import `@/theme/tokens` (header: *"Coffee Story palette: 'Espresso & Cream'"*); exactly **1 file per app** calls `useTokens()`, both only for `contentStyle.backgroundColor`. `apps/customer/src/app/_layout.tsx:115` already admits it in a comment. `apps/display` depends on no token package at all and hardcodes seven CSS literals (`display.css:11-17`) that match *neither* tenant cleanly — `--ink-muted: #7a6a5d` appears in no `brand.json` in the repo and `--success: #2f6844` is demo-roastery's, not coffee-story's. `apps/operator/src/screens/auth/auth-screen.tsx:55` renders `Coffee Story · by Barakah Brews` **pre-login**, on a binary whose whole premise is tenancy-by-login.

**The platform is structurally US-only.** `packages/engine/src/square/client.ts` types every money object as `currency: 'USD'` **as a literal** (`:129,187,193,213,242,244,260`) — it cannot be passed in. `packages/domain/src/money.ts:17` hardcodes `'en-US'` and `'$'`. `BrandFile` has no `currency` or `locale`. The first CAD/GBP tenant is an onboarding dead end whose fix is a type-level change in a shared package.

### What additionally breaks at tenant #50

Nothing new architecturally — but the per-tenant costs compound: every customer binary ships an unused `@stripe/stripe-react-native` native SDK (`apps/customer/package.json:16`, zero import sites), every listing needs a privacy policy URL that **does not exist anywhere in the repo** (`docs/legal/` holds only commercial templates), and every binary is rejectable under Apple 5.1.1(v) because the app offers account creation with **no in-app deletion path** (grep for `delete.*account|deleteUser` in `apps/customer/src` returns nothing). Those are per-brand rejections, paid 50 times.

---

## 4. CROSS-SURFACE SYNCHRONIZATION

The honest state of the five-surface chain, link by link.

| Link | Real? | Evidence |
|---|---|---|
| Guest places order (customer app) | **Partly real** | `/api/orders` works for `pay_at_pickup`; `square_link` 503s (blocker B1) |
| Kiosk places order | **No** | No network layer at all; no screens past entry (A2, A3) |
| Order → prep board (operator) | **Real for reads** | `fetchActiveLocationOrders` + Realtime on `orders` works |
| Order → pickup display | **Fixtures** | Device policies can never pass (C1); anon fallback fakes "Live" |
| Prep tab (surface 4) | **Fixtures only** | `prep-screen.tsx:6` is `useState(DEMO_BAKE_LIST)`, `advance()` writes nothing |
| Crew tab (surface 5) | **Fixtures only** | `crew-screen.tsx:6` is `DEMO_CHECKLIST`/`DEMO_CREW_MEMBER`/`DEMO_SHIFTS` |
| Guest notified "ready" | **No** | Zero callers of `sendNotification` (D1) |

**The shared data layer is unused on the surfaces it was written for.** `fetchPrepBoard`, `fetchRecipe`, `subscribeToPrepBatches`, `fetchShiftRoster`, `fetchChecklist`, `checklistProgress`, `batchScale` are all exported from `packages/data/src/index.ts:33-38` and consumed **only by their own tests**. `splitBoard` (`packages/data/src/board.ts:41`) is exported and unused while `apps/display/app/board/[location]/board-view.tsx:21` re-implements it character-for-character as `splitColumns`. `fetchMenuTree` has no caller outside `tests/integration`. The prep batch is modelled twice (`PrepBoardEntry` vs `BakeBatch`) with the scaling maths duplicated (`prep.ts:64` `batchScale` vs `bake-list.ts:61` `scaleQuantity`).

**One order carries three ticket identities and the wire contract returns none of them.** `PlaceOrderResponse` (`contract.ts:44`) has no ticket field. The display renders `daily_number` (trigger-assigned, `…0023:31-58`). The operator KDS renders `shortCode: shortCodeOf(row.id)` → `"A17"` (`live-board.ts:36`) under a comment claiming *"every screen derives the same call-out from the id alone"* — and `boardOrderFromRow` ignores `row.daily_number` entirely. The kiosk receipt renders the literal `47`. A barista calls "A17" while the TV four feet away shows "42". `daily_number` appears in `apps/` only in the display and one operator **test fixture**.

**Realtime is wired on the DB side and subscribed by nobody.** Migration 0027 added `menu_items`, `menu_categories`, `drops`, `prep_batches` to `supabase_realtime` with the explicit rationale that *"a change made once should appear on every kiosk and display at once"*. `packages/data/src/realtime.ts` exports exactly two subscribers, both on `orders`. Grep for `.channel(` outside that file returns nothing. So 86'ing an item propagates to nothing: `apps/operator/src/state/operator-store.tsx:256` reads the 86 list in a one-shot effect and never re-reads. `packages/schema/src/surfaces.test.ts:142` asserts the tables are in the publication, so CI is green on a wire nobody is listening to.

**The display claims Realtime in three comments and is a 60-second poll.** `board-view.tsx:43` — *"Reconcile on a timer whatever Realtime is doing"*; `tickets/route.ts:7` — *"re-reads on a timer rather than trusting Realtime alone"*; `docs/ARCHITECTURE.md:29-30` diagrams `DB -->|Realtime|` into the boards. There is no `.channel(` and no client-side supabase client in `apps/display`. `LINGER_MS = 90_000` is declared, exported, and referenced nowhere. A barista marks a drink ready and the guest waits up to 60s.

**The display fakes "Live" when unconfigured.** Verified `apps/display/lib/board.ts:19` — `const key = process.env.DISPLAY_DEVICE_TOKEN ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;` and `isConfigured()` returns `client() !== null`. Any deployment with the public Supabase env (which the customer web build requires anyway) gets a live client whose anon JWT satisfies no policy, returns `[]` with no error, renders "Nothing in the queue", and shows the freshness badge as **Live** — the badge only flips to "Reconnecting…" after 90s with no *successful* poll, and empty polls succeed. The honest fixture board is bypassed.

**The order-line snapshot has no owning type.** `orders.totals` is written by `orders.ts:221` and mirrored structurally in three places that import nothing shared: `orders.ts:552`, `apps/customer/src/lib/live-portal.ts:51`, `apps/operator/src/features/operator/live-board.ts:10` — the operator's **omits `unit_price_cents`**, so the KDS can never show a line price. All mirrors use optional properties with `?? 'Item'` / `?? 1` defaults, so a rename breaks readers silently. The same concept has five shapes across the tree.

**A menu item has four incompatible shapes and no surface reads the real rows.** `fetchMenuTree` (real `menu_categories` + `menu_items`) has zero app callers. Instead: two byte-identical compiled catalogs (`apps/customer` and `apps/kiosk` `data/catalog-data.ts`), a third in `apps/operator/src/data/catalog.ts` with its own `MenuItem` type, and `MenuItemRowLike` in HQ. `apps/kiosk/src/data/menu-source.ts` keys categories **by title** because *"menu_categories (0003) has no slug"* — while the server prices by `menu_items.slug`.

**`orders.channel` can never be `'kiosk'`.** `apps/hq/app/api/orders/route.ts:176` — `channel: auth.claims.role ? 'pos' : 'app'`. Meanwhile `in_app_share` (`…0008:34`) is `filter (where o.channel in ('app','web'))` — the headline number on the HQ dashboard and the weekly owner email. Every kiosk sale lands in the denominator and not the numerator, so the metric an owner reads as *"how much is coming through our own platform"* **falls as more guests self-serve on the platform's own hardware**. Zero tests assert `orders.channel`.

---

## 5. REMAINING TASK LIST

Ordered by dependency. Each stage assumes the one above it landed.

### Stage 0 — Contract spine (nothing else can be correct until these agree)

**0.1 Unify the tender vocabulary.** *Done 2026-08-30.* `packages/domain/src/kiosk-flow.ts:43`, `packages/api-client/src/contract.ts:13`, `supabase/migrations/…000012_order_idempotency.sql:13`, `apps/operator/src/features/staff/payment-availability.ts:1-9`. *Done:* one enum, or an explicit total mapping asserted in `kiosk-flow.test.ts`; a `cash` or `stored_value` kiosk config produces a value the DB CHECK accepts.

**0.2 Add `guestLabel` and `dailyNumber` to the wire contract.** `packages/api-client/src/contract.ts` (`PlaceOrderRequest` + `PlaceOrderResponse`), `packages/engine/src/orders.ts:256` insert and `.select(...)`, `apps/hq/app/api/orders/route.ts`. Promote `apps/kiosk/src/features/guest-label.ts` into `packages/domain` and validate with it. *Done:* a placed order returns the number the display will show, and `board_tickets.guest_label` is non-null for an order that supplied one.

**0.3 Make `channel` derivable and tested.** Extract `resolveOrderChannel(claims, deviceRole)` into `packages/domain`; replace the ternary at `apps/hq/app/api/orders/route.ts:176`. Add the `app.order_channel` ↔ `OrderChannel` drift assertion to `packages/schema/src/surfaces.test.ts` (the file already does this twice for `DeviceRole` and `DropStatus`). Decide what `in_app_share` means and fix `…0008_views.sql:34` or rename the column. *Done:* a device claim with role `kiosk` yields `'kiosk'`; a test reads `select channel from orders` after placement.

**0.4 Own the order-line snapshot type.** Export it from `packages/domain`; have `packages/engine/src/orders.ts:552`, `apps/customer/src/lib/live-portal.ts:51` and `apps/operator/src/features/operator/live-board.ts:10` import it. *Done:* three `type SnapshotLine` declarations become one import; the operator KDS can render a line price.

### Stage 1 — Config spine (tenant data actually reaching runtime)

**1.1 Add `kiosk` to the onboarding path.** `scripts/onboard.ts` — add `kiosk?: unknown` to `BrandFile` and `...(brand.kiosk ? { kiosk: brand.kiosk } : {})` to the `brand_config` literal at :131. Add a documented `kiosk` block to `tenants/_template/brand.json`. Validate it by round-tripping through `resolveKioskFlow` + `inspectKioskFlow` during the CSV/config step. *Done:* a template-derived tenant has a kiosk block, and a dead category tile fails at onboarding.

**1.2 Pin the third `brand.json` copy and copy it on `--apply`.** `scripts/onboard.ts:285` (add the kiosk destination), new `apps/kiosk/src/tenant/tenant.test.ts` mirroring `apps/customer/src/tenant/tenant.test.ts`. Generalise `tests/consistency/src/duplicates.test.ts:22` to compare all three of `apps/{customer,operator,kiosk}/src`, keying `DIVERGENT_BY_DESIGN` by `pair + path`. *Done:* editing `tenants/coffee-story/brand.json` turns **three** suites red, and `apps/kiosk/src/data/catalog-data.ts` can no longer diverge silently.

**1.3 Make the tax table tenant data.** Delete the default parameter from `orderTotals` / `taxCentsFor` / `taxRowsFor` in `packages/domain`; delete `TAX_JURISDICTIONS` and `COMBINED_TAX_RATE`; add `tax` to `apps/customer/src/tenant/index.ts`'s `TenantFile` and thread it to `apps/customer/src/screens/client/order-screen.tsx:106`. Add a `tests/consistency` source scan forbidding `orderTotals(` without a `jurisdictions` field. Add a `packages/domain` test asserting domain and engine `taxRowsFor` produce identical rows and sums for the same input. *Done:* a missing jurisdiction list is a type error, and demo-roastery's checkout screen shows what demo-roastery is charged.

**1.4 Move tenant strings out of `packages/domain`.** `information-pages.ts`, `rules.ts:22-25` (`REWARD_TIERS`), `fulfillment.ts:37-47` (`PICKUP_LOCATIONS`), `add-ons.ts:6`, `client-search.ts:33-34`, `feed.ts:128`. Add `informationPages` and `loyalty.tiers` to `tenants/_template/brand.json`. Set `EMPTY_DELIVERY_ADDRESS.state` to `''`. *Done:* a test fails on a tenant proper noun inside `packages/*`; `apps/operator/src/state/staff-workspace.tsx:229` reads the location from `liveLocations`, and its own `useBusiness()` value (already in scope at :62) rather than the constant.

**1.5 Invert the modifiers flow.** Make `menu_items.modifiers` the authored source; reduce `packages/domain/src/menu-options.ts` to pure combinators over a supplied group list; widen `MenuCategoryId` to `string`; parameterise `apps/customer/scripts/emit-menu.ts` by `--tenant`. *Done:* a bakery's categories typecheck and its options render.

**1.6 Currency.** Add `currency`/`locale` to `brand.json` identity + `brand_config`; thread into `SquareConfig` so `packages/engine/src/square/client.ts:129,187,193,213,242,244,260` take it instead of the `'USD'` literal; change `formatMoney` to `Intl.NumberFormat(locale, { style: 'currency', currency })`. Validate in `onboard.ts` against the connected Square location. *Done:* a CAD tenant can be onboarded.

**1.7 Consolidate money formatting.** Delete `packages/domain/src/feed.ts:82` and `client-search.ts:53` in favour of `money.ts`'s `formatMoney`; export `formatMoneyExact` and have `apps/hq/lib/kpi.ts:47` import it (add `@platform/domain` to `apps/hq/package.json`); sweep the ~15 inline `$${(x/100).toFixed(2)}` sites in `apps/customer/src`. *Done:* one implementation; `kpi.test.ts:43`'s `'$26,124.00'` still passes.

### Stage 2 — Backend spine (nothing takes money until this is done)

**2.1 Write `square_location_id`.** Add a `listLocations` helper to `packages/engine/src/square/client.ts`; call it in `apps/hq/app/api/square/callback/route.ts` after `exchangeOAuthCode`; persist into the same upsert; add a console picker for multi-location merchants. *Done:* an integration test drives the callback route end to end (not an INSERT) and a `square_link` order returns a checkout URL.

**2.2 Write `square_payment_id` from the webhook.** `apps/hq/app/api/webhooks/square/route.ts:96-150`, guarded `.is('square_payment_id', null)`. *Done:* a `payment.updated` → `refund.updated` integration test refunds successfully instead of 404ing.

**2.3 Harden the cancel guard.** `packages/engine/src/orders.ts:862` — also refuse `tender_type = 'square_link'` with `status <> 'created'`. *Done:* a cancel-after-webhook-paid test returns `cancel_unavailable`.

**2.4 Refresh and revoke Square tokens.** `refreshOAuthToken` / `revokeOAuthToken` (`square/client.ts:107-124`) have zero callers and `expires_at` is read by no application code. Add a refresh pass to the cron tick (`expires_at < now() + 7 days`), a lazy refresh backstop in `apps/hq/lib/square-runtime.ts:78-89`, and a console action for revoke. *Done:* a location connected 30 days ago still takes cards; `docs/RUNBOOK.md` stops describing behaviour that does not exist.

**2.5 Collapse the forked scheduled tick.** Verified divergence: `apps/hq/app/api/jobs/run/route.ts:27-30` selects `'id, status, starts_at, ends_at'` over `['scheduled','live']` and marks due campaigns `status: 'sent', stats: { delivered: 0 }`; `scripts/run-jobs.ts:26-29` selects `reveal_at` over `['scheduled','revealed','live']` and claims `status: 'sending'`. Vercel crons the route. Move the body into `runScheduledTick(db, now)` in `packages/engine`; keep the `'sending'` claim; add `'revealed'` to both filters; update `docs/RUNBOOK.md:29` to name the cron route as the single scheduler. *Done:* one implementation, and no campaign reaches `'sent'` having delivered zero.

**2.6 Make `'revealed'` reachable.** `supabase/migrations/…0007_rls.sql:92-93` `drops_select` and `packages/data/src/menu.ts:43` both list `('scheduled','live','ended')`. Route both through `app.drop_visibility(d) <> 'hidden'` / the `dropVisibility` helper. Add an enum ↔ TS-union drift test. *Done:* a revealed drop is visible to guest/kiosk/display sessions.

**2.7 Enforce drop windows and hours in `placeOrder`.** `packages/engine/src/orders.ts:196` (drop join, per D2) and :182 (add `locationIsOpen(hours, timezone, at)` to `packages/domain` beside the `ordering_paused` check, with `OrderError('closed')`; honour `scheduled_for` as the exception). Use the same helper to disable the client checkout control. *Done:* a 3am order is refused before payment; an item one second past `ends_at` is refused.

**2.8 Send the ready notification.** Per D1. *Done:* marking an order ready delivers exactly one push/SMS/email, and a retried tick delivers zero more.

**2.9 Timeouts and retries on every server fetch.** Move `fetchWithRetry` (`packages/api-client/src/http.ts`, `DEFAULT_TIMEOUT_MS = 10_000`, `DEFAULT_ATTEMPTS = 2`) into a framework-free module; use it from `packages/engine/src/square/client.ts:60` and `notifications.ts:56,68,80`. Keep retry off `createPayment` unless the Square `idempotency_key` is threaded. *Done:* CLAUDE.md's "timeout and at minimum one retry" holds server-side; a Square stall returns a typed error, not a 504.

**2.10 Bound the board reads and sweep stale orders.** `packages/data/src/orders.ts:14` and `packages/data/src/board.ts:19` — add `.gte('created_at', startOfServiceDay)` (or `.eq('service_date', today)`) and an explicit `.limit()`. Add a sweep to the tick moving orders left in `ready` past a per-brand threshold to a terminal state with an `order_events` row. *Done:* two service dates cannot put the same `daily_number` on one board (test it).

**2.11 Rate limiting and CORS.** `apps/hq/lib/api-auth.ts:40` — `Access-Control-Allow-Origin: '*'` on every response, and grep confirms no limiter anywhere. Add a limiter in `api-auth.ts` (bearer subject for authenticated, IP for webhook/health/tickets), returning `ApiErrorBody` with 429; tighten CORS to the tenant web origins. *Done:* `/api/loyalty/redeem` and `/api/webhooks/square` are rate-limited.

### Stage 3 — Device pairing (unblocks surfaces 2, 3, 4)

**3.1 Mint device claims.** `supabase/migrations/…0009_claims_hook.sql` + `packages/schema/src/claims.ts` (`DeviceClaims` parser) + `apps/hq/lib/api-auth.ts`. *Done:* `app.device_is_active('display')` returns true for a paired display token.

**3.2 Build pairing.** Engine module + routes + HQ UI. Fix `devices.pairing_code` plaintext exposure and migration 0014's blanket `grant all` while here. *Done:* an operator can pair and revoke a device from the console, and revocation invalidates outstanding tokens on the service-role path.

**3.3 Close the display's base-table exposure.** `supabase/migrations/…0023:100-106` — make `board_tickets` a definer view filtering on `app.device_is_active('display') and location_id = app.jwt_device_location()`, revoke insert/update/delete the way 0031 did, drop `orders_display_select` from `public.orders`. Same review for `orders_kiosk_select`, whose comment claims "own order" and whose body is location+1hour. *Done:* a display token cannot `select * from public.orders`.

**3.4 Execute the device RLS matrix.** Extend `tests/integration/src/rls-matrix.test.ts` (which today contains no occurrence of `device`) with: `pairing_code` denied to device tokens and to other brands' staff; a kiosk token cannot read a sibling location's order; a `revoked_at` device reads nothing; a device fails every staff-only write. Keep `packages/schema/src/surfaces.test.ts`'s regexes as a drift alarm, not the security test. *Done:* the two known device holes are covered by an executed test.

**3.5 Drop the display's anon fallback.** `apps/display/lib/board.ts:19` — require `DISPLAY_DEVICE_TOKEN` for live mode, fall through to `DEMO_BOARD` otherwise; surface the PostgREST result rather than coercing to `[]`. *Done:* an unpaired display shows fixtures with an honest badge, never an empty "Live" board.

### Stage 4 — Kiosk screens

**4.1 Fix the attract bounce** (A1) and **fix the checkout reducer's retry path + write `checkout.test.ts`** (A4). Do these first — they are one-line changes gating everything below.
**4.2 Ship the 14 step screens** under `apps/kiosk/src/app/(flow)/`, plus `+not-found.tsx`. Add the `STEP_ROUTES` ↔ filesystem test. Drop the `as never` cast once typedRoutes covers the group. *Done:* a guest can walk entry → item → options → bag → pay → done on the web export.
**4.3 Wire the data layer** (A3): `createApiClient` behind checkout driven by `checkoutReducer`; `session.addLine` from item/options; `setBuilding`/`setCommitted`; `idleMayReset(step)` in the idle effect; render the server's `dailyNumber` instead of `const ticket = 47`.
**4.4 Fix the provider order so tenant kiosk config is reachable.** `apps/kiosk/src/app/_layout.tsx:42` — `KioskSessionProvider` currently wraps `FlowProvider`, so `flow.idle` is resolved *below* the provider that needs it. Reorder (or resolve once in the layout and pass down). Have `app/index.tsx` render `flow.attract.headline`/`invite` instead of `copy('appName')`/`copy('orderCta')`. Thread `flow.motion === 'reduced'` into a reduced-motion override alongside `useReducedMotion()`'s OS signal — on a locked-down lobby tablet that config is the only escape hatch a guest has. *Done:* demo-roastery's 90000/150000 idle timings and its attract copy take effect.
**4.5 Delete the legacy routes** `apps/kiosk/src/app/{order,tender,receipt}.tsx` once the flow replaces them.

### Stage 5 — Surfaces 4 and 5 onto real data

**5.1 Point Prep at the shared layer.** `apps/operator/src/screens/staff/prep-screen.tsx:6` — replace `useState(DEMO_BAKE_LIST)` with `fetchPrepBoard` + `subscribeToPrepBatches` behind the same `live = !isDemo && supabase && tenant` switch `operator-store.tsx:93` already uses. Collapse `BakeBatch` onto `PrepBoardEntry` and delete the duplicated `scaleQuantity`. *Done:* an order placed on the kiosk appears on the bench tablet.
**5.2 Point Crew at `fetchShiftRoster` + `fetchChecklist`.** Same pattern. *Done:* a checklist tick persists.
**5.3 Add the missing Realtime subscribers.** `subscribeToMenuChanges` and `subscribeToLocationSettings` in `packages/data/src/realtime.ts`; wire in `operator-store.tsx:256`, the kiosk menu source, and the customer menu screen. Add a subscriber-count assertion to `surfaces.test.ts` so a table in the publication with no reader fails the same test that put it there. *Done:* 86'ing an item clears it from the kiosk without a power-cycle.
**5.4 Give the display a socket.** Import `splitBoard` instead of the local `splitColumns`; subscribe via `subscribeToLocationOrders`; keep the 60s poll as the documented reconcile; implement or delete `LINGER_MS`. Correct the three comments and `docs/ARCHITECTURE.md:29-30`. *Done:* a "ready" repaints the wall in under a second.
**5.5 Persist the operator's offline queue.** `apps/operator/src/state/operator-store.tsx:108` `useRef` → AsyncStorage keyed by location id, rehydrated in the `live` effect before the first `reconcileLive()`, cleared only after `flushQueue` confirms the insert. *Done:* a test proves a rehydrated queue flushes and a server-applied transition is a no-op, not a conflict.
**5.6 Unify the call-out.** `boardOrderFromRow` (`live-board.ts:36`) keys on `row.daily_number`, `shortCodeOf` only as a null fallback; fall back to `guest_label` before `'Guest'`. Promote the row→board mapping into `packages/data` beside `splitBoard`. *Done:* barista, TV and receipt say the same number.

### Stage 6 — Design tokens

**6.1 Promote the shared primitives.** `components/ui.tsx`, `order/order-chrome.tsx`, `order/option-controls.tsx` into `packages/ui` — retires ~110 `colors.*` references across both apps and removes them from the duplication guard at once.
**6.2 Convert the remaining 81 files** off `@/theme/tokens` onto `useTokens()`; remove `'theme/tokens.ts'` from `DIVERGENT_BY_DESIGN` (`tests/consistency/src/duplicates.test.ts:80`) once the files are empty. Pick `packages/ui`'s scale as canonical (`radius.md` 14 vs legacy 18, `spacing.lg` 16 vs 24) and re-map rather than keeping both; delete the legacy `motion` export and point its 8 call sites at `tokens.motion.*`.
**6.3 Fix `packages/ui`'s own literals.** Map the 17 `fontSize:` numerals onto `tokens.type.*` and replace the two `shadowOpacity` literals with `tokens.elevation.card` / `.raised` (0.25 at `toast.tsx:87` silently contradicts `elevation.raised` 0.16; `tokens.elevation` currently has **zero** readers). Note `elevation: 2`/`6` are Android dp and are correctly literals.
**6.4 Kiosk onto its own ladder.** `index.tsx:46-47`, `idle-notice.tsx:75-80`, `circle-tile.tsx:157-160` (`borderRadius: 9999` → `tokens.radius.pill`), `_layout.tsx:37` (`'#FAF5EF'` → the tenant surface).
**6.5 Give the display and HQ a token path.** Add `@platform/ui` to `apps/display` (`packages/ui/src/tokens.ts` has zero imports and is Next-safe today), fetch the brand row alongside the board query (`board_tickets` already projects `brand_id`; `packages/data`'s `fetchBrandBySlug` already reads the world-readable `brand_storefront` view), and emit `resolveTokens(...)` as CSS custom properties on `.display-root` so the existing `var(--surface)` rules keep working. Same for `apps/hq/app/globals.css`'s ten hardcoded hexes.
**6.6 Neutralise the operator's pre-login identity.** `auth-screen.tsx:55` eyebrow, the two `version="Coffee Story 1.0"` footers, the `coffee-story.*` storage keys (`demo-storage-keys.ts:7-8`), and `app.json`'s splash/adaptive-icon assets and reverse-DNS ids.
**6.7 Promote `contrast.ts` into `packages/ui`** and assert AA for `textPrimary`/`textMuted`/`success`/`warning`/`danger` on both `surface` and `surfaceElevated`, for `DEFAULT_TOKENS` **and** every `tenants/*/brand.json` through `resolveTokens`, so onboarding a bad palette fails CI. (All shipped palettes pass today; `accent` at 2.85:1 is only used as text in an unreachable `Badge` path — fix or restrict it.)
**6.8 Promote `a11y-state.ts` into `packages/ui`** and use it at `apps/kiosk/src/components/circle/circle-tile.tsx:118` — it emits `aria-selected` on `accessibilityRole="button"`, the exact pairing the helper's docstring rules out (`aria-pressed` is correct). Latent today because `CircleTile`'s only caller never passes `selected`; it will not be latent once the step screens land.

### Stage 7 — HQ tab and settings write path

**7.1 Give HQ a settings-write path** (the `/brand` "Save to brand" button has no `onClick`), including authoring `brand_config.kiosk`.
**7.2 Add a per-channel revenue breakdown** to `location_daily_metrics` and render it, so `in_app_share` stops being the only channel signal.

### Stage 8 — CI, observability, and release gates

**8.1 Make the lint gate real.** Drop the `|| echo` from `apps/hq/package.json:9` and `apps/display/package.json:9` (verified: both swallow real errors — a probe file with `var x = 1` reported `no-var` and still exited 0), and give both a Next-aware flat config first so removing the fallback does not gate them on `eslint-config-expo`. Replace the six package-level no-ops (`packages/engine`'s `echo 'lint: added in Phase 7'`, etc.) with a real invocation.
**8.2 Bundle every surface in CI.** `.github/workflows/verify.yml` contains neither the word `kiosk` nor `display`. Add `npx expo export` for the kiosk (ios + web) and `pnpm --filter @platform/display build`; better, replace the hand-maintained list with `pnpm -r verify`, which already encodes the right per-workspace step. Both pass today — this is a guard, not a repair.
**8.3 Cover the webhook route.** `apps/hq/app/api/webhooks/square/route.ts` — sole caller of `recordPlatformFee`; the partial-refund accumulator (:71-87) and the `ignoreDuplicates`/`.select('id')` replay discriminator have no test. Add: replayed event writes no second `loyalty_events` or `platform_fees` row; $2 refund on $22 leaves status unchanged; the closing refund transitions to `refunded`; a paid event with null `customer_id` still writes the fee.
**8.4 Wire the originality gate into CI.** It exists only as a manual skill. Add a `git ls-files`-based grep job that `publish-preview` `needs:`. Then clear the two current hits: rename `apps/operator/src/data/business.test.ts:65`'s `'<a competitor name>'` to an invented name yielding the same `BBW` monogram, and rewrite `.claude/skills/audit-originality/SKILL.md:36` the way `docs/BUILD-REPORT.md:123` already does it (`getBread<a competitor name>ogLevel…`), plus a documented commit-message exclusion — the name is in commit `8a5a613`'s body and cannot be edited without a history rewrite.
**8.5 Observability.** Add `monitoring.ts` to the kiosk (it declares `@sentry/react-native` and initialises nothing) — promote the duplicated customer/operator copy into a package. Add `@sentry/nextjs` + a DSN-gated `instrumentation.ts` + `error.tsx` to `apps/display`. Add `export const onRequestError = Sentry.captureRequestError` to `apps/hq/instrumentation.ts` and wrap `next.config.ts` in `withSentryConfig` (today App Router server errors and all browser errors reach nothing, and events are unmappable).
**8.6 Make synthetics able to see an outage.** `__checks__/platform.check.ts:9` probes `/` with `followRedirects: true`, which passes as long as Next serves the login page. Add a deep mode to `/api/health` doing one cheap authenticated read returning 503 on failure; point an ApiCheck at it; add a display board check; declare an `alertChannels` in `checkly.config.ts`.
**8.7 Copy HQ's security headers to the display.** `apps/hq/next.config.ts:13-26` → `apps/display/next.config.ts` (frame-ancestors, HSTS, nosniff, Referrer-Policy); factor into a shared module. The display serves guest first names on a public unauthenticated URL.

### Stage 9 — Ship-gating compliance and build config

**9.1 Account deletion + privacy policy.** `DELETE /api/profile` anonymising `customers` (keep the row for the append-only ledger's FK), revoking push tokens, calling GoTrue admin delete; surface from More → Profile behind a confirm. Write `docs/legal/privacy-policy.md` as a tenant-templated document and generate its URL into `tenants/<slug>/app-store/listing.md` from `pnpm onboard`. Add a retention policy for `order_events` snapshots. *Done:* Apple 5.1.1(v) satisfied and the listing's "Fill in before submission" placeholder resolves.
**9.2 EAS config for the two non-tenant binaries.** Create `apps/kiosk/eas.json` + build/submit scripts; add committed `extra.eas.projectId` and `updates.url` to both `apps/kiosk/app.json` and `apps/operator/app.json` (today `apps/operator` runs `eas update --channel preview` against binaries configured to poll nothing, and CI papers over it with `npx eas-cli init --non-interactive --force` into an ephemeral copy).
**9.3 Remove the unused Stripe SDK.** `apps/customer/package.json:16` `@stripe/stripe-react-native` — zero import sites. Re-run `pnpm install --frozen-lockfile` and `npx expo export --platform ios` to confirm nothing resolved it transitively.
**9.4 Correct `SQUARE_ENV` documentation.** Add it to `docs/PRODUCTION.md:95-97` and the card-payments checklist; add `CRON_SECRET` and `DISPLAY_DEVICE_TOKEN` to `.env.example`. Consider making `squareConfigFromEnv` throw when unset rather than defaulting to sandbox.

### Stage 10 — Docs and captures (last, because they document the above)

**10.1 Fix `docs/RUNBOOK.md:17`.** It tells the reader to run `packages/schema/migrate.sh`, which is a four-line shim ending in `exit 1`. Replace with `supabase db push`; correct the operator bundle id (the page says `com.example.operator`, `apps/operator/app.json:15` says `com.coffeestory.operator`); add the missing Backup/Rollback section — grep finds no `backup|restore|rollback|PITR` guidance anywhere in `docs/`, and migrations are forward-only with no down scripts.
**10.2 Harden and repoint the capture script.** `scripts/capture-surfaces.mjs:35` targets `/order`, `/tender`, `/receipt`. Assert `response.ok()` and a non-empty rendered root after `page.goto` — Playwright does not throw on a 404, which is how all five committed `docs/captures/02-kiosk/*.png` came to be error pages (four share md5 `442d981f411f758f3e03fe50e5f1fd4a`, a "404 · The requested path could not be found"; the fifth is a `dist/` directory index) captured under confident captions. Repoint at the real step routes once they exist; add a demo-roastery variant so the `family: 'pack'` path is exercised. Re-capture and replace.
**10.3 Reconcile the docs to reality.** `docs/FIVE-SURFACES.md:13` records the kiosk as "Built"; `docs/BUILD-REPORT.md:70` claims "Sentry (hard-gated) in all three apps"; `docs/PRODUCTION.md:117` asserts the OAuth callback writes `square_location_id`; `docs/RUNBOOK.md` describes token refresh and revocation that have no callers; `apps/kiosk/src/features/idle.ts:22` says timings come from the tenant. Fix each as its code lands, not before.

---

## 6. WHAT IS ALREADY SOLID

Do not spend effort here.

**The pure domain logic is genuinely excellent** and is the reason this is recoverable rather than a rewrite. `packages/domain/src/kiosk-flow.ts` (`resolveKioskFlow` / `inspectKioskFlow` / `normalizeForSave` / `entryNodesFromCategories`) degrades correctly by design — the tenant block's own `$docs` promises "delete this whole block and a device still opens on a first screen derived from menu.csv" and that holds. `apps/kiosk/src/features/{step-flow,pack-fill,idle,constellation,guest-label}.ts` are well-reasoned, well-tested, and asset-free so `node:test` can reach them. `checkout.ts` is the right *policy* — it just has one inverted branch and no test (A4).

**Money arithmetic is correct where it counts.** `packages/engine/src/fees.test.ts` covers `computeAppFeeCents` including the tier-threshold straddle and rounding, `feeMonthKey`, and `feeMonthRange` across timezone and year rollover. Per-row tax rounding is unit-tested in both `taxRowsFor` implementations. Integer cents are used consistently. `apps/hq/lib/kpi.ts`'s always-two-decimals formatter is a deliberate, tested accounting-column choice, not a bug — I checked the claimed `$-0.50` negative-rendering defect and it does not exist (`(-0).toLocaleString('en-US')` yields `"-0"`, output identical to `money.ts`).

**The order state machine and its SQL enforcement.** `order_events` append-only with a JSONB snapshot per transition, `square_event_id UNIQUE` for webhook idempotency, `app.assign_daily_number` restarting per location per service date, the transition CHECK in `…0005_orders.sql:95` — all sound. `tests/integration/src/order-machine.test.ts` exercises the triggers against a real database.

**RLS design, as written.** The policies are thoughtfully scoped and `packages/schema/src/surfaces.test.ts` catches SQL-text drift. The device-token gap is a *missing minter*, not a broken policy model — once C1 lands, the policies do what they say (after fixing the two known base-table exposures in 3.3).

**The token system's validator.** `packages/ui/src/tokens.ts` `resolveTokens` with per-group ceilings and round-trip idempotence is correct and tested (`tokens.test.ts:50,54-60` proves per-tenant overrides like `type.lg: 22` and `ticket: 200` are honoured). Every palette shipped today clears WCAG AA on every text role — I computed the ratios: coffee-story `textMuted #6B5B4E` on `surface #FAF5EF` is 5.99:1, semantics land 4.97–6.85. The *mechanism* is right; only consumption is missing.

**`packages/api-client`'s HTTP client.** `fetchWithRetry` with a 10s timeout and 2 attempts is exactly what the server side needs — it just lives in the wrong package (2.9 moves it, does not write it).

**The transitional discipline is real.** `tests/consistency/src/duplicates.test.ts` genuinely catches customer↔operator forks, `apps/customer/src/tenant/tenant.test.ts` genuinely pins the bundled brand copy, and the `DIVERGENT_BY_DESIGN` allow-list is honest debt-tracking rather than suppression. The pattern works; it just needs extending to the third fork (1.2).

**The comment culture.** Comments explain *why* throughout, and several of them correctly predicted the exact failures in this report (`_layout.tsx:115` on the unread theme, `orders.ts:363` on `in_app_share`, `…0027`'s header on Realtime propagation). The gap is not understanding — it is that the wiring those comments describe was never finished. That is a much better problem to have.