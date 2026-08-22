# Tenant template

Copy this folder to `tenants/<slug>/` to onboard a brand. Populated in later
phases:

- `brand.json` — identity, palette, type pairing, feature flags, fees, and the
  copy dictionary (documented field-by-field in the template file)
- `menu.csv` — the menu the onboarding script seeds
- `assets/` — `logo.svg`, hero imagery; icons and splash are generated
- `app-store/` — generated listing copy and the screenshots checklist

`pnpm onboard --tenant <slug>` consumes this folder. See the root `CLAUDE.md`
("How to onboard a tenant").
