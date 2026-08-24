# Platform Audit — Phase 0

Baseline: branch `agent/platform-build`, cut from `12c706b` — the head of the
dependency-audit / UI-UX / production-readiness pass (PR #1). That pass is
**Phase 0 of this build** and is not redone here. Its findings live in
`PRODUCTION_SETUP.md` (six known gaps), `README.md`, and
`IPHONE_EXPO_GO_DEMO.md`; the 23-defect adversarial review is recorded in the
PR body. This document adds the platform-specific audit: what is hard-coded,
what is single-tenant, and what mixes roles in one binary.

## Stack summary

| Layer | What is actually here |
| --- | --- |
| App framework | Expo SDK **54** (pinned deliberately — App Store Expo Go embeds 54; see `AGENTS.md`), React Native 0.81.5, React 19.1 |
| Routing | expo-router v6, file routes under `src/app/` |
| Language | TypeScript 5.9 strict; ESLint via `eslint-config-expo`, `--max-warnings=0` |
| State | React contexts only (`src/state/`: app-mode, auth, demo, order cart, staff workspace). No Redux/Zustand. Cart is in-memory by design |
| Data | **No database schema in this repo.** `@supabase/supabase-js` 2.111 is used for auth only (`src/lib/supabase.ts`); all data flows over REST through `src/lib/mobile-api.ts` to an external portal (separate Vercel checkout) whose routes are appointment-shaped — there is no order endpoint (PRODUCTION_SETUP.md gap 1) |
| Payments | **Stripe** (`@stripe/stripe-react-native` 0.50.3, `src/lib/stripe.ts`, staff checkout `payment-section.tsx`). **No Square SDK anywhere.** The target architecture is Square per-location OAuth, so this is a replacement, not an upgrade |
| Money | Integer cents everywhere (`src/features/money.ts`); itemised tax via `src/features/tax.ts` |
| Tests | `node:test` via `tsx` — `.ts` only, no component renderer; 397 cases. Feature modules stay asset-free so tests can reach them |
| Animation | Reanimated 4 + Skia on Fabric; animations ride wrapper `View`s only (Fabric text constraint, `AGENTS.md`) |
| Package manager | npm + `package-lock.json` today; pnpm 10.33 available on this machine for the workspace conversion |
| CI/CD | `.github/workflows/verify.yml`: lint → typecheck → test → iOS + web bundles; `npm audit` on both graphs (0 findings); `publish-preview` EAS Update job on merge to main. EAS channels `preview`/`production`, `runtimeVersion: exposdk:54.0.0` on all channels |

## Hard-coded colors, fonts, and brand strings

Fonts: **zero** `fontFamily` literals outside `src/theme/tokens.ts`. All type
reads `fonts.*` (Fraunces display / Inter body via `@expo-google-fonts`).

Colors: `src/theme/tokens.ts` is the single palette, but six files carry raw
hex outside it:

| File | What | Disposition |
| --- | --- | --- |
| `src/screens/client/home-screen.tsx:482-483` | `#7ED492` ×2 (status-glow green) | replace with token read (Phase 3) |
| `src/components/staff/workspace-ui.tsx:13,17,33` | `#E4F0EA`, `#F6E3E5`, `#E4F0EA` (staff tint chips) | replace with token read (Phase 3) |
| `src/components/preview-role-picker.tsx:89` | `shadowColor: '#000000'` | replace with token read (Phase 3) |
| `src/app/+html.tsx:44,76` | web `theme-color` + body background (`#241710`, `#FFFDF8`) | must become tenant-generated at export time (Phase 4); static HTML cannot read a runtime provider |
| `src/components/rewards/glass-cup-palettes.ts` | ~30 espresso/glass shades | deliberate illustration palette for the Skia cup, not UI chrome — keep, but move under the tenant's `brand_config.illustrations` so a brand can supply its own (Phase 3) |
| `src/theme/contrast.test.ts` | hex fixtures + pinned AA values | test fixtures; re-point at token snapshots when tokens hydrate from brand config |

Brand strings: **106 occurrences** of `Coffee Story` / `coffeestory` /
`coffee-story` across 20 `src/` files (catalog, demo data, rewards rules,
notifications feed, setup flow, gift shelves, install prompt, info pages,
`+html.tsx`, `_layout.tsx`, tokens, tests). `src/data/business.ts` already
centralises name/address/monogram — the platform copy dictionary
(`brand.json` → copy) replaces it and the other 19 files' literals. Bundle
identity (`app.json`: name, slug, bundle id `com.coffeestory.app`, EAS project
id, deep-link scheme) is single-tenant and must come from `tenants/<slug>/`
config at build time.

## Competitor references

Exactly **one** occurrence in the tree: a code comment at
`src/screens/client/home-screen.tsx:50` naming the competitor app whose
recording served as the UX reference. Removed in Phase 1; the term used from
here on is **"rotating-drop model."** No competitor assets, CSS, JS, or
screenshots exist in the repo (`assets/` and `assets-library/` are original
photography and generated imagery). `docs/DO-NOT-RESEMBLE.md` (Phase 8) codifies
the rule without naming anyone.

## DB tables lacking a tenant column

**All of them, by omission: this repo defines no tables.** There are no
migrations, no SQL, no generated DB types — the client speaks to an external
appointment-shaped API and a Supabase project whose schema lives nowhere in
version control. Tenancy therefore cannot be retrofitted; `packages/schema`
(Phase 2) starts from zero with `brand_id` (and `location_id` where relevant)
on every table and RLS from JWT claims. `scripts/migrate-legacy.ts` backfills
whatever exists in the current Supabase project into the first brand/location.

## Screens mixing customer and operator functionality

One binary currently ships all roles; the gate is a runtime role check
(`src/state/auth-context.tsx` + `preview-role-picker.tsx`), which violates
architecture rule 7 (operator/admin functionality never ships inside the
customer binary):

| Route | Role | Problem |
| --- | --- | --- |
| `src/app/staff/**` (9 routes: today, calendar, clients, quick-actions, more/checkout, admin catch-all) | operator/admin | whole operator area inside the customer app |
| `src/app/client/more/admin.tsx` | admin | admin console mounted **inside the client tab tree** |
| `src/screens/staff/**` incl. `admin-pages/`, `checkout/` (register) | operator/admin | screens + POS shipped to every guest |
| `src/features/staff/`, `src/features/admin/`, `src/state/staff-workspace.tsx`, `src/components/staff/` | operator/admin | logic + state in the guest bundle |
| `src/screens/client/**`, `src/app/client/**` | customer | stays in `apps/customer` |
| `src/screens/auth`, `src/state/*`, `src/lib/*`, `src/theme`, `src/components/*` (non-staff) | shared | split: reusable pieces → `packages/ui` / `packages/engine`; the rest duplicated per app until consolidated |

Phase 1 moves the operator/admin trees into `apps/operator` and deletes them
from the customer app.

## Single-tenant assumptions beyond strings

- `app.json`: one bundle id, one scheme, one EAS project — needs per-tenant Expo config (rule 7: one customer binary per brand)
- `src/lib/portal-url.ts` host allowlist: one hard-coded host set
- `src/features/tax.ts`: Aurora, CO jurisdictions compiled in — must move to location config
- `src/features/order/pickup.ts`: `SHOP_HOURS` compiled in — must come from `locations.hours`
- `src/data/catalog.ts`: 61-item menu compiled in with `require()`d imagery — must come from `menus`/`menu_items` (seeded from `tenants/<slug>/menu.csv`)
- Feature availability (gift cards, catering, delivery) is compiled in — must read brand feature flags (rule 5)

## Carried-over known gaps (from Phase 0, still true)

1. No server-side order endpoint — the engine (Phase 7) replaces the external portal for ordering
2. `runtimeVersion: exposdk:54.0.0` shared by all EAS channels — business decision pending
3. Tax rates, Vercel host, and `hello@coffeestoryco.com` unconfirmed with the client
4. Web register (`pos-totals.ts` in the external portal) still on flat 8% tax

---

# The pickup display, audited — 2026-08-23

A second pass, scoped to `apps/display` and everything it reads. The surface
had shipped and worked; what follows is what it did *not* do, found by reading
the read path end to end rather than the screen. Nineteen items closed, seven
left open with a reason.

## Closed

### Privacy and access

1. **`board_tickets` was a convention, not a boundary.** 0023 introduced the
   view so a wall screen would never be one query away from `customer_id` or
   the cart — then shipped it `security_invoker = true` alongside
   `orders_display_select`, a policy granting a display device SELECT on
   `orders` itself. 0014 grants *every column of every public table* to
   `authenticated`. The narrow projection was therefore advisory: the token on
   a tablet in a public room could read `totals`, `note`, `square_payment_id`
   and `customer_id` for every active order at its location. **0030** drops the
   policy and makes the view security definer with `app.can_read_board` as its
   own gate, so the projection *is* the privilege. `surfaces.test.ts` now pins
   both halves.
2. **The reconcile route was an open proxy.** `GET /board/<id>/tickets` had no
   auth. On a deployment with `DISPLAY_DEVICE_TOKEN` set, anyone who could
   reach the host could enumerate location ids and read out every board's queue
   of guest names. Now same-origin gated and id-validated.
3. **A non-uuid location 500'd the wall.** The path segment went straight into
   `.eq('location_id', …)`; Postgres answered 22P02, and a screen bolted to a
   wall showed a Next error page. `isLocationId` turns it into a 404 — and only
   when a database is configured, so the fixture slugs stay demoable.

### Resilience

4. **One failed read took the whole surface down.** `loadBoard` now cannot
   throw; a failure degrades to an honest header state. Nobody is watching this
   screen for a stack trace.
5. **The freshness chip lied on fixtures.** With no database the reconcile
   effect returned early, so `updatedAt` never advanced and the chip flipped to
   "Reconnecting…" ninety seconds in and stayed there — announcing the failure
   of a connection that was never meant to exist. Three states now: live,
   stale, sample.
6. **Realtime was documented and never wired.** The comments described
   reconciling "whatever Realtime is doing"; nothing subscribed. Wiring it as
   written would have been worse than not: `orders` is published with
   `replica identity full`, so a socket on it delivers whole rows to the
   browser. The board now polls its own server route on a stated interval, and
   the comment says why.
7. **`LINGER_MS` was exported and never used.** The constant described a
   collected ticket lingering so a guest walking up still sees it; nothing
   implemented it, and numbers vanished between blinks. `reconcileBoard` now
   does it, with tests.
8. **A busy board clipped silently.** `.ticket-list { overflow: hidden }` meant
   the eleventh ticket simply left the screen. Columns now cap and state the
   remainder.

### Tenancy and rule 4

9. **`display.css` hard-coded one tenant's palette.** `--surface: #faf5ef`,
   `--brass: #b08d57` — Coffee Story's `brand.json`, pasted into a stylesheet
   on a multi-tenant surface. The second brand to hang a screen would have got
   the first brand's colours. Hydrated per brand now; a test asserts every
   variable the CSS reads is one the theme provides.
10. **Board copy was hard-coded English.** "Making now", "Ready", "Here" and
    the rest, in components. Words are tokens too; they are copy-dictionary
    keys now, and every read goes through `formatCopy`.
11. **The column split existed twice** — `splitColumns` in `board-view.tsx` and
    a never-consumed `splitBoard` in `@platform/data`. One implementation, in
    `@platform/domain`.

### Features the schema already supported and nothing used

12. **`orders.channel` had existed since 0005 and no surface read it.** The
    board now says where an order came from.
13. **There was no tier concept anywhere.** Added as brand config plus
    `app.loyalty_tier_for`, deliberately coarse: a bucket slug, never a
    balance, opt-in per brand.

### Toolchain

14. **The display's lint gate could not fail.** `next lint --max-warnings=0 ||
    echo 'next lint unavailable'` — the `||` swallowed every failure, so
    `pnpm lint` reported success on files it never checked. Real flat config
    now, verified to fail on a planted error.
15. **Three packages compiled looser than the apps consuming them.**
    `@platform/domain`, `@platform/data` and `@platform/api-client` hand-rolled
    their `tsconfig` instead of extending `tsconfig.base.json`, so they missed
    `noUncheckedIndexedAccess`. 25 latent errors surfaced the moment a strict
    app imported them. All three extend the base; the errors are fixed rather
    than suppressed.
16. **`@platform/schema` typecheck was already failing on main** — four
    `noUncheckedIndexedAccess` errors in `surfaces.test.ts`, meaning
    `pnpm typecheck` at the root was red before this pass began. Fixed.

### Tests that were not testing

17. **`board.test.ts` pinned migration 0028 by filename** — the exact mistake
    `surfaces.test.ts` documents avoiding. It would have kept checking a view
    that no longer existed. It scans all migrations now.
18. **The column-safety check substring-matched the whole view text.** That
    misses a forbidden column smuggled in under an alias, and false-positives
    on an argument passed to a definer function. Both tests parse the select
    list.
19. **The demo was a frozen array.** In a repo with no component renderer, the
    fixtures path is the *only* place the poll, the reconcile and the linger
    ever execute before a shop depends on them — and a static board exercised
    none of it. `demoBoardAt` is a pure function of the clock that walks the
    queue on a fixed cycle, so the demo now runs the real loop.

## Open, with reasons

- **`REWARD_TIERS` hard-codes one tenant's ladder inside a shared package.**
  `packages/domain/src/rules.ts` carries "First Sip" … "Coffee Legend" and the
  literal string "make Coffee Story part of their day". That is rule 4 in a
  platform package, and it is the source the board's default ladder derives
  from. Moving it to `brand_config` touches the customer app's rewards screens;
  it wants its own change, not a rider on this one.
- **The earn ladder is keyed on annual points the database does not store.**
  `tierForAnnualPoints` takes a rolling-year figure; `loyalty_accounts` holds
  only `points_balance` and `lifetime_points`. No server-side projection can
  compute an annual rung today, which is why the board reads lifetime and says
  so. Fixing it means either a rolling window (a materialised sum over
  `loyalty_events`) or restating the ladder in lifetime terms. The second is
  cheaper and probably right.
- **`orders_kiosk_select` is the same shape as the policy dropped in 0030.** A
  paired kiosk or POS device can read whole `orders` rows created in the last
  hour at its location — all columns, including the cart and the customer id —
  and a lobby kiosk is as public as a wall. Same class as item 1, different
  surface. Out of scope here because the kiosk's receipt screen reads through
  it and would need its own narrow projection first.
- **The display has no deploy target defined.** It now carries a `vercel.json`
  with the headers this surface needs, but *where* it deploys is still written
  down nowhere (`docs/RUNBOOK.md` predates the app).

### Closed since

- **HQ's lint gate.** It carried the same `|| echo` escape hatch; it is now a
  real flat config over 50 files, and `verify` runs it first.
- **The display's instrumentation.** DSN-gated Sentry, as HQ has, at a lower
  trace rate: this app is a handful of screens polling every five seconds, so
  a high sample buys volume and nothing else. It also gained a `vercel.json`
  carrying `X-Robots-Tag: noindex` (a board of guest names must never be
  indexed), `frame-ancestors 'none'`, and a same-origin CSP — the page loads
  no third-party anything, and the QR is an inline path rather than a fetched
  image.
- **The originality gate could never pass.** The command in
  `.claude/skills/audit-originality/SKILL.md` returned exactly one hit, in that
  file, which quoted the name to illustrate the substring trap. Rephrased to
  make the same point without spelling it; the gate now returns zero.

## Follow-up — the board became one queue

The two-column board ("Making now" / "Ready") is how the *kitchen* thinks. A
guest does not care which of two stages their order is in; they care how many
people are in front of them and whether it is their turn. The board is now one
list: a place in line while you wait, a check when it is yours, and the row
leaves when staff mark the order collected.

Four things changed that are worth recording as decisions rather than diffs.

- **The number is a position, not a ticket.** It was `orders.daily_number`,
  which is stable by design and therefore never moves: a guest holding 43 sat
  on 43 all morning while the queue emptied in front of them. `queuePositions`
  counts only the people still waiting, so "3" becomes "2" as the bar works
  and the number means what a number in a line means.
- **The queue is a shared contract, not a display detail.** A barista asked
  "what number am I?" has to give the number on the wall behind them, so
  `queuePositions` lives in `@platform/domain` and both apps call it over
  their own row types. The operator's KDS card now shows the same `#n`, and
  `tests/consistency/src/board-sync.test.ts` pins the agreement — including
  that `ready` is the last board state and that `picked_up` is not one, which
  is what takes a guest's name off a public screen once they have their order.
- **The linger is gone.** It existed because a ready ticket used to vanish
  between blinks; the check now does that job openly, so holding a collected
  order on screen would only leave a stranger's name up after they had left.
- **The status badge is one asset, not two.** The board's badge is the
  customer app's rewards chip: pill, a translucent tint of the tier's own
  token role, the label, then the brand's mark. Both surfaces read that mark
  from `rewardMark` in the copy dictionary, so a brand that changes it changes
  both — `apps/customer`'s `RewardMark` no longer hard-codes the glyph.

### One consequence that needs a product decision

The wall no longer shows `orders.daily_number`. The kiosk receipt screen still
intends to (`apps/kiosk/src/app/receipt.tsx` prints "Your order number" over a
hard-coded `47`, a placeholder awaiting `placeOrder`), so once that is wired a
guest will walk away holding "47" and then look for 47 on a board that shows
"3". Nothing is broken today — the number on that screen is fake — but the two
surfaces cannot both ship as they stand.

Three ways out, none of them obviously right, all of them somebody's call:

- The receipt stops printing a number and prints the **name** instead. The
  board is name-first now, so the name is already the identifier; this is the
  smallest change and the most consistent.
- The board shows **both** — position large, ticket number small. Honest, but
  it puts two numbers on a screen whose whole argument is one glance.
- The receipt prints the guest's **position at the time of order**, which is
  wrong within a minute and is the worst of the three.

Recorded rather than decided.

## Follow-up — the badge became configurable

The status badge is the one thing on this screen a brand is most likely to want
to control precisely, and it was the one thing they could not: every rung drew
a wash of the same accent, distinguished only by a token role most tenants will
never read. Four steps of one colour do not read as four steps across a room,
which is the only place these are ever seen.

- `BoardTier` gains `color` and `icon`, both optional, both per rung, both
  resolved with the same field-by-field forgiveness as every other tenant
  value: a bad hex falls back to the rung's semantic token and a mark longer
  than two graphemes is dropped, so one typo in HQ costs a brand its colour
  and never a guest their badge.
- The mark leads the label. A rung is recognised by its mark before anyone has
  read a word of it, which is the whole reason a ladder has marks.
- The badge is a soft-cornered tag, not a pill. A pill reads as a control —
  something to press — and nothing on this screen can be pressed.
- The fill is a 26% wash of the rung's colour and the type stays ink. At
  fifteen feet dark-on-tint holds its contrast whatever colour a tenant picks;
  light-on-saturated depends entirely on which colour that was, and the point
  of making this configurable is that we do not get to know.
- HQ's brand-config editor grows a **Status badges** card: colour and mark per
  rung, preview-first, with the board's own row rendered in the live phone
  preview so an edit is read as a change to the thing rather than to a string.

The preview deliberately duplicates the board's CSS rather than importing it:
that stylesheet belongs to a wall screen and this one to a desk console, and
coupling them would mean a board tweak silently restyling the admin. What must
not drift is the *rule* — 26% wash, 42% border, ink type, mark leads — and it
is stated in both places.

Two smaller things in the same pass: the board is now the **Order Queue**, and
the rewards headline breaks where the brand's copy says it breaks (`\n` in
`boardQrTitle`) rather than wherever the viewport happens to put it — a
three-stop headline that lands "Perks." / "Status. Rewards" has lost the rhythm
that made it three stops.

