# `@platform/analytics`

Framework-free analytics contracts shared by the customer, operator, kiosk,
pickup display, and HQ apps. The package validates and freezes events; it does
not perform network or storage I/O.

## Browser and Expo usage

```ts
import { createAnalyticsBatch, startFlow } from '@platform/analytics';

const event = startFlow(context, {
  clientEventId: securePlatformUuid,
  occurredAt: new Date().toISOString(),
  flowKey: 'checkout',
});

if (event) {
  const batch = createAnalyticsBatch([event]);
  await telemetryTransport.enqueue(batch);
}
```

- Supply UUIDs through the app's existing cryptographically secure browser or
  Expo UUID provider; the package deliberately has no platform dependency.
- Supply only rotating, server-approved `h1_` pseudonymous actor/session hashes.
  Never hash raw personal data in a client and treat the result as anonymized.
- A behavioral helper returns `null` when consent is absent. Essential
  reliability events remain available. Telemetry must never block a user flow.
- Keep offline queues bounded, expire stale events, send at most 50 per batch,
  and use a timeout plus bounded retry in the app transport.
- Event properties must be allowlisted primitive values. Names, emails,
  messages, searches, payment data, tokens, and other sensitive fields are
  rejected at the contract boundary.
