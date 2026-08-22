# Multi-tenant ordering platform

A white-label ordering platform in a pnpm monorepo: a shared engine and
schema, a token-driven UI kit, and three front ends. The first tenant is
Coffee Story, a specialty coffee shop at 2222 S Havana St Unit A1, Aurora CO
80014. Architecture rules live in `CLAUDE.md`; the platform audit that shaped
this layout is `docs/AUDIT.md`.

```
apps/customer      guest app (Expo SDK 54) — one binary per brand
apps/operator      staff/manager app (Expo SDK 54) — one listing, iPad-first
apps/hq            brand-owner + platform console (Next.js)
packages/engine    ordering, loyalty, drops, square, notifications, analytics
packages/ui        design tokens + ThemeProvider + component kit
packages/schema    Supabase migrations, RLS, generated types, seed
tenants/<slug>     brand config, menu, assets, app-store listing material
```

Run everything from the root: `pnpm install`, then `pnpm verify` (lint,
typecheck, tests, and both app bundles per workspace).

## The customer app (`apps/customer`)

Expo SDK 54, React Native 0.81, expo-router v6. What a guest sees today:

- **Order** — the whole ordering journey: pickup or delivery, which shop, the
  name and pickup window, the full menu by category, an item sheet with sizes
  and customizations, a bag, an optional note, and a checkout with the tax
  broken out per Aurora authority, a tip, and the Beans the order earns.
- **Home** — a video hero, the house favourites, and the menu by category.
- **Gift** — digital gift cards: buy, schedule delivery, claim, check a balance.
- **Rewards** — the tiered ladder (First Sip → Daily Ritual → House Regular →
  Coffee Legend) with a tilt-responsive glass cup drawn in Skia.
- **More** — orders, profile, preferences, messages, payments, location, FAQ,
  privacy.

## The operator app (`apps/operator`)

Today, calendar, guest directory, point of sale, and the admin pages behind
the More stack. Split out of the customer binary so operator functionality
never ships to a guest (rule 7); tenancy is by login, one listing.

## Modes

The app runs in one of two modes.

- **Demo** — everything works against a local dataset, with no backend at all.
  Payments are simulated.
- **Live** — Supabase for accounts, the web portal API for data, Stripe for
  payments.

A build that carries a complete set of live values — Supabase *and* Stripe —
opens in Live and shows the sign-in screen. Anything less opens in Demo, as
does Expo Go regardless of configuration: its native module set is fixed, so
card payments cannot run there, and a preview channel published with the
owner's Supabase variables would otherwise hand every reviewer who scans the QR
a sign-in screen for an account they do not have.

Either mode can be chosen from **More** at any time, and the setup-incomplete
screen offers Demo rather than stranding a half-configured build.

## Local development

```bash
cp .env.example .env      # fill in your own publishable keys
npm install
npm run verify            # lint, typecheck, tests, iOS bundle
npx expo start
```

`.env` is gitignored. Every `EXPO_PUBLIC_*` value is inlined into the
JavaScript bundle and publicly readable, so only publishable keys belong in it
— never a Supabase `service_role` key or a Stripe secret key.

`EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_ALLOWED_API_HOST` must name the same
host: `resolvePortalUrl` fails closed when they disagree.

## Quality gate

```bash
npm run verify
npm audit --omit=dev --audit-level=high
```

`.github/workflows/verify.yml` runs the same gate on every pull request, plus
a web bundle and a full-graph audit. On a merge to `main` it then publishes the
Expo Go demo to the preview channel and prints the QR in the run summary — see
`IPHONE_EXPO_GO_DEMO.md`.

`verify` runs `expo lint --max-warnings=0`, `tsc --noEmit`, the `node:test`
suite, and a full `expo export --platform ios`. The test suite covers the pure
modules — money, tax, the cart, the reward ladder, navigation state, the
storage migrations, and the WCAG contrast pins — because there is no component
renderer in this project. Logic that needs a test goes in a `.ts` module beside
the screen that uses it.

## Expo SDK

This repo is pinned to **SDK 54**, deliberately: the App Store build of Expo Go
on a physical iPhone embeds SDK 54 and cannot open an SDK 57 project. Read
https://docs.expo.dev/versions/v54.0.0/, not the current docs. See
`AGENTS.md` and `IPHONE_EXPO_GO_DEMO.md`.

Expo Go is a development client, not a distribution channel. Its native module
set is fixed, so Stripe card payments, Apple Pay and anything else custom-native
fall back to the simulated Demo path there. Real payments need an EAS
development build or TestFlight.

## Before launch

`PRODUCTION_SETUP.md` lists what the account owner still has to supply and what
is known not to work yet. Read it before promising a release date.
