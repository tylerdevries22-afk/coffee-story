---
name: onboard-tenant
description: Onboard a new brand onto the platform from raw materials (logo, menu, Instagram handle, Square OAuth) through brand.json, menu.csv, seeding, and a listing draft.
---

# Onboard a tenant

Inputs to collect from the requester before starting: a logo (SVG preferred,
PNG accepted), the menu (photo, PDF, or CSV), the brand's Instagram handle,
and confirmation that they can complete Square OAuth for each location.

## Steps

1. **Derive an original identity from the brand's own assets.** Sample the
   palette from their logo and photography (their Instagram grid is the best
   corpus): one deep primary, one warm surface, one accent with real contrast.
   Pick a type pairing that matches their voice (a display face + a workhorse
   body). Deriving the identity from the tenant's own material is the point —
   it is what makes the app look like *them*, and it is a better result than
   borrowing, not just a safer one. `docs/DO-NOT-RESEMBLE.md` has the guidance
   if a judgement call comes up.
2. **Write the tenant folder.** Copy `tenants/_template/` to
   `tenants/<slug>/`. Fill `brand.json`: identity (slug, name, reverse-DNS
   bundleId, scheme), the tokens from step 1 (every color must pass AA against
   its surface — check textPrimary/textMuted/success/warning/danger), the copy
   dictionary in the brand's own voice (appName, pointsName — ask what they
   call their rewards), rule-5 feature flags, and the fee terms from the
   signed agreement (never guess fees).
3. **Transcribe the menu into `menu.csv`.** Columns
   `slug,name,category,description,base_price_cents,sizes`; prices in integer
   cents, sizes as `12:450|16:525`. Run the parser before moving on:
   `npx tsx -e "…parseMenuCsv…"` or just run onboarding — it validates first
   and prints line-numbered errors.
4. **Drop the artwork** into `tenants/<slug>/assets/logo.svg` (or `.png`).
5. **Run `pnpm onboard --tenant <slug>`.** With `SUPABASE_URL` +
   `SUPABASE_SERVICE_ROLE_KEY` set it seeds brand, location, and menu rows;
   it always generates icons/splash and the app-store listing draft. Add
   `--apply` for every tenant you intend to build. It is additive: it writes
   `apps/<app>/src/tenants/<slug>/` and regenerates the barrel, so applying this
   tenant leaves every previously applied one intact. (It used to overwrite one
   shared file, which is why this step once said to apply sparingly.)
6. **Build it.** `EXPO_PUBLIC_TENANT=<slug>` from `apps/customer` or
   `apps/kiosk` names which applied tenant the binary is for. With several
   applied it is required, and omitting it throws rather than picking one.
7. **Square.** From the HQ console → Locations → Connect Square for each
   location; verify the connection shows Connected before any test order.
8. **Verify.** Run the `audit-originality` skill on the themed app before any
   listing material leaves the building.

Idempotent: re-run onboarding freely after edits.
