# Faithful Heart physical-iPhone Expo Go demo

Expo SDK 54 client and staff demo for the App Store version of Expo Go. The SDK
57 production mobile app remains in `../mobile`.

See [IPHONE_EXPO_GO_DEMO.md](./IPHONE_EXPO_GO_DEMO.md) for the hosted QR,
iPhone sign-in steps, release workflow, and limitations.

## Included

- Five-tab client shell: Home, Book, Gift, Rewards, More
- Secure Supabase email/password authentication and password recovery
- Live service availability, Stripe deposit PaymentSheet, and calendar export
- Crumbl-inspired tiered rewards with server-authoritative balances and one-year expiration
- Digital gift purchase, scheduled email delivery, guest claim, and account linking
- Role-gated staff dashboard, schedule, client directory, checkout, and operations
- Explicit demo mode when public Supabase/API values are absent

## Local development

```bash
cp .env.example .env
npm install
npm run verify
npx expo start
```

The production API must be reachable from the simulator/device. Use the deployed HTTPS URL for `EXPO_PUBLIC_API_URL`; `localhost` only works in a simulator on the same Mac.

The repository defaults to the stable production backend at
`https://faithful-heart-healing-oasis.vercel.app`. The published EAS Update in
`IPHONE_EXPO_GO_DEMO.md` is the supported remote demo path and does not require
a local tunnel or Metro server.

Expo Go is a development client, not a public distribution channel. Its native
module set is fixed, so card payments and other custom-native flows use the
safe Demo simulation there. Use an EAS development build or TestFlight for
real Stripe PaymentSheet, a stable custom URL scheme, and release testing.

## Quality gate

```bash
npm run verify
npm audit --omit=dev --audit-level=high
```

See [PRODUCTION_SETUP.md](./PRODUCTION_SETUP.md) for owner configuration and launch steps.