## Follow-up — integrating with main caught a hole of its own

The board work was cut from `b328efa` and main moved nineteen commits while it
was in flight. Merging main *into* the branch before promoting — rather than
the other way round — is what surfaced the following, and it is the reason to
keep doing it that way.

- **The board view was a write path.** This branch's migration created
  `board_tickets` as a security-definer view, and 0014's
  `alter default privileges ... grant all on tables to authenticated` reaches
  views, so `authenticated` arrived holding INSERT, UPDATE and DELETE on it.
  A write through a definer view runs as the owner, outside RLS, against
  `orders`. Executed against the local stack before the fix:
  `information_schema.role_table_grants` listed DELETE/INSERT/UPDATE for
  `authenticated`; after `revoke insert, update, delete`, a bare authenticated
  caller running `delete from public.board_tickets` gets
  `permission denied for view board_tickets`.

  Main's 0031 had closed exactly this on `brand_storefront` and
  `location_square_status` and left a note saying the next definer view would
  reopen it. This was that view. The note worked — but only because the
  branches were reconciled before one of them shipped.
- **The migration number collided.** Main landed 0030, 0031 and 0032 while this
  branch held its own 0030. Renumbered to 0033. Nothing in the tree would have
  caught two migrations claiming one sequence number; the collision is silent
  until the second one to be applied is simply skipped.
