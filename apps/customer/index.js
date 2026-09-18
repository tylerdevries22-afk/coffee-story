// The entry lives inside the app so the dev-server bundle URL never has to
// escape the server root: with EXPO_NO_METRO_WORKSPACE_ROOT=1 the hoisted
// expo-router/entry sits two directories up, and metro >= 0.83.8 parses
// request URLs with WHATWG `new URL()`, which normalizes the resulting
// /../../ prefix away before Metro can resolve it.
//
// Demo runtime mode (web only) cannot start expo-router/entry directly:
// apps/customer/src/tenants/selected.ts and the ~57 tenant consumers behind
// it read their tenant at module load, so the pack a visitor's demo needs
// has to already be on globalThis before any of that code is ever required.
// src/demo-runtime/boot.ts fetches it, then requires expo-router/entry
// itself once it has one -- or never, showing a plain refusal instead.
if (process.env.EXPO_PUBLIC_DEMO_RUNTIME === '1') {
  require('./src/demo-runtime/boot');
} else {
  require('expo-router/entry');
}
