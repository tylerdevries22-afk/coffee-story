# Production setup

What the account owner has to supply, and what is known not to work yet.

Nothing in this file is a guess. Where a value is unknown it says so rather
than naming one.

---

## 0. Known gaps — read these first

| # | Gap | Where | What it blocks |
|---|---|---|---|
| 1 | **There is no order endpoint on the server.** The client checkout is complete and works end to end in Demo. In Live it refuses and says so; it does not fake a charge. | `screens/client/order-screen.tsx` `placeOrder` | Live ordering. The portal API (`lib/mobile-api.ts`) exposes appointment-shaped routes inherited from the previous business — `createBookingPayment`, `availability`, `bookingCatalog` — and nothing that accepts a bag of menu lines. A `POST /api/orders` taking lines, fulfilment, window, note, tip and an idempotency key is the missing piece. |
| 2 | **`runtimeVersion` is `exposdk:54.0.0`.** That identifier means "the Expo Go runtime". This build links Stripe, Skia, `expo-glass-effect`, `expo-video` and `expo-sensors`, which Expo Go does not have, and all three EAS channels share the one runtime id — so a preview binary and a production binary are runtime-identical and re-pointing a channel would serve preview JS to store users. | `app.json`, `eas.json` | A real store release. Switching to `{"policy": "fingerprint"}` is the fix, and it ends the Expo Go demo path — which is currently the only working distribution channel, because the Apple Developer credentials are still outstanding. **This is a business decision, not a code change; it has deliberately been left alone.** |
| 3 | **Tax rates are stated in one place and have not been verified against the shop's licence.** 2.90% state + 3.75% City of Aurora + 1.00% RTD + 0.25% Arapahoe County = 7.90%. | `features/tax.ts` | Charging live money. Confirm with the shop's accountant. The mobile register and the client checkout both read this module; the **web** register at `lib/booking/pos-totals.ts` is still on a flat 8% and has to be brought onto the same table. |
| 4 | **The Vercel host is unconfirmed.** `coffee-story-healing-oasis.vercel.app` is a Vercel project slug carried over from the rebrand. It is left exactly as deployed rather than replaced with a guess. | `lib/portal-url.ts`, `.env.example` | Every outbound portal link. Confirm the real deployment and set both `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_ALLOWED_API_HOST` to it — `resolvePortalUrl` fails closed when they disagree. |
| 5 | **Legal wording has not been reviewed.** The intake catalog, the gift-card terms, the order and refund policy, and the privacy page are drafts. | `features/admin/intake-forms.ts`, `features/more/information-pages.ts` | Launch. Have counsel review them for Colorado. |
| 6 | **`hello@coffeestoryco.com` has not been verified as a live mailbox.** | `data/business.ts` | Nothing technical — but the app prints it. |

---

## 1. Supabase

Create a project for Coffee Story and set, in `.env` and in EAS:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — the `sb_publishable_` key, or the
  legacy anon JWT. `isValidSupabasePublishableKey` rejects anything else,
  including a `service_role` JWT, because every `EXPO_PUBLIC_*` value is
  inlined into the bundle every guest downloads.

Then, in the dashboard:

1. **Authentication**
   - Enable email/password sign-in.
   - Add `coffeestory://reset-password` to the redirect URLs. That is the
     scheme the app actually uses (`app.json` `scheme`, `lib/auth-links.ts`).
   - While testing recovery in Expo Go, also add the exact
     `exp://HOST:PORT/--/reset-password` printed by the running tunnel. Those
     are session-specific; never treat one as a production deep link.
   - Set the production email templates and SMTP.
2. **First admin**, only after that person has signed up:

   ```sql
   update public.user_roles
   set role = 'admin'
   where user_id = (select id from auth.users where email = 'OWNER_EMAIL');
   ```

3. The `service_role` secret belongs in the server environment only. Never in
   Expo, never in this repo.

A build with no Supabase values opens in Demo mode and never reaches any of
this. That is intended: it is what makes the Expo Go demo work offline.

## 2. Server environment

The web portal owns the data and the money. It needs, at minimum:

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- the email sender credentials for gift delivery
- **the order endpoint from gap 1 above**

## 3. Stripe

1. Stay on test keys until acceptance is complete.
2. Register the webhook and subscribe to `payment_intent.succeeded`,
   `payment_intent.payment_failed`, `payment_intent.canceled`.
3. **Register and verify the Apple merchant identifier
   `merchant.com.coffeestory.app`** and enable the Merchant capability on the
   app id. `app/_layout.tsx` passes exactly that string to `StripeProvider`;
   until it exists, Apple Pay cannot initialise. The checkout only offers
   Apple Pay when `isPlatformPaySupported` says the platform has it, so it
   degrades to a saved card rather than showing a button that cannot open.