- **`splitBoard` was not dead after all.** It was removed here as unused, and
  main's new five-surface trace suite imports it. That suite now asserts the
  queue model instead — a paid order takes a place in line rather than sitting
  in a "making now" column — which is what the display actually draws.
- **`packages/domain` picked up a file that predates its stricter tsconfig.**
  `scheme.ts` arrived from main under the looser settings it was written for
  and failed immediately under `noUncheckedIndexedAccess`. Fixed rather than
  suppressed. This will keep happening to anything merged in until every
  package extends `tsconfig.base.json`; that it happens loudly is the point.

## Follow-up — a sweep for the whole vulnerability class, and guards so it stops

0031 and 0033 each closed one definer-view write path. Two incidents of one
shape is a class, so this pass looked for the rest of it against a live
database rather than by reading SQL, and then replaced the comment that had
been holding the line with tests.

### The sweep

Asked the database, not the migrations, because the migrations are what would
be wrong:

- **Every view, is it updatable and does a client role hold writes?** Three did:
  `brand_daily_metrics`, `location_daily_metrics` and `drop_performance` each
  granted INSERT, UPDATE and DELETE to both `anon` and `authenticated`. All
  three are aggregates, and Postgres refuses writes to a view that is not
  automatically updatable, so the privilege was never reachable — a trap rather
  than a hole, and one that arms itself the day somebody simplifies one of them
  or hangs an INSTEAD OF trigger on it. Revoked in 0034. Every view in the tree
  now shows `(none)` for client writes.
