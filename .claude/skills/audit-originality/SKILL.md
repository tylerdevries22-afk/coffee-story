---
name: audit-originality
description: Screenshot every screen and check tokens, copy, and assets against docs/DO-NOT-RESEMBLE.md; fail on any match with a competitor's trade dress.
---

# Audit originality

Run before any listing submission, pitch, or public screenshot — and after
any theming change. The standard is `docs/DO-NOT-RESEMBLE.md`; this skill is
its enforcement pass. The output is PASS or a list of failures; there is no
"close enough".

## Steps

1. **Inventory the surface.** Every route in `apps/customer/src/app/` and
   `apps/operator/src/app/`, plus every HQ page. Screenshot each (simulator or
   `expo start --web`), light mode, demo data.
2. **Tokens.** Diff the tenant's palette against the checklist's forbidden
   combinations: no palette that reads as another known ordering app's
   identity (their signature primary + accent pairing), no verbatim hex
   matches with a competitor's published brand colors. The palette must trace
   to the tenant's own assets (the onboarding record says where it came from).
3. **Copy.** Grep the tree and the screenshots for: any competitor name
   (`grep -ri` the repo — the count must be zero), any competitor's slogan or
   distinctive phrasing, any category name they own. The category term here
   is "rotating-drop model".
4. **Assets.** Every image must be the tenant's own or platform-original.
   Check `assets/` provenance against the tenant folder; anything unsourced
   fails.
5. **Layout.** Distinctive-composition check: no screen may reproduce another
   product's signature composition recognisably (their exact hero-to-grid
   rhythm, their badge shapes, their mascot framing). Generic patterns
   (a menu list, a checkout receipt) are fine; a screen a reasonable person
   would mistake for the competitor's is not.
6. **Verdict.** PASS only when every check passes. Any failure blocks
   submission and names the file/screen, what it resembles, and the smallest
   change that clears it. Record the verdict and date in the tenant's
   `app-store/` folder.
