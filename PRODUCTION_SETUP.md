# Production setup

The interactive Demo and core transaction paths are complete, but the application cannot transact against production until the account owner supplies and verifies the external services below.

## 1. Supabase

The dedicated project is live in the ACTZ organization:

- Project: `Faithful Heart & Healing Oasis`
- Reference: `hjyujvtozhhitggtnxbw`
- Region: `us-west-1`
- API URL: `https://hjyujvtozhhitggtnxbw.supabase.co`

The repository now contains 16 migrations. All migrations, including native
admin parity and its foreign-key indexes, were applied and verified through the
authenticated Supabase integration on July 30, 2026. The post-migration
Security advisor reports no warnings or errors. The settings, SOAP-note,
review, and buffered-scheduling invariants are live.
The web and Expo local environment files already contain the project URL, and
Expo contains the modern publishable key.

The account owner must finish the dashboard-only Auth settings:

1. In Authentication:
   - Enable email/password sign-in.
   - Add `faithfulheart://reset-password` to redirect URLs for development
     builds and TestFlight.
   - While testing password recovery in Expo Go, add the exact
     `exp://HOST:PORT/--/reset-password` URL printed by the active tunnel. Expo
     Go callback URLs are session-specific; do not treat them as production
     deep links.
   - Configure the custom access token hook as `private.custom_access_token_hook`.
   - Set production email templates and SMTP.
2. Create the first admin only after that person has signed up:

   ```sql
   update public.user_roles
   set role = 'admin'
   where user_id = (select id from auth.users where email = 'OWNER_EMAIL');
   ```

3. Copy the project service-role secret to `SUPABASE_SERVICE_ROLE_KEY` in
   Vercel and the ignored root `.env.local`. Do not put it in Expo or source
   control.

Never place the service-role key in the mobile app. It belongs only in Vercel.

## 2. Vercel / server environment

The production deployment and stable alias are live. These variables are
already configured in Vercel:

- `NEXT_PUBLIC_SITE_URL`
- `SUPABASE_URL`
- `GIFT_TOKEN_SECRET`
- `CRON_SECRET`

The account owner must add the remaining values:

- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `RESEND_API_KEY`
- `GIFT_FROM_EMAIL`
- `APPOINTMENT_FROM_EMAIL`
- `APPOINTMENT_TO_EMAIL`

Deploy after setting the variables. Booking-hold cleanup runs every 5 minutes,
and gift delivery runs every 15 minutes. Confirm the selected Vercel plan
supports those frequencies; otherwise use an authenticated external scheduler
for `/api/cron/bookings/expire` and `/api/cron/gifts/deliver`.

## 3. Stripe

1. Use test keys until end-to-end acceptance is complete.
2. Register `https://YOUR_DOMAIN/api/stripe/webhook`.
3. Subscribe to:
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `payment_intent.canceled`
4. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
5. Register and verify the Apple merchant identifier:
   `merchant.com.faithfulheart.healingoasis`.
6. Run test purchases for a booking deposit, final staff checkout, immediate gift, and scheduled gift.

## 4. Resend

Verify the sending domain, then set `GIFT_FROM_EMAIL` and `APPOINTMENT_FROM_EMAIL` to addresses on that domain. Test delivery, spam placement, delayed delivery, and the five-attempt retry queue.

## 5. Expo and Apple

1. The local mobile environment and checked-in safe fallback now use
   `https://faithful-heart-healing-oasis.vercel.app`. Keep
   `EXPO_PUBLIC_ALLOWED_API_HOST` equal to
   `faithful-heart-healing-oasis.vercel.app`; authenticated requests fail
   closed if these hosts differ.
2. Confirm the bundle identifier and Apple Team:
   `com.faithfulheart.healingoasis`.
3. Create an EAS project and credentials:

   ```bash
   npx eas login
   npx eas build:configure
   npx eas build --platform ios --profile production
   ```

4. Configure the associated merchant capability, app privacy answers, support URL, screenshots, and App Store metadata.
5. Test password-recovery and gift deep links on a physical device. Use an EAS
   development build or TestFlight for stable custom-scheme links.

## 6. Business decisions before launch

- Confirm the adapted reward catalog and the 500/1,500/2,500 annual tier thresholds.
- Confirm whether tips and direct gift-card purchases should earn points.
- Confirm which services accept reward cash and entitlement rewards.
- Choose authoritative verification sources for referral, review, birthday, and
  reminder bonus activities. These one-time live earn actions intentionally
  remain locked until a server can verify each event; Demo mode exercises the
  complete interaction without awarding unverified production points.
- Have counsel review the gift-card, privacy, cancellation, accessibility, and rewards terms for the jurisdictions served.
- Assign staff/admin roles using a controlled owner process; never expose role editing to clients.
- Replace remaining placeholder business details noted in the root README.

## 7. Release gate

Run from the repository root:

```bash
npm ci
npm run lint
npm run build
npm audit --omit=dev --audit-level=high
npm --prefix mobile ci
npm --prefix mobile run verify
npm --prefix mobile audit --omit=dev --audit-level=high
```

The root, SDK 57 app, and Expo Go compatibility app dependency graphs all
reported zero vulnerabilities in both production-only and complete audits on
July 30, 2026.

Then exercise every tab with:

- a new client account;
- a returning client with rewards and gift balance;
- a staff account;
- an admin account;
- expired/invalid gift links;
- declined and canceled Stripe payments;
- no-network and slow-network conditions;
- VoiceOver, Dynamic Type, and reduced motion.
