# The Expo apps target Expo SDK 54

This applies to `apps/customer` and `apps/operator`. Read the exact versioned
docs at https://docs.expo.dev/versions/v54.0.0/ before writing any code.

Not SDK 57. Both apps pin `expo@~54.0.0`, `apps/customer/app.json` sets
`runtimeVersion: "exposdk:54.0.0"`, and every SDK-managed package sits on the
54 line. Commit `8a3b706` made that downgrade deliberately, because the App
Store build of Expo Go on a physical iPhone embeds SDK 54 and cannot open an
SDK 57 project — see `docs/IPHONE_EXPO_GO_DEMO.md`. Writing against the 57
docs here produces APIs this runtime does not have;
`apps/customer/src/components/navigation/native-tabs-compat.tsx` exists to
shim exactly that gap.

The SDK 57 production app lives in the separate `../mobile` checkout. Do not
port its package versions into this tree.

Before the next release, re-check which SDK the App Store build of Expo Go
actually embeds. The whole SDK 54 pin rests on that one fact, and if Expo Go
has moved on, the pin is costing compatibility rather than buying it.

## Fabric and motion

Animations ride on wrapper `View`s only — never on a `Text` inside them. A
shared value driving text on Fabric renders blank.

## Workspace

This is a pnpm monorepo (`node-linker=hoisted` — Metro needs a flat
`node_modules`). Dependency version overrides live at the root `package.json`
under `pnpm.overrides`; app-level `overrides` fields are ignored by pnpm, so
never add one there. See the root `CLAUDE.md` for the architecture rules.

## The metro 0.83.8 pin and its two dependents

`pnpm.overrides` pins `metro` (and `metro-config`, `metro-transform-worker`) to
`0.83.8`. That is a security pin: every metro at or below `0.83.7` pulls a
vulnerable `image-size` (GHSA-w3rx-r6r6-pgpr, GHSA-5p2g-fcmc-qvqq), which has no
fixed release, so the only remedy is a metro outside the range. Upgrading to
Expo 57 would also have cleared it and was rejected — the SDK 54 pin above wins.
Commit `9b10b0b` has the full rationale.

Two things exist only to make that pin survivable. Both come out together if the
pin is ever lifted:

1. **`patches/@expo__cli@54.0.27.patch`** (root `pnpm.patchedDependencies`).
   `metro-file-map` 0.83.3 emitted `{ eventsQueue: [...] }`; 0.83.8 emits
   `{ changes: { addedFiles, modifiedFiles, … } }`, where the `*Files` members
   are iterables of `[path, metadata]`. The patch inserts a normalizer into four
   watcher listeners across two `@expo/cli` files. The lockfile records the patch
   hash and CI runs `--frozen-lockfile`, so `patches/`, root `package.json`, and
   `pnpm-lock.yaml` must always be committed together.
2. **`apps/*/index.js`** — each app's `main` points at a local `index.js` that
   does nothing but `import 'expo-router/entry'`. Metro 0.83.8 parses request
   URLs with WHATWG `new URL()`. With `EXPO_NO_METRO_WORKSPACE_ROOT=1` (set in
   both `metro.config.js`) the server root is the app directory, so a `main` of
   `expo-router/entry` resolved to the hoisted copy two levels up and produced a
   `/../../node_modules/…` bundle URL — which `new URL()` normalizes away before
   Metro can resolve it, failing with "Unable to resolve module
   ./node_modules/expo-router/entry". Keeping the entry inside the server root
   avoids the escape entirely.
