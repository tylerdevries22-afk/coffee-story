# Platform architecture rules

This repository is a multi-tenant, white-label ordering platform: a shared
engine and schema, a token-driven UI kit, and three front ends built per
tenant. These rules are binding for every change.

1. **Tenancy.** Every DB table carries `brand_id` and, where relevant,
   `location_id`; Supabase RLS enforces isolation using JWT claims
   (`brand_id`, `location_ids[]`, `role`). No query path may bypass RLS
   except server-side service-role code in `packages/engine`.
2. **Orders.** `orders` holds current state; `order_events` is append-only
   with a JSONB cart/payment snapshot per transition:
   `created → paid → in_progress → ready → picked_up | cancelled | refunded`.
   Webhook handlers are idempotent on the Square event id
   (`order_events.square_event_id UNIQUE`).
3. **Payments.** Square connects per location via OAuth; tokens are stored
   encrypted per location; every payment sets `app_fee_money` computed from
   `brand.fee_bps` with per-location volume tiering (fee_bps above
   `brand.tier_threshold_cents`/month drops to `brand.fee_bps_tier2`).
4. **Design tokens.** No component hard-codes a color, font, radius, spacing
   scale, or brand string. Everything reads design tokens hydrated from the
   tenant's brand config (`packages/ui`).
5. **Feature flags** live on the brand row: `drops`, `catering`, `delivery`,
   `multi_location`, `sms`, `stored_value`, `referrals`.
6. **Originality.** The name of any competitor never appears anywhere — code,
   comments, copy, assets, listings. The category is called the
   **"rotating-drop model."** Never ingest any competitor's assets, CSS, JS,
   or screenshots as a spec. The design system is original. See
   `docs/DO-NOT-RESEMBLE.md`.
7. **Three front ends.** `apps/customer` (white-label, one binary per brand
   via tenant config), `apps/operator` (one listing, tenant by login,
   iPad/KDS-first, landscape), `apps/hq` (Next.js web). Operator/admin
   functionality never ships inside the customer binary.
8. **Roles**: `platform_admin`, `brand_owner`, `location_manager`, `staff`.

## Layout

```
apps/customer/      Expo app a guest installs — one binary per brand
apps/operator/      Expo app for staff/managers — iPad-first, one listing
apps/hq/            Next.js console for brand owners + platform admin
packages/engine/    ordering, loyalty, drops, square, notifications, analytics
packages/ui/        token-driven components + tokens.ts + ThemeProvider
packages/schema/    Supabase migrations, RLS, generated types, seed
tenants/_template/  documented brand.json, menu.csv, assets/, app-store/
tenants/<slug>/     one folder per tenant (first: coffee-story)
scripts/            onboarding, migration, sandbox exercises
docs/               AUDIT, ARCHITECTURE, RUNBOOK, BUILD-REPORT, legal/
.claude/skills/     onboard-tenant, launch-drop, weekly-report, pitch-pack,
                    audit-originality
```

## Coding conventions (match the existing codebase)

- TypeScript strict everywhere; ESLint with `--max-warnings=0`.
- **Money is integer cents.** Never float dollars. `formatMoney` and friends
  live in the shared money module; per-row tax rounding (each row rounded on
  its own, the total is the sum of rows) so printed rows always equal totals.
- Tests are `node:test` run through `tsx` against `src/**/*.test.ts` —
  plain `.ts`, no component renderer. Keep domain modules asset-free so tests
  can reach them; view-layer helpers that touch assets live beside screens.
- Comments explain *why*, not *what*; sentence case; no decoration.
- Design: `docs/DESIGN.md` — one language, three expressions. Warm tenant
  surfaces in the apps, executive dark in HQ, same tokens/type/voice family.
- Accessibility: use the `a11y-state` helpers so `accessibilityState` and the
  matching `aria-*` attribute are both emitted (react-native-web drops
  `accessibilityState` on `Pressable`).
- Icons: every SF Symbol passed to `AppIcon` needs an entry in the icon map
  or it renders a fallback dot on Android and web.
- **Expo SDK 54 is pinned** in both Expo apps — see `AGENTS.md` for why
  (App Store Expo Go embeds 54) and for the Fabric animation constraint
  (animate wrapper `View`s, never a `Text` inside them).
- Commits state what was built and any assumptions made. Never commit
  secrets; every `EXPO_PUBLIC_*` value is publicly readable in the bundle.
- Transitional note: `apps/customer` and `apps/operator` still carry
  duplicated legacy infrastructure (theme, primitives, lib) from the split of
  the original single app. New shared code goes in `packages/*`; when you
  touch a duplicated module, prefer promoting it to a package over editing
  both copies.

## How to onboard a tenant

1. Copy `tenants/_template/` to `tenants/<slug>/`; fill `brand.json`
   (identity, palette, type pairing, feature flags, copy dictionary, fees)
   and `menu.csv`; drop `assets/logo.svg` and hero imagery.
2. Run `pnpm onboard --tenant <slug>` (idempotent): creates the brand +
   location rows, seeds the menu, generates icons/splash, writes the Expo
   config (bundle id, name, scheme), and emits app-store listing copy and a
   screenshots checklist to `tenants/<slug>/app-store/`.
3. Connect Square per location from the HQ console (Locations → Connect
   Square); tokens are stored encrypted server-side, never in an app bundle.
4. Build the customer binary for the tenant with EAS from `apps/customer`
   using the generated config; the operator app needs no per-tenant build —
   tenancy is by login.
5. Verify with the `audit-originality` skill before submitting a listing.

See `docs/RUNBOOK.md` for deploys, token rotation, and incident steps.
