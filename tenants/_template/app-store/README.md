# App store material

Generated output — do not edit by hand. `pnpm onboard --tenant <slug>`
regenerates everything here from `brand.json`:

- `listing.md` and `screenshots-checklist.md` — rewritten on every run.
- `generated/` — the icon, splash and adaptive art, built from
  `assets/logo.svg` (or `logo.png`) when one exists.

Edits made here are lost on the next onboarding run; change the brand file and
re-run instead.
