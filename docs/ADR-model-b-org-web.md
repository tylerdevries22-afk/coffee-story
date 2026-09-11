# ADR: Model B — one org web host with path-based surfaces

## Status
Accepted (2026-09-10). Incremental rollout for Coffee Story.

## Decision
Each franchise organization is served primarily from **one Vercel web host** (the HQ project) with path-based guest surfaces:

| Path | Surface |
| --- | --- |
| `/` | HQ console + platform API |
| `/customer` | Customer (Expo static, `experiments.baseUrl`) |
| `/kiosk` | Kiosk / POS (Expo static) |
| `/operator` | Operator (Expo static) |
| `/display/*` | Pickup display remains on `*-display` until Vercel Services can run two Next.js apps in one project |

Platform-wide organization switch retargets all five wall iframes using this URL map.

## Why not five projects
Five projects per franchise (`prefix-hq|customer|…`) scales poorly (5N projects, env sync, wall URL sprawl). Model B keeps per-org **Supabase/Doppler isolation** while collapsing web hosting.

## Why display is deferred
Display is a Next.js server app (device JWT proxy routes). Co-locating two Next apps requires Vercel Services. Until that lands, display keeps an isolated deployment and the org URL map points at it.

## Build
`scripts/build-org-web-statics.ts` exports the three Expo web apps with `EXPO_BASE_URL` and copies them into `apps/hq/public/{customer,kiosk,operator}`. HQ `next.config.ts` SPA-rewrites those prefixes. `apps/hq/vercel.json` runs the static export before `next build`.

## Auth
Unchanged franchise contract: HQ/wall staff session; customer guest JWT; kiosk/display device JWT; operator staff; Vercel Deployment Protection on non-production.

## Follow-ups
1. Promote display into the same project via Vercel Services.
2. Teach `deploy-hosted.yml` to deploy one org host project instead of a five-project matrix.
3. Alias `https://{tenant}.vercel.app` to the HQ host when ready.

## Orphan projects (soft retirement)
Existing `*-customer`, `*-kiosk`, and `*-operator` Vercel projects are **not deleted** automatically (destructive). New factory runs mint only `*-hq` and `*-display`. Stop deploying the three Expo web projects; keep them parked until DNS/traffic confirms Model B, then delete manually per org.
