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

### A gap in this pass's own verification

0033 broke the five-surface trace on `main` and nothing here noticed. That
suite read the board with the service role, which worked only while
`board_tickets` was `security_invoker`; once the view gated itself on
`app.can_read_board`, a principal with no device claim and no staff role
correctly got nothing back. Another session caught it and fixed it properly —
the board reads now go through `fetchBoardTickets` as a shift lead, plus a new
assertion on a paired display device's own claims.

The reason it was missed here is worth stating plainly: **`pnpm verify` returns
green without exercising RLS at all.** `tests/integration` is the only suite
that runs as a real principal, and it *skips* rather than fails when
`SUPABASE_TEST_*` is unset. A migration that changes who can read what is
therefore invisible to a full local verification run — the exact class of
change most likely to break something, and the one class the default gate does
not cover.

Two release rules now follow:

- A migration touching a policy, a definer function or a view's gate is not
  verified until the integration suite runs against the disposable hosted
  Supabase branch created by CI. Local Docker is not part of the release gate.
- `skipUnlessConfigured` remains appropriate for a developer's broad local
  test run, but promotion requires the separate `hosted-integration` job. That
  job provisions its own environment and therefore cannot silently skip the
  database or browser suites.

## Follow-up — the loyalty ladder, a live metric bug, and what a dead-code sweep actually found

### Two ladders, both computable (0035)

`rules.ts` keys the reward ladder on ANNUAL points and decides the earn rate
from it; `loyalty_accounts` stored only `points_balance` and `lifetime_points`.
So every server-side rung was either uncomputable or a lifetime number wearing
an annual name, and 0033's board badge documented itself as the second.

They are two different promises and the product wants both:

- **Annual** — the trailing twelve months. It can fall. It sets the earn rate,
  which is an *entitlement*: a benefit held while it keeps being earned.
- **Lifetime** — everything ever earned. It cannot fall. It sets the in-store
  badge, which is *recognition* — and taking someone's recognition away in
  front of a room because they travelled for a quarter is a thing no shop
  wants to do.

`app.annual_points_for` computes the window rather than storing it: a stored
column needs a job to age points out, and a job that does not run leaves a
guest holding a tier they stopped qualifying for — silently, in the guest's
favour, which is the direction nobody audits. Only `earn` and `reverse` count;
a redemption spends the balance without unmaking the spend that earned it.
Verified against the database: a guest with earns at 2 and 11 months, an earn
at 18 months, a reversal, a redemption and an adjustment scores 1400 annual
(900+600-100) against 5000 lifetime.

One correction to the record: an earlier comment here called reading annual
thresholds against lifetime points an "approximation". It is exact. Lifetime is
a running total and annual is the trailing window of the same series, so
lifetime >= annual always — a rung at 1500 means "reached 1500 in a year" on
one ladder and "reached 1500 ever" on the other. The badge is the easier to
earn and cannot be lost, which is what recognition should be.

### in_app_share was measuring the opposite of its name (0036)

`order-channel.ts` landed the corrected definition — `isOwnedChannel`, true for
app, web AND kiosk — and said it was "exported so the view and the report can
be reconciled against one definition instead of a SQL literal". **The view was
never changed.** `location_daily_metrics.in_app_share` still filtered on
`('app','web')`, so the database held the wrong definition and the TypeScript
one was consumed by nothing at all.

A kiosk is the most owned channel a shop has. Excluding it put every
self-service sale in the denominator and never the numerator, so the number an
owner reads as "how much comes through our own platform" *fell* as more guests
used the platform's own hardware. On a franchise dashboard that inverts the
ranking between a franchisee who installed kiosks and one who did not.

Fixed by giving SQL the same rule as a function (`app.is_owned_channel`) and
having the view call it. Verified: 1000 app + 1000 kiosk of 4000 total now
reports 0.5, where it previously reported 0.25. `IN_APP_CHANNELS`, which
existed only to mirror the old literal and had a test asserting the divergence
"is the point", is deleted — it had no callers and documented a disagreement
that no longer exists.

