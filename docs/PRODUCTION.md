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
| Platform API + HQ console | `apps/hq` (Next.js) | Vercel — owner-triggered only |
| Customer app | `apps/customer` (Expo) | EAS update/build — owner-triggered only |
| Operator app | `apps/operator` (Expo) | EAS update/build — owner-triggered only |
| Scheduled jobs | `/api/jobs/run` | Vercel Cron (`apps/hq/vercel.json`, every 5 min) |

Nothing deploys automatically. CI verifies; a deploy happens when the owner
says deploy.

## 2. The platform API (`apps/hq/app/api/*`)

Wire contract: `packages/api-client/src/contract.ts` — both the client and
the route handlers import the same types, so the two ends cannot drift.
Every write is a POST carrying `Authorization: Bearer <supabase access
token>` and an `Idempotency-Key`.

| Route | Does |
|---|---|
| `POST /api/orders` | Places an order. Prices are recomputed server-side from `menu_items` and the brand's tax table; the idempotency key persists as `orders.client_key`, so a retry returns the first order. Tenders: `pay_at_pickup` (asserts `paid` immediately — it settles at the register) and `square_link` (returns `checkoutUrl`, a Square-hosted page; the order stays `created` until the payment webhook arrives). `square_link` answers 503 unless that location has a Square connection; `square_card` needs a native card SDK and answers 503 until store builds. |
| `POST /api/orders/cancel` | A guest calling off their own order, while the shop has not started it. Server-side because RLS lets only location staff write an `order_event`; the order must belong to the caller's own customer row. Answers 409 `cancel_unavailable` once it is `in_progress` or later, or when a card already charged (that needs a staff refund). Repeat calls answer 200 with `alreadyCancelled`. |
| `POST /api/orders/refund` | Staff only. Refunds through Square, then writes the `refunded` event. The one transition that is not a direct `order_events` insert: it needs the location's decrypted token, which no client may hold. Answers 409 `refund_unavailable` for an order no card paid for (refund those at the register). |
| `POST /api/loyalty/redeem` | Spends points on a reward from `brand_config.loyalty.rewards`. |
| `POST /api/push-tokens` | Registers a device push token (re-homes it if the device changes accounts). |
| `POST /api/profile` | Updates the guest's own contact card. |
| `POST /api/referrals` | Mints (or re-surfaces) the guest's referral code. |
| `POST /api/jobs/run` | The cron tick: drop windows open/close, due campaigns move on. Guarded by `CRON_SECRET`. |
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
- `CRON_SECRET` — any long random string; Vercel Cron sends it automatically
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (console sign-in)
- Square (when connected): `SQUARE_APP_ID`, `SQUARE_APP_SECRET`,
  `SQUARE_TOKEN_KEY` (AES-256-GCM key for stored OAuth tokens),
  `SQUARE_WEBHOOK_SIGNATURE_KEY`, `SQUARE_WEBHOOK_URL`

Apps (EAS env — **every `EXPO_PUBLIC_*` value is world-readable in the
bundle**):

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — `sb_publishable_` key or legacy
  anon JWT; `packages/data` rejects anything with database authority
- `EXPO_PUBLIC_API_URL` + `EXPO_PUBLIC_ALLOWED_API_HOST` — the HQ
  deployment; the API client fails closed when they disagree. Required by
  the customer app; optional for the operator app, whose board works
  entirely under staff RLS — set it there to enable refunds

## Turning on card payments

Everything below is code-complete and covered by
`tests/integration/src/square-tender.test.ts` (which drives a stand-in
Square over real HTTP). Activating it for a brand is configuration, not a
deploy:

1. Set `SQUARE_APP_ID`, `SQUARE_APP_SECRET` and `SQUARE_TOKEN_KEY` on the
   HQ deployment. `SQUARE_TOKEN_KEY` is 32 random bytes, base64
   (`openssl rand -base64 32`) — losing it means every stored merchant
   token must be reconnected.
2. In the console: Locations → Connect Square, per location. The OAuth
   callback writes the encrypted tokens and the merchant's
   `square_location_id`.
3. Point Square's webhook at `/api/webhooks/square` and set
   `SQUARE_WEBHOOK_SIGNATURE_KEY`. The webhook is what marks an order paid;
   the guest returning from the checkout page never is.
4. The customer app then sends `tenderType: 'square_link'` and opens the
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

## 6. Verifying a deployment

- `GET /api/health` answers `{ ok: true, version }`.
- CI's `integration` job runs the full RLS/state-machine/route suite against
  a real Postgres on every PR (`tests/integration/`).
- The E2E loop (customer orders → operator advances → HQ reports) runs in CI
  from P7 onward and once against the hosted project at cutover.

## 7. Known gaps that remain true

- Tax table and legal copy need owner/counsel confirmation (§3, legal docs).
- Square is code-complete at the seams but inactive until the owner creates
  the developer account and connects a location (P8).
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
