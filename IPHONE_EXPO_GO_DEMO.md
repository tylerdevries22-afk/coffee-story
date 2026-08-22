# Demoing on a physical iPhone with Expo Go

This repo is pinned to **Expo SDK 54** because the App Store build of Expo Go
on a physical iPhone embeds SDK 54 and cannot open a project built against a
newer SDK. That pin is the reason `app.json` sets
`runtimeVersion: "exposdk:54.0.0"` and why `package.json` holds every
SDK-managed package on the 54 line — see `AGENTS.md`.

Re-check that assumption before each release. Expo Go normally tracks the
latest SDK; if it has moved on, the pin is costing compatibility rather than
buying it, and `PRODUCTION_SETUP.md` gap 2 becomes the priority.

## The EAS project

`app.json` points at:

- account `tylerdevries222`
- slug `coffee-story`
- project `3dcaf174-4065-4c3b-8c57-35ce0a4bad19`
- updates URL `https://u.expo.dev/3dcaf174-4065-4c3b-8c57-35ce0a4bad19`

Dashboard: <https://expo.dev/accounts/tylerdevries222/projects/coffee-story>

> The QR codes and `exp://u.expo.dev/update/…` links that used to live in this
> file pointed at the **previous business's** published bundles, under a
> different Expo project. They have been removed rather than left to hand
> someone the wrong app. Publish from this repo, then copy the update's own QR
> and deep link from the dashboard into this section.

## Publish a demo revision

```bash
npm run verify
npm run publish:preview -- --message "Describe the update"
```

Then take the new update's QR and `exp://` link from the dashboard. A publish
can mint a new platform update id, so re-share the link rather than reusing an
old one.

## Open it on the iPhone

1. Install **Expo Go** from the App Store.
2. Sign in to Expo Go with the Expo account that owns the project.
3. Show the QR on another screen and scan it with the iPhone Camera, or open
   the update in the dashboard on the phone and choose Expo Go.

The bundle downloads from EAS Update. Metro, a tunnel and the development Mac
are not involved.

### Someone else's device

Expo Go only opens hosted projects owned by the signed-in account or an
organization it belongs to, so the QR alone is not enough. Either sign that
device in to the owning account, or invite the person to the Expo organization
that owns the project.

There is no link that opens this in Expo Go for an arbitrary signed-out
account. Genuinely open access — a guest with their own Apple ID and no Expo
account — means TestFlight or EAS internal distribution, both of which need
the Apple Developer credentials listed as outstanding in
`PRODUCTION_SETUP.md`.

## What does not work in Expo Go

Expo Go always opens in Demo mode, whatever the published channel's variables
say — see `parseStoredAppMode`. Someone who scans the QR gets the whole app
against local data, not a sign-in screen for an account they do not have.

It is a development client with a fixed native module set, so anything
custom-native falls back to the simulated Demo path:

- Apple Pay and Google Pay are unavailable.
- Stripe card payments are simulated. `usesSimulatedNativeFlows` in
  `lib/native-adapters.ts` is what decides.
- The device calendar is not written; the calendar export reports a preview.
- The custom `coffeestory://` scheme is not stable, so password-recovery deep
  links have to use the session-specific `exp://…/--/reset-password` URL that
  the running tunnel prints.

For any of those, use an EAS development build or TestFlight.