`tests/consistency/src/one-rule-two-languages.test.ts` now reads both
definitions and fails when they disagree. It lives there, not in
`packages/schema`, because schema is what domain is built on: a test needing
both belongs where both are already dependencies rather than in one that would
have to take a circular dependency to reach the other.

### The dead-code sweep, and why almost nothing was deleted

A mechanical sweep over every `.ts`/`.tsx` in the workspace found 322 exports
with no non-test consumer. Narrowed to runtime values referenced nowhere at all
— excluding types, which usually document a local API rather than sit unused —
it came down to 27.

Then the check that mattered: **every one of the nine "dead" components in
`apps/operator/src/components/staff/workspace-ui.tsx` is referenced by operator
screens on five or six other remote branches.** They are not dead; they are
in flight. Deleting them on main would have conflicted with every one of those
branches and broken some.

That is the finding, and it is worth more than the cleanup would have been:
**in a repo with five concurrent branches, "unused on main right now" is not a
synonym for dead.** The same reasoning already cost this branch once, when
`splitBoard` was removed as unused and turned out to be imported by an
integration suite that had not landed yet.

So nothing of another session's was deleted. What was removed is what could be
verified dead across every branch: `IN_APP_CHANNELS`. The remaining 26 are an
inventory, not a backlog — several (`useTheme`, `useToast`, `useDevice`,
`refreshOAuthToken`, `revokeOAuthToken`) are deliberate public API or
token-rotation machinery the runbook depends on, and removing them would be a
regression dressed as tidying.

The reusable lesson: a dead-code pass in a multi-branch repo needs
`git grep` across `refs/remotes/*` before anything is deleted, not just a
workspace search.

# Franchise-readiness audit — 2026-08-23

Scope: what stands between this platform and a second brand, and a brand with
several franchisees, running on it. Findings are ordered by what a franchise
literally cannot ship without. **F1-F5 are blockers**; O1-O6 are correctness
and optimisation.

Two of these are fixed in this pass (F3, and O1 from the earlier sweep). The
rest are specified rather than built, and the reason is stated per item — this
is a repo with three agents working concurrently, and several of these land in
territory another session has open.

## Blockers

### F1 — Nothing writes `brand_users`. You cannot provision a franchisee. **[open]**

`app.custom_access_token` (0009) resolves staff claims from `brand_users`, and
every staff policy in 0007 reads the `role` and `location_ids` it mints. A
grep across `apps/`, `packages/`, `scripts/` and `supabase/` finds **no writer
for that table at all** — no UI, no script, no seed. `docs/PRODUCTION.md:143`
documents inserting the row by hand as a launch step.

For a single shop, a one-off `insert` is tolerable. For a franchise it is the
whole product: onboarding a franchisee *is* creating their scoped access, and
today that means someone with a service-role key writing SQL. Until this
exists, "franchisee isolation" is a property of the schema that no one can
actually obtain.

Shape of the fix: a `POST /api/staff` route in HQ (service-role, owner-gated)
plus an invite flow, and a `brand_users` upsert in `scripts/onboard.ts` for
the brand owner. The RLS is already correct — `brand_users_update` is guarded
against self-promotion by 0031's trigger. This is a provisioning gap, not a
security one.

### F2 — Onboarding creates exactly one location. **[open — overlaps another session]**

`scripts/onboard.ts` reads `brand.location` (singular) and inserts one row. A
multi-location brand cannot be onboarded by the documented path at all, which
makes `multi_location` unreachable from the front door.

Fix: `locations[]` in `brand.json` with the current singular form accepted as
a one-element shorthand, so no existing tenant file breaks. Deliberately not
done here: `coffee-story-e4` has step 6 of that script open (tenant asset copy
+ product-media codegen). Agreed with them to split it — `locations[]` does
not touch step 6 — and to ping before pushing.

### F3 — One fee schedule per brand. **[FIXED — 0039]**

Rule 3 puts the platform's take on the brand. That is right for a shop and for
a chain a brand owns outright, and wrong the moment the brand carries
franchisees: terms are negotiated per franchisee, and with the rate on the
brand the only way to express two rates is two brands — splitting the menu,
the loyalty ladder and the guest's account along a line that exists purely for
billing.

