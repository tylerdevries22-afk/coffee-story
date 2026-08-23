# Reference gaps — what could not be sourced, and why

The build targets five surfaces. Only one of them has published UI reference.
This file records what was searched, what was found, and what each unsourced
surface is designed from instead — so that observed and designed are never
confused in the final submission.

## Availability, verified

| # | Surface | Source checked | Result |
|---|---|---|---|
| 1 | Customer ordering | public web ordering flow | **Full journey captured**, 6 frames |
| 1 | Customer app | consumer app store listing | **~6 publisher frames of real UI** |
| 2 | Self-order kiosk / POS | app stores, web, vendor pages | **Nothing published** |
| 3 | Order-status display | app stores, web | **Nothing published** |
| 4 | Recipe / prep station | app stores, web | **Nothing published** |
| 5 | Crew operations app | crew app store listing | **2 placeholder cards, zero UI** |

## What was searched

- Both major app stores, for consumer and employee-facing titles under the
  publisher's name.
- The public web ordering surface, walked end to end to the account wall.
- A third-party APK mirror that advertised tablet screenshots: it serves a bot
  challenge, which was **not** circumvented. It is a redistribution mirror
  rather than a primary source, and the publisher's own listing is
  authoritative — that listing publishes placeholders, so the mirror would at
  best re-host the same placeholders.

## Why surfaces 2–4 cannot be sourced

These are in-store hardware surfaces: a lobby kiosk, a wall display, and a
bench-mounted prep tablet. They have no App Store listing, no public URL, and
no unauthenticated entry point of any kind. The only routes to them are
employee credentials or physical access to a store's hardware, neither of
which is available or appropriate.

Surface 5 has a public *listing* but the application is employee-gated, and
the publisher chose to ship placeholder cards instead of screenshots.

**No screenshots of these four surfaces exist in this repository, and none
were reconstructed from video stills or imagination.** An invented screen
labelled as research would be worse than an acknowledged gap.

## What the unsourced surfaces are designed from instead

1. **The platform's own design system** — `packages/ui/src/tokens.ts` and
   `docs/DESIGN.md`. All five surfaces share one token contract, so the
   unsourced four are the same language expressed at a different scale rather
   than guesses at someone else's.
2. **The device and posture**, which is a real constraint that determines most
   layout decisions: standing guest at 2–3 feet (kiosk), glance at 15 feet
   (display), hands-busy at 2 feet (prep), handheld (crew).
3. **Documented product mechanics** — see `MECHANICS.md`. The weekly lineup,
   reveal timing, and central content control are described precisely enough
   in public reporting to build against without needing to see a screen.
4. **Category convention** — the conventional order of steps in ordering and
   kitchen-display software, which `docs/DO-NOT-RESEMBLE.md` explicitly
   classifies as convention rather than trade dress.
