# Operator app on an iPad with Expo Go

The operator app is an Expo SDK 54 project. The App Store build of Expo Go
supports SDK 54 on physical iPhone and iPad devices, so the operator preview
can be opened without a development build.

The app is already linked to the shared operator EAS project:

- account: `tylerdevries222`
- project: `platform-operator`
- project ID: `d7cc284c-df13-47fd-b040-75b90417019f`
- runtime: `exposdk:54.0.0`

## Publish a preview

From the repository root, set an EAS access token in the shell and publish the
iOS update:

```bash
export EXPO_TOKEN="<your Expo access token>"
pnpm --filter @platform/operator run verify
pnpm --filter @platform/operator run publish:preview -- --message "Operator iPad preview"
```

The command publishes to the `preview` channel and returns one update group
for iOS. Keep the QR/deep link from that output; it points to this exact
revision.

The same gated path is available in GitHub Actions:

1. Open **Actions → verify → Run workflow** on the desired ref.
2. Check **Also publish the operator app**.
3. Wait for the `verify` and `audit` jobs to pass.
4. Open the publish job summary and use the operator iOS QR code.

The repository secret must be named `EXPO_TOKEN` (the existing fallback name
`EXPO_GO_COFFEE` is also accepted by the workflow).

## Open it on the iPad

1. Install **Expo Go** from the Apple App Store. For SDK 54, use the current
   App Store build; the project and client SDK versions must match.
2. Sign in to Expo Go with the Expo account that owns the operator EAS project,
   or with an account invited to that Expo organization.
3. Scan the operator iOS QR code with the iPad Camera, or open the deep link
   from the publish summary on the iPad.
4. Choose Expo Go when prompted. The app opens in Demo mode and lands on the
   Orders board.

Expo Go is a preview client, not a live-payment or App Store distribution
path. Use an EAS development build or TestFlight when validating custom native
behavior or live payment credentials. The operator’s Skia and glass-effect
dependencies are included in the SDK 54 Expo Go client, and the app falls back
to ordinary views where the glass effect is unavailable.

## Local development on the iPad

For a development server instead of an EAS-hosted update, connect the Mac and
iPad to the same network and run:

```bash
pnpm --filter @platform/operator start:tunnel
```

Scan the QR shown by Expo CLI from the iPad Camera and select Expo Go. A
tunnel is slower than a hosted preview but avoids publishing an update.