4. Test a pickup order, a delivery order, an immediate gift and a scheduled
   gift, plus a declined and a cancelled payment.

## 4. Expo and Apple

- Bundle identifier: `com.coffeestory.app`. Android package: the same.
- EAS project `3dcaf174-4065-4c3b-8c57-35ce0a4bad19`, owner
  `tylerdevries222`, already wired in `app.json`.
- `ios.config.usesNonExemptEncryption` is `false`: the app ships no custom
  cryptography, only HTTPS through the OS. Without it every upload stops for a
  manual export-compliance answer.
- **Privacy manifests are not declared.** The app uses `expo-file-system` and
  `expo-secure-store`, both of which touch Apple's required-reason API
  categories. Expect ITMS-91053 on upload until `ios.privacyManifests` is
  filled in.
- `eas.json`'s `submit.production` is empty — no `appleId`, `ascAppId` or
  `appleTeamId` — so `npm run submit:production:ios` falls into interactive
  prompts and cannot run in CI.
- The permission strings are deliberately minimal. `expo-image-picker` has
  camera and microphone explicitly disabled and `expo-calendar` has reminders
  disabled, because the app only opens the photo library and only writes
  calendar events. Do not remove those `false`s to "fix" a permission error —
  find out why something is asking first.

## 5. Dependencies

`npm audit` and `npm audit --omit=dev` both report **0 vulnerabilities**.

Five `overrides` in `package.json` are load-bearing. Two of them knowingly
violate a declared range and must be re-validated on every SDK 54 patch bump:

- **`metro` / `metro-config` / `metro-transform-worker` at `0.83.8`** — clears
  8 high-severity findings (GHSA-w3rx-r6r6-pgpr, GHSA-5p2g-fcmc-qvqq) rooted
  in `image-size <= 2.0.2`. `image-size` has no fixed release; metro 0.83.8 is
  the first version that drops the dependency entirely. Note that
  `@expo/metro@54.2.0` pins `metro: 0.83.3` **exactly** — the override
  replaces that pin rather than satisfying it. Verified end to end:
  `@expo/metro-config` loads, the config validates, and
  `expo export --platform ios` bundles.
- **`postcss` at `8.5.25`** — clears 4 findings. `@expo/metro-config` declares
  `~8.4.32`; this override crosses that minor.
- **`uuid` at `11.1.1`** — clears 15 moderate findings from `xcode@3.0.1`,
  which declares `^7.0.3`. Safe: `xcode` uses only `uuid.v4`.

`brace-expansion`, `minimatch` and `qs` were removed. None was an advisory
root; `qs` resolved to nothing at all, and the `minimatch` pin was forcing a
seven-major jump on eslint and its plugins.

`npm outdated` shows the SDK-managed packages behind their latest releases.
That is expected and correct on a pinned SDK — do not bump them individually.

## 6. Business decisions still open

- Confirm the tax authorities and rates in `features/tax.ts`.
- Confirm the 500 / 1,500 / 2,500 annual Beans tier thresholds and the
  10–13 per-dollar earn rates in `features/rewards/rules.ts`.
- Confirm whether tips earn Beans. They currently do —
  `qualifyingSpendCents` counts them.
- Confirm the $3.99 delivery fee and the delivery radius
  (`features/order/totals.ts`, `screens/client/order/fulfillment-steps.tsx`).
- Confirm the posted hours in `features/order/pickup.ts` (Sun–Thu 8am–11pm,
  Fri–Sat 8am–midnight) and the 15-minute lead time before the earliest
  pickup window.
- Decide whether the bag should survive the app being closed. It does not
  today: it lives in memory, because a bag restored days later would be priced
  against a menu the shop may no longer sell.
- Assign staff and admin roles through a controlled owner process. Never
  expose role editing to a guest.

## 7. Release gate

```bash
npm ci
npm run verify
npm audit --omit=dev --audit-level=high
```

Then exercise every tab as:

- a new guest, and a returning guest with Beans and a gift balance;
- a staff account and an admin account;
- an expired and an invalid gift link;
- a declined and a cancelled Stripe payment;
- no network, and a slow network;
- VoiceOver, Dynamic Type at its largest, and Reduce Motion on.

And walk the order flow specifically: pickup and delivery, a drink with a
required option group, two sizes of the same drink (they must stay separate
lines), the same drink configured identically twice (it must merge), a
quantity taken to zero, a custom tip, and an order placed just before close
(the window picker must roll to tomorrow rather than promise a slot with
nobody behind the bar).
