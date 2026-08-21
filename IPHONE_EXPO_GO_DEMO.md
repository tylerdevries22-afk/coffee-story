# Physical iPhone Expo Go demo

This folder is an Expo SDK 54 demo target derived from the SDK 57 production
app in `../mobile`. It exists because the current App Store version of Expo Go
on physical iPhones embeds SDK 54 and cannot load an SDK 57 project.

The production app remains on SDK 57. Do not merge the demo package versions
back into `../mobile`.

## Open the hosted demo

- Expo project:
  [@tylerdevries222/faithful-heart-expo-go-demo](https://expo.dev/accounts/tylerdevries222/projects/faithful-heart-expo-go-demo)
- Latest update group:
  [Bundle Expo Go fallback with demo project](https://expo.dev/accounts/tylerdevries222/projects/faithful-heart-expo-go-demo/updates/2b0b5e44-385d-44de-8245-1e82d8df9bb0)
- iOS QR code:
  [Open the SDK 54 iOS QR](https://qr.expo.dev/eas-update?updateId=019fd3a6-887d-7f8f-b829-2054af8a9b50)
- iOS Expo Go deep link:
  `exp://u.expo.dev/update/019fd3a6-887d-7f8f-b829-2054af8a9b50`
- Android QR code:
  [Open the SDK 54 Android QR](https://qr.expo.dev/eas-update?updateId=019fd3a6-887d-70db-824d-7bdab2a6834c)

On the iPhone:

1. Install **Expo Go** from Apple's App Store.
2. Sign in to Expo Go with the Expo account `tylerdevries222`.
3. Display the QR link above on another screen and scan it with the iPhone
   Camera, or open the update dashboard on the iPhone and choose Expo Go.
4. The bundle downloads from EAS Update. Metro, a tunnel, and the development
   Mac are not required.

### Opening it on someone else's device

Expo Go only opens hosted projects owned by the signed-in Expo account or an
organization that account belongs to, so the QR alone is not enough. Either:

- sign that device in to `tylerdevries222`; or
- invite the person to the Expo organization that owns the project, after which
  their own account can open it.

There is no link that opens this in Expo Go for an arbitrary signed-out account.
For genuinely open access — a client with their own Apple ID and no Expo
account — the route is TestFlight or EAS internal distribution, both of which
need the Apple Developer credentials that are still outstanding.

## Publish the next demo revision

After intentionally syncing compatible source changes from `../mobile`:

```bash
npm run verify
npm run publish:preview -- --message "Describe the demo update"
```

Share the new update's QR because a publish can create a new platform update ID.

## Demo limitations

- Apple Pay and Google Pay are unavailable in Expo Go.
- Demo mode simulates privileged write flows when live credentials are absent.
- Native SDK 57-only features must be replaced or omitted in this SDK 54 target.
- TestFlight remains the correct next step for a production-like SDK 57 beta.