Fixed: nullable `fee_bps` / `fee_bps_tier2` / `tier_threshold_cents` on
`locations`, NULL meaning inherit, so no backfill. Overrides apply **field by
field** — a franchisee who negotiated a rate but not a threshold still moves
with the brand when the threshold changes, which is what "we renegotiated the
rate" means and what a wholesale override would quietly break.

`resolveFeeConfig` moved out of `apps/hq/lib/square-runtime.ts` into
`packages/engine/src/fees.ts`: which numbers apply to a payment is rule 3, not
HTTP plumbing, and HQ owned it only because HQ happened to need it first.

A franchisee editing their own commission is guarded by a trigger, not a
policy — `locations_update` admits `app.at_location`, which includes a
`location_manager`, and policies cannot compare OLD to NEW. Same shape as
0031's platform_admin guard. `platform_fees.fee_bps_applied` already records
the rate each payment was charged at, so the ledger stays truthful across a
renegotiation without a backfill, which is exactly what a franchisee disputing
an invoice needs.

### F4 — `is_86d` is brand-wide, so one shop selling out 86s every shop. **[open]**

`menu_items` carries `brand_id` and no `location_id`. `is_86d` therefore
applies to the brand: a franchisee in Aurora running out of oat milk removes
the item from the menu in every other franchisee's shop, including their
kiosk and their board.

This is the most user-visible multi-location defect in the tree and it is a
data-model change, not a patch: availability has to become
`(menu_item, location)` rather than a column. Shape: a
`location_menu_availability` table keyed on both, a view that resolves
brand default + location override, and the operator's 86 toggle writing the
location row. Not attempted here because the kiosk agent has the menu read
path open and a data-model change under a live consumer is how two sessions
produce a broken merge.

### F5 — `multi_location` gates nothing. **[open]**

The flag is declared (0002), typed, mirrored into `brand_storefront`, and
surfaced in HQ's editor. Nothing in the tree branches on it. A flag that
gates nothing is worse than a missing flag: it reads as a supported feature in
the console and in `brand.json`, and an owner who turns it on gets no
behaviour and no error.

Either it gates something real (a location switcher in the customer app, the
locations list in HQ, per-location board routing) or it should be removed.
Cannot be decided unilaterally — it is rule 5 vocabulary.

## Correctness and optimisation

- **O1 — `in_app_share` measured the opposite of its name. [FIXED — 0036]**
  Covered in the previous section. The headline number on the franchise
  dashboard fell as franchisees adopted the shop's own hardware.
- **O2 — `prep_batches.service_date` has no trigger. [open]**
  `orders.service_date` is stamped in the *location's* timezone by 0023's
  trigger; `prep_batches.service_date` is a bare `date` with no equivalent.
  Reported by `coffee-story-e4`, who lost CI time to it: asserting against
  Postgres `current_date` (UTC) at 01:22 UTC was still the previous evening in
  Denver. Per-location anything is exactly where this bites, so it is a
  franchise concern and not just a test annoyance.
- **O3 — `locations` published every column, and 0039 made that expensive.
  [FIXED — 0039]** `locations_select` is `using (true)`, correctly: a shop's
  address and hours must be readable before anyone signs in. RLS is row-level,
  so that policy exposed every *column* of every row to `anon`. Minor while
  the table held storefront fields plus an opaque payments FK — and then 0039,
  in this same pass, put each franchisee's negotiated commission on it. A
  franchise platform publishing what every franchisee pays, to every other
  franchisee and to anyone holding the anon key that ships in the app bundle,
  is not a privacy footnote; it is the commercial relationship.

  Fixed column-level rather than with a new view, because the rows really are
  public and only four columns are not: `revoke select (fee_bps,
  fee_bps_tier2, tier_threshold_cents, square_connection_id)`. The storefront
  read keeps working; the one caller that asked for `*` now names its columns,
  since a client asking for a revoked column gets an error rather than a
  redacted row. The engine reads them as the service role, which no client
  grant constrains.

  Pinned by a test, because the failure mode is a one-line mistake with no
  symptom: a later bare `grant select on public.locations` replaces the column
  set and silently restores everything.
