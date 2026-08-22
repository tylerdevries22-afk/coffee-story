# Runbook

## Deploy

**HQ (Vercel or any Node host):**
1. `pnpm install && pnpm --filter @platform/hq build`
2. Environment: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SQUARE_APP_ID`,
   `SQUARE_APP_SECRET`, `SQUARE_ENV`, `SQUARE_TOKEN_KEY`,
   `SQUARE_WEBHOOK_SIGNATURE_KEY`, `SQUARE_WEBHOOK_URL` (the exact public
   webhook URL — the signature covers it), plus the notification transports
   (`TWILIO_*`, `RESEND_*`). Service-role and Square secrets are server-only:
   never `NEXT_PUBLIC_*`, never in an app bundle.
3. Point the Square application's webhook subscription at
   `/api/webhooks/square` and its OAuth redirect at `/api/square/callback`.

**Database:** `cd packages/schema && SUPABASE_DB_URL=... ./migrate.sh`
(plain psql, filename order). Then `pnpm --filter @platform/schema seed` for
the demo brand, `npx tsx scripts/migrate-legacy.ts` for the legacy backfill.

**Customer app:** `pnpm onboard --tenant <slug> --apply`, then from
`apps/customer`: `TENANT=<slug> npx eas-cli build --platform ios --profile
production`. Expo Go preview publishes from CI on merge (EXPO_TOKEN secret).

**Operator app:** built once, not per tenant, from `apps/operator`; needs its
own EAS project + real bundle id before first submission (currently
placeholder `com.example.operator`).

**Jobs:** run `npx tsx scripts/run-jobs.ts` every minute from cron, or wrap
it in a thin authenticated route and use the host's scheduler.

## Rotate Square tokens

Per-location access tokens refresh themselves via
`refreshOAuthToken` before expiry (see `square_connections.expires_at`).
To rotate the **encryption key** (`SQUARE_TOKEN_KEY`):
1. Generate 32 fresh bytes: `openssl rand -base64 32`.
2. With both keys available, decrypt every `square_connections` row with the
   old key and re-encrypt with the new (a ten-line script over
   `decryptToken`/`encryptToken`; blobs are versioned `v1:`).
3. Swap the env var, redeploy, delete the old key. If a token fails to
   decrypt after rotation, disconnect and reconnect that location's Square —
   reconnection is always safe.
To revoke a location outright: `revokeOAuthToken`, delete the row, clear
`locations.square_connection_id`.

## Add a location

HQ → Onboarding → Add a location (or insert the row), then Locations →
Connect Square on the new row, then confirm hours and `ordering_paused =
false`. Multi-location pricing tiers apply per location automatically.

## Incidents

**Orders not appearing on the board:** check Supabase Realtime status first;
the board also refetches on interval. Then check webhook deliveries in the
Square dashboard — 401s mean the signature key or `SQUARE_WEBHOOK_URL`
drifted from what Square is calling.

**Payments failing:** the engine's errors carry Square's response body.
Check the location's token expiry; a 401 from Square → refresh or reconnect
the location. Never retry a payment blindly — idempotency keys make retries
safe *only* with the same reference id.

**Duplicate webhook processing suspected:** it cannot double-apply — the
`square_event_id` unique constraint drops replays. Verify by counting
`order_events` rows per event id (always ≤ 1).

**A bad merge shipped to Expo Go:** publish the previous good commit to the
`preview` channel (`pnpm --filter @platform/customer run publish:preview:all`
from that commit); clients pick it up on next launch.

**Kill switch:** Menu control → Pause ordering (per location) stops new
orders while the board keeps serving what's already paid.
