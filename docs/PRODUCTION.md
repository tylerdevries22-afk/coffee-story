# Production: how the platform runs live

The single current guide to running the platform against real
infrastructure. It supersedes `PRODUCTION_SETUP.md`, which described the
legacy appointments/Stripe plane that is being retired.

One deploy surface serves everything server-side: the HQ Next.js app hosts
the console **and** the platform API. The Expo apps and the HQ pages read
Supabase directly under RLS; every trusted write goes through the API.

---

## 1. The moving parts

| Piece | Lives | Deploys |
|---|---|---|
| Database, auth, realtime, storage | Supabase project | `supabase db push` applies `supabase/migrations/` |
| Platform API + HQ console | `apps/hq` (Next.js) | Vercel (`coffee-story-hq`) — owner-triggered only |
| Customer app | `apps/customer` (Expo) | EAS update/build, plus Vercel web (`coffee-story-customer`) |
| Operator app | `apps/operator` (Expo) | EAS update/build, plus Vercel web (`coffee-story-operator`) |
| Kiosk app | `apps/kiosk` (Expo) | EAS update/build, plus Vercel web (`coffee-story-kiosk`) |
| Pickup display | `apps/display` (Next.js) | Vercel (`coffee-story-display`), paired to a display device |
| Scheduled jobs | `/api/jobs/run` | Vercel Cron (`apps/hq/vercel.json`, every 5 min); drop/campaign transitions, training bootstrap, analytics rollups, and retention |

Nothing deploys on an unreviewed merge. CI verifies; an owner starts
`.github/workflows/deploy-hosted.yml` from GitHub Actions when a release is
approved. The workflow deploys HQ first, then injects its URL into the three
Expo web bundles, so those web apps never need a local API process. Native
Expo clients receive the same production API through the optional EAS OTA
job; native builds remain available when a runtime or store submission
requires one.

The repository contains a `vercel.json` in each Expo app as well as the two
Next apps. The Vercel project root directories and names are part of the
deployment contract, so a new checkout can deploy without a developer's
local `.vercel` directory.

### Hosted deployment checklist

Create these GitHub Actions secrets before the first run (values are never
committed): `VERCEL_TOKEN`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, and `CRON_SECRET`. Add
`SUPABASE_JWT_SECRET` to enable device pairing, then add
`DISPLAY_DEVICE_TOKEN` after pairing the production pickup screen. Add
`OPENAI_API_KEY` when the autonomous training research pipeline is enabled.
The workflow fails fast for the required values and skips optional
integrations rather than deploying a partially configured secret.

