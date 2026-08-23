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

## Launching both apps on iOS simulators

`./scripts/launch-simulators.sh` (macOS only) boots a simulator per app and
opens each app on its own device. Three bugs were found in it by running the
same sequence on a GitHub macOS runner, and all three are fixed:

- **Boot before opening.** Opening a deep link on a device that is still
  booting is what makes `expo start --ios` report "Expo crashed". The script
  waits on `simctl bootstatus` for both devices first.
- **`simctl openurl` blocks rather than failing.** It is documented as
  returning code 60 on a busy CoreSimulator -- the failure @expo/cli reports as
  "Expo crashed" -- but it can also simply never return, and a retry loop
  around a call that never returns is a hang, not a retry. Each attempt is now
  bounded by hand (macOS has no GNU `timeout`); verified against a stub that
  never exits, 152s instead of 600s+.
- **Expo Go must be launched by bundle id before any URL is opened on it.**
  LaunchServices registers an app's URL schemes asynchronously after install,
  so a freshly installed Expo Go can be present while nothing yet owns
  `exp://`.

The address is `127.0.0.1`. An iOS simulator shares the host's network stack,
so loopback inside the device *is* the host's loopback, and Metro's default
binding is right. A LAN address plus `--host lan` was tried and reverted: it is
what a *physical* device on the same Wi-Fi needs, and on a runner it binds
Metro to a NAT'd virtual interface instead. If you are pointing a real iPhone
at this, that is when you want `--host lan`.

### What CI can and cannot prove

`.github/workflows/simulators.yml` runs the same sequence on a macOS runner,
label-gated (`simulators`) so it never runs on a push. It reliably reaches:
both named simulators created and booted, both Metro servers serving, Expo Go
installed and launched on each device, and each app opened by deep link.

What twenty-five runs of it eventually found was a real defect in this repo,
not a runner problem: **the dev server could not serve a bundle to Expo Go at
all**, so no app was ever going to render on a simulator, here or on a Mac.

`.npmrc` sets `node-linker=hoisted` because Metro wants a flat `node_modules`,
which puts every dependency at the workspace root and leaves
`apps/<name>/node_modules` holding only the `@platform` links. `metro.config.js`
then sets `EXPO_NO_METRO_WORKSPACE_ROOT=1` (it has to -- without it the web
static-render pass dies with "Unexpectedly escaped traversal"), which pins
Metro's server root to the app directory. Metro resolves the manifest `main` as
a path relative to that root, so `"main": "expo-router/entry"` became
`./node_modules/expo-router/entry` inside `apps/customer` -- which does not
exist under a hoisted install. Every bundle request 404'd with an
`UnableToResolveError` and Expo Go showed its error dialog.

The fix is an `index.js` in each app that does `import 'expo-router/entry'`,
with `"main": "index.js"`. A real file resolves from the server root, and the
bare specifier inside it resolves the ordinary way, walking up to the hoisted
copy. Reproduced and verified on Linux, where `expo start` behaves identically:

    404, UnableToResolveError   ->   200, 23,503,498 bytes of JavaScript

**Ask the manifest which bundle to check, rather than guessing.** Three
different bundle URLs were probed across those runs and the reasoning about
which one mattered was wrong every time. The server will just tell you:

    curl -s -H 'Accept: multipart/mixed' -H 'Expo-Platform: ios' \
      -H 'expo-runtime-version: exposdk:54.0.0' http://127.0.0.1:8081/

`launchAsset.url` in the returned manifest is the one Expo Go loads. For this
project it is `/index.bundle` with `transform.engine=hermes`,
`transform.bytecode=1`, `transform.routerRoot=src%2Fapp` and
`unstable_transformProfile=hermes-stable` -- 13.5MB, and it is the URL whose
`UnableToResolveError: ./index` was printed in every failing log and dismissed
each time as "the wrong probe". It was not the wrong probe. It was the bug.

Both iOS and web exports still pass, so the flag stays where it is.

Two diagnostics hid this for the whole run. The bundle probe tried three URLs
and printed the LAST one's error against the FIRST one's url, and the last was
always `/index.bundle`, which fails by design on an expo-router app. And the
device-log probe called a helper defined in a different step, so it reported
"no device log captured" for reasons unrelated to the device. Read the failures
in this order before concluding anything about the apps:

1. **CoreSimulator stops answering `simctl`.** Not a slow call -- `launch`,
   `get_app_container`, anything, never returns. The job reports this
   explicitly now, because it looks identical to an app that failed to render
   and it is not the repo's problem. Mitigated by shutting down whatever device
   the runner image left booted and by preferring an iPad Air to the 12.9-inch
   Pro, but two booted devices plus two Metro bundlers is near what a shared
   runner will carry.
2. **A step's own retries can eat its budget.** Six 45-second warm-up attempts
   is 300s of a 360s ceiling, so the step that opens the apps was killed before
   it opened either one -- and the screenshots then showed Expo Go's own screen
   because that is all anything ever put on those devices. Every bound in this
   workflow has to be sized against the step ceiling, not chosen for comfort.
3. `expo start` exits on an auth prompt with no TTY (hence `EXPO_OFFLINE=1`),
   and a readiness check will happily pass against the corpse.
4. Metro's CI mode suppresses bundle logging, and unsetting `CI` to get it back
   crashes @expo/cli's file watcher.

The screenshots the job uploads are the honest proof, and a person has to look
at them: the artifact hosts are unreachable from an agent sandbox behind a
filtering proxy. `scripts/ci/screen-to-text.py` renders each one as a 56x20
brightness map into the job log for when nobody can.
