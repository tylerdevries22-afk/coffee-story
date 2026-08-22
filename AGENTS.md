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