- **O4 — the integration suite skips rather than fails without a stack.**
  `pnpm verify` returns green without exercising RLS at all. Carried forward;
  a pre-promotion check should name the suites that did not run.
- **O5 — dead code cannot be swept mechanically in this repo.** 322 exports
  have no non-test consumer; 27 are runtime values referenced nowhere. Every
  one of the nine in `workspace-ui.tsx` is referenced by operator screens on
  five or six other branches. `coffee-story-e4` independently confirmed three
  more that look dead and are not (`fetchPrepBoard`,
  `productCutoutFrame`'s `tile`/`hero`, `ProductMediaCatalog.remote`). A sweep
  needs `git grep` across `refs/remotes/*` before anything is deleted.
- **O6 — `packages/domain` is becoming a bag.** It now holds cart, tax,
  totals, dates, sizes, fulfillment, feed, search, kiosk-flow, guest-label,
  order-channel, order-snapshot, stored-value, product-media, board-display
  and qr. Several are surface-specific rather than domain-wide. Worth
  splitting, but not while three sessions are adding to it.

## What this pass changed

0039 (per-location fee terms + the franchisee guard), 0040 (the column revoke),
0035 (the two loyalty
ladders), 0036 (the owned-channel metric), plus `resolveFeeConfig` moving into
the engine. Everything else above is specified and left, with the reason
recorded per item.

**Historical verification note for this pass:** the local Supabase stack lost its
database container mid-pass, and port 54322 is now published by an unrelated
project's stack, so `supabase start` could not restore it without stopping
another project's database or editing shared config — neither of which is
mine to do. 0035 and 0036 were executed against the real database before it
went; **0039 and 0040 are verified statically only** — typecheck, tests, and the SQL
reviewed against the same patterns 0031 and 0033 established. The current CI
gate now creates a disposable hosted branch, executes every migration there,
runs database lint and RLS integration tests, and deletes the branch afterward.

## Production wiring — 2026-08-23

"Nothing running locally" checked end to end, not assumed.

**Nothing is hardcoded to a local stack.** No `.env` file is tracked or even
present on disk — only `.env.example`. Every `localhost` / `127.0.0.1` string
in shipping source is inside a *validator* (`runtime-config.ts`,
`packages/data/src/config.ts`, `packages/api-client/src/client.ts`,
`auth-links.ts`) that permits a local host only in development and enforces
HTTPS otherwise. The rest are CI workflows, test harnesses and
`supabase/config.toml`, which is the local dev stack's own config and belongs
there.

Two things were genuinely wrong, both on the surface I own.

### An unpaired production wall would have shown invented guests. **[FIXED]**

`loadBoard` fell back to fixtures whenever no client could be built. On a
laptop that is the whole point of them. On a wall in a shop it is a liability:
a production display with no device token would have drawn "Marguerite
Vandersteen" and five other fabricated names on a screen the room can read,
indistinguishable from the real queue except that nobody present is holding
those orders. Staff would have no reason to look twice.

A production build now never invents anyone. With no token it renders an
honest unpaired screen addressed to staff rather than guests — a guest can do
nothing about it, and the person who can needs to know what to do. A trade
stand opts in with `DISPLAY_DEMO_MODE=1`; any other value fails safe. A
*degraded* read on a paired screen no longer falls back to fixtures either.

Verified by building with `NODE_ENV=production`, serving it with a Supabase
URL and no device token, and reading the rendered HTML: "This screen is not
paired / Pair it from the console under Locations → Devices."

### `DISPLAY_DEVICE_TOKEN` was documented nowhere. **[FIXED]**

It became required earlier in this pass and appeared in no `.env.example`, so
a deployment had no way to learn it exists. Added to the root reference and to
a new `apps/display/.env.example`, which states plainly why the anon key is
not a substitute: `board_tickets` is gated on `app.can_read_board` (0033), the
anon key satisfies it for nothing, and the resulting read returns zero rows
that the board would label "Live".

A test now asserts every `process.env` name the app reads appears in its own
`.env.example`, so the next variable cannot be added silently.

### Still required from the operator, not from the code

The platform is configured entirely by environment; nothing here can supply
these, and each is named in `.env.example` with what it is for:

- A real Supabase project — `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `SUPABASE_DB_URL`, plus the browser-safe pair for HQ.
- Square application credentials, `SQUARE_TOKEN_KEY` (32 bytes, base64), and
  the webhook signature key and URL.
- One `DISPLAY_DEVICE_TOKEN` per paired screen, issued from the console.
- Sentry, Twilio/Resend and Checkly, each optional and each DSN-gated.

The migrations in `supabase/migrations/` are the schema of record and CI
applies them to a hosted stack; `supabase/config.toml` configures only the
local development stack and has no bearing on a deployed project.

## Correction — 0040 broke a page I had already been shown

`apps/hq/lib/data.ts` `loadLocations()` selected `square_connection_id` and
runs on `serverClient()` — a signed-in user, role `authenticated`. A
column-level revoke does not redact; it fails the entire query with
`permission denied for column`. So 0040 would have taken the HQ Locations page
down for every brand owner.

The part worth recording is not the bug, it is how it got past. When I went
looking for callers I ran a grep for `from('locations')` and **that exact line
was in the output**, column list and all. I read it, decided the risk was
`select('*')`, fixed the one caller in `packages/data/src/brand.ts`, and moved
on — never checking the explicit column lists for the columns I was about to
revoke. I then wrote in the commit message that I had fixed "the one caller".
The evidence was on screen and I had already formed the conclusion.

Found and fixed on main by the kiosk session (`9a89282`): connectivity now
comes from `location_square_status` (a security-barrier view over
`square_connections`, of which 0031 revoked only the writes) and the
`locations` query no longer names a revoked column. They also added
`tests/consistency/src/revoked-columns.test.ts`, which reads every
column-level revoke out of the migrations and fails if any app source names
one in a `.select()` on that table — keyed by *table and column*, because
keying on column alone flagged `brands.fee_bps` and a guard that cries wolf
gets ignored within a week.

`apps/hq/lib/square-runtime.ts` is allow-listed there: it selects all three
fee columns from `locations` but takes its client as a parameter and every
caller passes the service role. That allowlist is load-bearing — routing it
through a user session would break silently.

## Open decision — `kiosk_receipts` is dead schema I introduced

0034 (mine) dropped 0023's `orders_kiosk_select` and replaced it with a narrow
view. 0038 (theirs) drops that policy again and re-creates it scoped to
`device_id = app.jwt_device_id()`. Theirs is the better containment — "the
orders this device took" beats "orders at this location in the last hour", and
they have the pairing infrastructure to support it. Nothing reads my view.

But their policy sits on `orders`, so it grants every column of the matching
rows: a kiosk token can read `customer_id`, `totals`, `note` and
`square_payment_id` for the orders that till created. Far narrower than 0023,
and still broader than a receipt needs — on a tablet bolted to a counter in a
public room. It is the same argument that made `board_tickets` a projection
rather than a policy: the projection is the privilege.

**Resolved, and the answer was none of the three.** The kiosk reads nothing at
all: `apps/kiosk/src` has no Supabase client, no `@platform/data` import and no
`.from('orders')`. Its two network calls are `placeOrder` and the pairing
fetch, the ticket arrives on the placeOrder response, and even the timeout path
needs no read — a retry with the same Idempotency-Key returns the original
order. There was never a read to authorise.

So 0041 (theirs) drops the policy outright rather than narrowing it, and 0042
(mine) drops `kiosk_receipts` and its now-orphaned `app.can_read_receipt`. Both
of us had been designing containment for a reader that does not exist. Deleting
rather than keeping it "in case": an unread view is still a grant to `anon` and
`authenticated`, still has to be reasoned about by whoever audits grants next,
and is three lines to re-add — with `orders.device_id` in it, which stays as
attribution and would scope such a read to one till rather than a location.

### The rule both of us needed

Their 0038 re-created a policy 0034 had deliberately dropped, because it read
0023 and never checked whether anything later had removed it. My guard then
made the mirror-image mistake: it required a write revoke for `kiosk_receipts`
after 0042 dropped it, asserting against a view that was no longer there.

**In an append-only migration set, the state of a thing is the last statement
that names it — never the presence of a pattern anywhere in the file.** A
`drop` grepped for passes while a later `create` puts it back; a `create`
grepped for passes while a later `drop` removes it. Both guards now walk the
sequence and take the last verb:

- `surfaces.test.ts` asserts the last statement touching `orders_kiosk_select`
  and `kiosk_receipts` is a `drop`, and separately that no Supabase client
  exists in `apps/kiosk/src` — the structural reason the first two are safe.
- `invariants.test.ts` builds its view list from the last verb per name, so a
  dropped view is not required to carry a revoke it cannot have.

Verified by probe rather than by reading: a view added with no write revoke
fails both view assertions, and removing it returns the suite to green.

## The kiosk menu read — settled on evidence, not preference

My `surfaces.test.ts` guard asserted no `createClient(` anywhere in
`apps/kiosk/src`. The kiosk session flagged that it was broader than the danger
it named and collided with two things already in the tree: `FIVE-SURFACES.md`
gives a kiosk token leave to read the menu, and 0027 put `menu_items`,
`menu_categories` and `drops` in the Realtime publication precisely so a change
made once reaches every kiosk. They offered to build a server projection
instead rather than edit my test under me.

The deciding fact is in the RLS, not in either of our preferences:
`menu_items_select` admits **anyone** once a menu is published — no device
claim required. So a kiosk reading the menu directly obtains nothing a lifted
tablet could not already get with the anon key that ships in the customer
bundle. The client was never the risk. What it reads is.

So the guard is narrowed to what is read, and as an **allowlist**: `menus`,
`menu_categories`, `menu_items`, `menu_item_options`, `drops`, `locations`,
`brand_storefront`, `devices`. A denylist is always one migration behind
whoever adds the next relation holding guest data, and this surface is a
tablet bolted to a counter in a public room.

Verified in both directions rather than one: a probe reading `customers` fails
with the file and relation named; a probe reading `menu_items` passes. A guard
only checked for firing is half-checked — the failure that matters most is the
one that blocks legitimate work and gets deleted.

This unblocks the largest remaining franchise defect on that surface: the
kiosk ships a compiled 181-line catalog, so today a second tenant cannot
change a price without a store release, and an 86 reaches no screen.

### The guard went vacuous, and the fix has a stated limit

Routing the kiosk's menu read through `@platform/data` — the right call, since
it means one assembly of the tree rather than a fourth — left zero `.from(`
calls in `apps/kiosk/src`. The allowlist then inspected nothing and would have
passed just as happily on `fetchCustomerOrders`. A guard that is green because
it found nothing to check is the failure mode both of us have now hit twice.

The kiosk session extended it to attribute a `@platform/data` module's
relations to every export from that module, and it failed immediately on their
own work: `subscribeToMenu` had been placed in `realtime.ts` beside
`subscribeToOrderStatus` and `subscribeToLocationOrders`, which read `orders`.
They split the module rather than widen the list, which is the right response
to an over-approximating guard.

Two hardenings and one honest limit from this side:

- **Namespace imports are now refused.** `import * as data from
  '@platform/data'` defeats the clause parsing entirely — the check would pass
  while the read happened. Named imports are a precondition for the guard
  seeing anything, so they are required rather than worked around.
- **Probe-verified in three directions**, not one: a namespace import fails, a
  named import of `fetchCustomerOrders` fails naming the relation, and a named
  import of `fetchMenuTree` passes.
- **It follows one hop, and says so.** A kiosk file importing a *local* module
  that itself imports `@platform/data` is not attributed. This is a speed bump
  against accident, not a proof against intent; closing it needs a module-graph
  walk. The direct and one-hop paths are the ones anyone reaches for by
  accident, which is what a guard on this surface is for.
