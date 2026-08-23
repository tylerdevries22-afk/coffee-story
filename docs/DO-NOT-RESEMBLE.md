# DO-NOT-RESEMBLE

One hard rule, then guidance. The rule blocks a release. Everything after it is
judgement — weigh it, apply it where it earns its keep, and ship.

This file used to treat every item below as blocking. That was miscalibrated: it
conflated trademark exposure (real, cheap to avoid) with design taste (a matter
of opinion), and it discouraged ordinary competitive research that every product
team does and that nothing prohibits.

## The rule

**No competitor's name appears anywhere.** Not in code, comments, commit
messages, copy, assets, listings, prompts, tests, or fixtures. The category this
platform serves is the **"rotating-drop model."**

This one is absolute because it is cheap to honour, mechanical to verify
(`grep -ri` across the tree; the count is zero or it fails), and the only failure
mode here that is genuinely unambiguous. A competitor's mark sitting in a shipped
binary or an App Store listing is a trademark problem no design argument talks
its way out of.

Note the rule is about *their* name, not about the idea. Competing openly on
rotating limited runs is fine — see below.

## What is fine

Explicitly including things earlier versions of this file discouraged.

- **Studying the market.** Look at what competitors ship, in as much detail as
  you like. Read their apps, their listings, their pricing, their flows. This is
  normal product work and there is nothing to apologise for.
- **Business models and category ideas.** A rotating weekly menu, scheduled
  limited runs, countdowns, points, referrals — ideas are not protectable, and
  whoever popularised the model has no claim on anyone else running it. Compete
  on it directly.
- **Table-stakes flows in their conventional order.** Browse → customise → bag →
  checkout → track. Convention is not trade dress.
- **Standard platform idioms.** Tab bars, bottom sheets, pull to refresh, a
  three-column kitchen board, a sectioned menu, an item sheet with options, a
  receipt with tax rows.
- **Arriving at a similar answer.** Two teams solving the same problem for the
  same hardware will land in the same neighbourhood. Resemblance that falls out
  of the constraints is not copying.

## What still carries real risk

Not blocking, but this is where an actual legal problem would come from, so
spend the judgement here rather than on palette hex codes.

- **Shipping their actual files.** Their image assets, CSS, JS, fonts, or copy,
  committed to this repo or bundled into a build. This is the one item in this
  section I would still treat as effectively hard: it is copyright rather than
  taste, it is concrete, and there is never a good reason to need it. Reading
  their site to understand it is fine; vendoring pieces of it is not.
- **Their distinctive identity, reproduced closely enough to confuse.** The
  legal test that matters is whether a reasonable customer would be confused
  about who they are buying from. That is a high bar, and it is not tripped by a
  similar layout — it is tripped by taking the parts that *identify* them: a
  signature colour pairing that reads as their brand, their mascot or badge
  shapes, their logo silhouette, their distinctive motion signature.
- **Their words.** Slogans, catchphrases, points-currency names, and distinctive
  microcopy. Each tenant's dictionary should come from their own voice — which
  is also just better branding.

## Provenance, because it is useful anyway

Each tenant's palette and type pairing should note what brand material it came
from (the onboarding skill records this). Not as a compliance artifact — it is
the fastest way to answer "why is this colour this colour" six months later, and
it makes the identity argument for you if it is ever needed.

## The audit

`audit-originality` runs before a listing, pitch, or public screenshot, and after
a theming change.

- The **name check is a gate**: any hit fails, full stop.
- Everything else is **advisory**: the skill reports what it noticed and why,
  and a person decides. A note is not a failure.