For the optional native OTA job, add `EXPO_TOKEN`,
`EXPO_PUBLIC_API_URL` (the deployed HQ URL), and
`EXPO_PUBLIC_ALLOWED_API_HOST` (the same URL's hostname). Public Supabase
values are also passed from the two Supabase secrets. EAS update channels are
runtime-compatible with the pinned Expo SDK 54 clients; a new native runtime
still requires an EAS build and store review.

## 2. The platform API (`apps/hq/app/api/*`)

Wire contract: `packages/api-client/src/contract.ts` — both the client and
the route handlers import the same types, so the two ends cannot drift.
Every write is a POST carrying `Authorization: Bearer <supabase access
token>` and an `Idempotency-Key`.

| Route | Does |
|---|---|
| `POST /api/orders` | Places an order. Prices are recomputed server-side from `menu_items` and the brand's tax table; a required idempotency key persists as `orders.client_key`, so a retry returns the first complete order. The row and initial event commit atomically. Tenders: `pay_at_pickup` stays `created` until staff records collection, while `square_link` returns a Square-hosted `checkoutUrl` and stays `created` until the payment webhook arrives. `square_link` answers 503 unless that location has a Square connection; `square_card` needs a native card SDK and answers 503 until store builds. |
| `POST /api/orders/cancel` | A guest calling off their own order, while the shop has not started it. Server-side because RLS lets only location staff write an `order_event`; the order must belong to the caller's own customer row. Answers 409 `cancel_unavailable` once it is `in_progress` or later, or when a card already charged (that needs a staff refund). Repeat calls answer 200 with `alreadyCancelled`. |
| `POST /api/orders/refund` | Staff only. Refunds through Square, then writes the `refunded` event. The one transition that is not a direct `order_events` insert: it needs the location's decrypted token, which no client may hold. Answers 409 `refund_unavailable` for an order no card paid for (refund those at the register). |
| `POST /api/loyalty/redeem` | Spends points on a reward from `brand_config.loyalty.rewards`. |
| `POST /api/push-tokens` | Registers a device push token (re-homes it if the device changes accounts). |
| `POST /api/profile` | Updates the guest's own contact card. |
| `DELETE /api/profile` | Deletes a guest account: anonymizes retained order history, revokes push tokens, and removes the GoTrue identity. Staff identities require administrator removal. |
| `POST /api/referrals` | Mints (or re-surfaces) the guest's referral code. |
| `POST /api/jobs/run` | The cron tick: drop windows open/close, due campaigns move on. Guarded by `CRON_SECRET`. |
| `POST /api/analytics/events` | Accepts up to 50 consent-safe events under a user or paired-device bearer. Tenancy and location come from verified credentials, browser origins are allowlisted, and the Supabase RPC commits a batch atomically with idempotency and rate limiting. |
| `GET /api/health` | Liveness + deployed version. |

Authentication: the API verifies the token with GoTrue, then reads the
tenancy claims (`brand_id`, `role`, `location_ids`) that the Custom Access
Token hook (`app.custom_access_token`, migration 0009) minted into it.
Guests get claims from their `customers` row, or bootstrap from
`user_metadata.brand_slug` on first sign-in; staff from `brand_users`.

Operator status transitions do NOT go through the API by design: the
operator app inserts `order_events` directly under RLS and the database
trigger is the state machine.

## 3. Brand configuration the server reads

`brands.brand_config` (seeded from `tenants/<slug>/brand.json`) carries two
sections the API depends on:

```jsonc
{
  "tax": {
    // Each authority on the brand's sales-tax licence. Rows are rounded
    // per-authority; the sum is the tax. Empty/absent = no tax charged.
    "jurisdictions": [
      { "id": "state", "label": "State Sales Tax", "rate": 0.029 }
    ]
  },
  "loyalty": {
    // What points buy. points_cost is integer points.
    "rewards": [
      { "slug": "free-drip", "name": "Free Drip Coffee", "points_cost": 500 }
    ]
  }
}
```

The owner must confirm the tax table against the shop's current sales-tax
licence before charging live money — the app charges exactly what this
config states.

## 4. Environment

Server (Vercel project for `apps/hq` — never in any app bundle):

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_JWT_SECRET` — the Supabase JWT signing secret; server-only and
  required for issuing or validating paired kiosk/display device tokens
- `CRON_SECRET` — any long random string; Vercel Cron sends it automatically
- `ANALYTICS_ALLOWED_ORIGINS` — exact comma-separated customer, operator, and
  kiosk web origins. Native requests carry no Origin; HQ same-origin requests
  are accepted automatically.
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (console sign-in)
- `NEXT_PUBLIC_DISPLAY_URL` (optional single-location pickup display origin;
  the tenant-safe HQ preview is used when this is unset)
- `NEXT_PUBLIC_WALL_URL` (optional hosted five-surface wall URL; local preview
  uses `http://localhost:4170/wall` when this is unset in development)
- `OPENAI_API_KEY`, `OPENAI_RESEARCH_MODEL` (required for autonomous tenant
  training research and release generation)
- `OPENAI_EVALUATION_MODEL` (optional; defaults to the research model)
- Square (when connected): `SQUARE_APP_ID`, `SQUARE_APP_SECRET`,
  `SQUARE_TOKEN_KEY` (AES-256-GCM key for stored OAuth tokens),
  `SQUARE_WEBHOOK_SIGNATURE_KEY`, `SQUARE_WEBHOOK_URL`, and `SQUARE_ENV`
  (`production` for live card acceptance; unset intentionally fails safe to
  `sandbox`)

Apps (EAS env — **every `EXPO_PUBLIC_*` value is world-readable in the
bundle**):

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — `sb_publishable_` key or legacy
  anon JWT; `packages/data` rejects anything with database authority
- `EXPO_PUBLIC_API_URL` + `EXPO_PUBLIC_ALLOWED_API_HOST` — the HQ
  deployment; API clients fail closed when they disagree. Required by all
  apps; the operator uses it for refunds and server-scored training quizzes

Pickup display (server environment; see `apps/display/.env.example`):

- `NEXT_PUBLIC_SUPABASE_URL`
- `DISPLAY_DEVICE_TOKEN` — one paired display JWT, never an anon key
- `HQ_ORIGIN` (optional custom HQ origin allowed to embed the display; defaults
  to `https://coffee-story-hq.vercel.app`)
- `SENTRY_DSN` plus the shared Sentry upload variables when monitoring is on

### Analytics and integrations

The hosted Coffee Story Supabase project is the sole system of record. Raw
analytics events are append-only, partitioned monthly, and retained for 90
days. Hourly and daily summaries are retained for 25 months. The Vercel cron
rebuilds the most recent 48 hours so delayed mobile batches are incorporated,
then records every retention run in the private schema. Analytics pages read
only tenant-scoped summaries and authoritative commerce records; browsers
cannot read raw events or ingestion dead letters.

Connector installations, capabilities, certifications, location mappings,
sync runs, health snapshots, and audit history are tenant-scoped Supabase
records. OAuth state, webhook inbox/outbox, idempotency records, and dead
letters live in `app_private`. Provider tokens are written to Supabase Vault;
public tables retain only opaque Vault UUIDs and non-sensitive account labels.
Only service-role Vercel routes can resolve or revoke a Vault secret.

The catalog is useful before provider setup. Missing credentials, sandbox
evidence, sender verification, or provider approval must remain a precise
`Setup required`, `Provider approval required`, or `Uncertified` state. Never
mark a connector healthy until its real sandbox certification is current.

Provider owner actions still required before activation:

- Google OAuth consent, incremental scopes, callback URLs, and Business
  Profile API approval.
- Square, Stripe, QuickBooks, and Plaid sandbox/production accounts; finance
  capabilities remain read-only except the existing Square payment adapter.
- Slack channel authorization, Twilio sender verification, and a verified
  Resend domain.
- Supabase, Vercel, and Sentry provider credentials with least-privilege read
  scopes.
- Production webhook URLs and signature secrets for every enabled provider.

No Docker or local daemon participates in production ingestion, aggregation,
connector synchronization, health checks, or retention.

## Turning on card payments

Everything below is code-complete and covered by
`tests/integration/src/square-tender.test.ts` (which drives a stand-in
Square over real HTTP). Activating it for a brand is configuration, not a
deploy:

1. Set `SQUARE_ENV=production` on the HQ deployment and confirm the app ID,
   secret, OAuth redirect, webhook subscription, and every connected location
   all belong to the production Square environment. Sandbox credentials cannot
   charge a real card. The code continues to default an omitted `SQUARE_ENV` to
   `sandbox` so a missing variable cannot silently activate live payments.
2. Set `SQUARE_APP_ID`, `SQUARE_APP_SECRET` and `SQUARE_TOKEN_KEY` on the
   HQ deployment. `SQUARE_TOKEN_KEY` is 32 random bytes, base64
   (`openssl rand -base64 32`) — losing it means every stored merchant
   token must be reconnected.
3. In the console: Locations → Connect Square, per location. The OAuth
   callback writes the encrypted tokens and the merchant's
   `square_location_id`.
4. Point Square's webhook at `/api/webhooks/square` and set
   `SQUARE_WEBHOOK_SIGNATURE_KEY`. The webhook is what marks an order paid;
   the guest returning from the checkout page never is.
5. The customer app then sends `tenderType: 'square_link'` and opens the
   `checkoutUrl` it gets back. Until a location is connected that tender
   answers 503, which is why the app keeps `pay_at_pickup` as its default.

`SQUARE_API_BASE` overrides Square's host. It exists for the integration
suite; leave it unset everywhere else.

The `service_role` key exists only in the Vercel server environment. Never
in Expo, never in this repository, never in `packages/data`.

## 5. Supabase project setup

1. Apply migrations: `supabase link --project-ref <ref> && supabase db push`
   (or the Supabase MCP `apply_migration` per file, in filename order).
2. Enable the auth hook: Authentication → Hooks → Custom Access Token →
   Postgres function `app.custom_access_token` (config.toml already states
   this for local stacks).
3. Sign-in: enable Email (OTP). Phone/Twilio is optional and can wait.
4. Seed the tenant: `pnpm onboard --tenant coffee-story` against the
   project, or run the seed SQL. Verify `brands.slug` matches the slug the
   apps carry in their tenant config.
5. First staff account: after the owner signs up, insert their
   `brand_users` row (`role = 'brand_owner'`); their next sign-in carries
   staff claims.
6. Seed the Coffee Story franchise template and its initial five-track,
   fifteen-lesson release with `pnpm training:seed-coffee-story --brand
   "Coffee Story"` from a trusted environment. The command is idempotent and
   requires `SUPABASE_URL` plus `SUPABASE_SERVICE_ROLE_KEY`; the service key
   must never be placed in an Expo or browser environment.

## 6. Verifying a deployment

- `GET /api/health` answers `{ ok: true, version }`; authenticated
  `GET /api/health?deep=1` also performs a bounded, retried database read.
- CI's `integration` job runs the full RLS/state-machine/route suite against
  a real Postgres on every PR (`tests/integration/`).
- The E2E loop (customer orders → operator advances → HQ reports) runs in CI
  from P7 onward and once against the hosted project at cutover.

## 7. Known gaps that remain true

- Tax table and legal copy need owner/counsel confirmation (§3, legal docs).
- Square is code-complete at the seams but inactive until the owner creates
  the developer account and connects a location (P8).
- Customer guest/pre-auth analytics are intentionally not issued a telemetry
  bearer yet. Authenticated customer behavior requires explicit user consent;
  essential crash monitoring remains in the monitoring pipeline. Do not claim
  guest funnel coverage until origin-bound short-lived session issuance is
  added and independently reviewed.
- Google, Stripe, QuickBooks, Plaid, Slack, Twilio, Resend, Supabase, Vercel,
  and Sentry adapters remain in truthful setup/approval states until their
  credentials and real provider sandbox certifications are supplied. Their
  catalog contracts, Vault storage, tenant isolation, health history, replay
  protection, and failure queues are deployed; provider authorization cannot
  be completed by source code alone.
- Campaign "send" records the transition with `delivered: 0` until a
  push/SMS provider is configured.
- **Loyalty redemption rate reads 0% on every dashboard, and that number is
  not measured.** The `location_daily_metrics` / `brand_daily_metrics` views
  compute it from `orders.loyalty_redeemed_points`, and nothing writes that
  column: redeeming a reward (`POST /api/loyalty/redeem`) spends points from
  the catalog and is not attached to an order at all — the order API refuses
  `loyaltyRedeemPoints` outright with "not live yet". So the figure on the HQ
  analytics page, in the CSV export and in the weekly owner email is a
  placeholder, not a measurement, and it will stay 0.0000 until order-level
  redemption is built. Do not quote it to a brand owner.
- **The rewards ladder the guest app shows is not the rate the engine pays.**
  `apps/customer/src/features/rewards/rules.ts` advertises 10/11/12/13 points
  per dollar across the four tiers, and the bag screen renders that number
  against the guest's real lifetime points. `recordLoyaltyEarn` always credits
  the flat `DEFAULT_EARN_RATE_PER_DOLLAR` of 10, so a "Coffee Legend" shown
  260 points on a $20 order is credited 200. Whether the fix is to honour the
  ladder in the engine or to stop advertising it is the owner's call: it
  changes what the brand owes its regulars. Until then the app over-promises.
- **The rewards ladder is the last thing in the guest app that is not
  tenant-derived.** `brand.json` carries `loyalty.rewards` (the redemption
  catalog) but no tiers, so the four tier names, thresholds, rates, blurbs and
  perks are compiled into `features/rewards/rules.ts`. Onboarding a brand that
  wants a different ladder needs a code change today, which is the one thing
  `tenants/<slug>/` exists to prevent. The fix is a promotion, not an edit:
  that file is byte-identical in both Expo apps, so changing it in place fails
  the drift guard by design. Everything downstream is already ready for it --
  every function takes the ladder as a parameter, `RewardTierName` is free text
  rather than a union, and `paletteForTier` falls back by ladder position (then
  by a stable name hash) so a renamed tier still gets a deliberate, distinct
  glass. Only the data source is missing.
- **`tests/e2e` "full loop" fails intermittently and the cause is NOT known.**
  It times out on `waitText('Order placed')` after Place Order, with the
  customer back on the Pickup Options step, no failed API calls and no console
  errors. The same commit's app code has passed this scenario and failed it, so
  it is not a regression in the code under test; it reproduces only in CI
  (`tests/e2e` needs Docker for the Supabase stack, so it cannot be run from an
  agent sandbox).

  Landing on Pickup Options points at one branch -- `order-screen.tsx` refusing
  a lapsed pickup window via `isWindowStillBookable` and calling
  `setStep('details')`, the only path there from `placeOrder`. But the evidence
  does not support it: in the last failure the picker was still offering
  `12:45 - 1:15 PM` while the driver's pinned clock read about 12:26, so the
  chosen window was ~19 minutes out against a 15-minute guard. Two "fixes"
  written on that assumption both made the suite worse (booking a slot far
  enough out puts the order in the board's Scheduled lane, where there is no
  Start button; re-picking from the menu's time pill leaves the sheet covering
  View bag) and were reverted.

  What would settle it: the dump records `document.body.innerText`, which omits
  input values and had not captured `payError`. Rendering the `payError` string
  into the failure dump would say in one line whether the window guard fired,
  and if so with what message.

  Worth knowing while looking: the picker and the guard share
  `PICKUP_LEAD_MINUTES` (15), and the picker starts at
  `roundUpToStep(now + 15min)`, so the earliest slot CAN be offered exactly on
  the bookable boundary. That is a genuine sharp edge for a real guest even
  though it does not explain these failures. Note too that the board holds
  anything past `SCHEDULED_LANE_MINUTES` (30) in a separate lane, so the
  earliest slot is the only one this scenario can use.