- **Every public table, is RLS on?** All of them. With 0014 granting ALL to
  `authenticated`, a table with RLS off would be wide open; none is.
- **Every SECURITY DEFINER function, is `search_path` pinned?** All of them.
  An unpinned definer function is a search-path hijack waiting for someone with
  CREATE on a schema earlier in the path.
- **Any policy that is unconditionally `true`?** One: `locations_select`. That
  is deliberate — a shop's name, address and hours are storefront data. Noted
  below rather than changed.

### The kiosk had the display's hole

`orders_kiosk_select` (0023) granted SELECT on `orders` — every column, every
row at that location, for a rolling hour — to any paired kiosk or POS device,
so a tablet bolted to a counter in a public room could read strangers'
`customer_id`, `totals`, `note` and `square_payment_id`. Exactly the shape 0033
dropped for the wall, on a surface just as reachable.

0034 drops it for `kiosk_receipts`: a number, a name, a status, gated by
`app.can_read_receipt` and bounded to ten minutes. The window is the
containment — a kiosk does not authenticate a guest and so cannot prove which
order is its own, and a receipt is read seconds after checkout. An hour was a
whole breakfast service. Nothing consumed the old policy yet, so this cost
nothing to change.

### The guards

`packages/schema/src/invariants.test.ts`, because each of these was an incident
before it was a test and a comment is not a control:

