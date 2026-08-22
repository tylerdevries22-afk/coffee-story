# This repo targets Expo SDK 54

Read the exact versioned docs at https://docs.expo.dev/versions/v54.0.0/ before
writing any code.

Not SDK 57. `package.json` pins `expo@~54.0.0`, `app.json` sets
`runtimeVersion: "exposdk:54.0.0"`, and every SDK-managed package sits on the
54 line. Commit `8a3b706` made that downgrade deliberately, because the App
Store build of Expo Go on a physical iPhone embeds SDK 54 and cannot open an
SDK 57 project — see `IPHONE_EXPO_GO_DEMO.md`. Writing against the 57 docs
here produces APIs this runtime does not have;
`src/components/navigation/native-tabs-compat.tsx` exists to shim exactly that
gap.

The SDK 57 production app lives in the separate `../mobile` checkout. Do not
port its package versions into this tree.

Before the next release, re-check which SDK the App Store build of Expo Go
actually embeds. The whole SDK 54 pin rests on that one fact, and if Expo Go
has moved on, the pin is costing compatibility rather than buying it.

## Fabric and motion

Animations ride on wrapper `View`s only — never on a `Text` inside them. A
shared value driving text on Fabric renders blank.
