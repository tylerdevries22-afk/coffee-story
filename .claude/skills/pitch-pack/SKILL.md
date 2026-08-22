---
name: pitch-pack
description: Turn a prospect shop into a demo — demo brand.json, a one-page offer, and the intro script.
---

# Pitch pack

Input: the prospect's name, city, Instagram handle (their public brand
material), and anything known about their volume.

## Steps

1. **Demo brand.json**: copy `tenants/_template/`, derive a palette and type
   pairing from the prospect's own public branding (their logo and grid —
   never another app's look), fill the copy dictionary with their voice, and
   set honest placeholder fees (the standard rate card, marked as such).
   Slug it `demo-<name>`; never reuse a real tenant's folder.
2. **Seed a believable menu**: 10–15 items from their actual menu (photos or
   their site), real prices, in `menu.csv`.
3. **One-page offer** (markdown to PDF): what they get (their own branded
   app, the operator board, HQ), what it costs (the platform fee in bps with
   the volume tier spelled out in dollars at *their* volume), what it takes
   from them (logo, menu, Square login, an hour), and the pilot terms
   (`docs/legal/pilot-agreement.md` is the paper behind it). No invented
   testimonials, no fabricated metrics — the demo speaks for itself.
4. **Intro script** (60 seconds): open on their pain (the line at the
   register, the third-party fees), show the demo app with their brand on it,
   end on the one number that matters to them (the fee vs what delivery
   platforms take). Rehearse the drop countdown moment — it lands.
5. Build the demo with `pnpm onboard --tenant demo-<name> --apply` and put it
   on a device before the meeting. Nothing sells like their own logo on the
   home screen.