- **No view is a write path.** Every view in the tree must revoke INSERT,
  UPDATE and DELETE from both client roles, and the revoke must come *after*
  the last `create` — `create or replace view` preserves grants but
  `drop`+`create` does not, so a revoke written before a later recreate is
  undone by it. (The first version of this test asserted against the wrong
  offset because `comment on view public.x` also contains the view's name. It
  failed on a view that was fine, which is the more expensive kind of wrong.)
- **Migration versions are unique, well-formed, and sort in apply order.** Two
  branches in flight both claimed 0030 and nothing failed loudly.
- **Every workspace tsconfig extends `tsconfig.base.json`.** This one found
  five more: `apps/display`, `apps/hq`, `tests/consistency`, `tests/e2e` and
  `tests/integration` all compiled under their own rules. All now extend the
  base and the workspace still typechecks clean.

### Still open

- **`locations` is world-readable including `square_connection_id`.** An
  internal FK to the encrypted-token table on a public read surface. Minor —
  `square_connections` has no policies at all, so the id does not dereference —
  but a storefront read has no business carrying a payments FK. Changing it
  means a projection and updating everything that reads `locations`, which is a
  lot of blast radius for a low-severity disclosure; recorded rather than done.
- The kiosk receipt / board numbering conflict, `REWARD_TIERS` carrying one
  tenant's ladder in a shared package, and the annual-vs-lifetime points
  mismatch all stand as previously recorded.
