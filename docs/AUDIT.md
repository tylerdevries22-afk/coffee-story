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
