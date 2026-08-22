# Design philosophy

One design language, three expressions. Every surface reads as the same
platform because the same decisions repeat; only the ground changes per
audience. Rule 4 is the enforcement: no component hard-codes a color, font,
radius, spacing step, or brand string — everything reads tokens hydrated from
the tenant's brand config (`packages/ui`, `tenants/<slug>/brand.json`).

## The language

- **Warmth as ground.** Guest and staff surfaces sit on warm paper
  (`surface`, e.g. Coffee Story's `#FAF5EF`) with espresso ink
  (`textPrimary`); elevation is a white card with a soft shadow, radius from
  the token scale, never a hairline-boxed grey panel.
- **A serif voice for display, a humanist sans for work.** Display type
  (Fraunces in the apps; the system serif stack in HQ, where fonts are not
  fetched) carries titles and moments — "My Bag", "Order placed", "This
  week". Everything operational — rows, labels, buttons — is the body sans
  (Inter in the apps). Large display sizes are earned by page-level moments
  only.
- **Brass is the highlight, never the ground.** One accent family:
  brass-500 `#B08D57` on light surfaces, its tint brass-300 `#C9A468` on
  HQ's dark ground. It marks value — prices moving, countdowns, live
  states — and is never used for large fills.
- **Pill primaries.** The one main action per screen is a full-round pill in
  ink (`primary`) with white type; secondary actions are outlined pills.
  Money rides the button ("Add to Bag … $6") so a choice shows its cost
  where the thumb already is.
- **Semantic colors pass AA on their actual ground** — success/warning/
  danger are tested against the surfaces they appear on
  (`contrast.test.ts`), not just white.
- **Motion is furniture, not fireworks.** fast/base/slow (120/220/360ms)
  from tokens; animations ride wrapper Views (the Fabric constraint);
  reduced-motion always has a designed static state.
- **Words are tokens too.** Brand names, points names, and voice come from
  the copy dictionary; the platform's own vocabulary ("rotating-drop
  model", "86'd", "the board") stays consistent across surfaces.

## The three expressions

| Surface | Ground | Type | What changes |
| --- | --- | --- | --- |
| `apps/customer` | Tenant's warm light surface | Fraunces + Inter | Fully tenant-themed: palette, copy, imagery are the brand's |
| `apps/operator` | Same warm system, denser | Fraunces + Inter | Shift-floor scale: bigger tap targets, higher information density, KDS mode grows type and drops prices |
| `apps/hq` | Executive dark (`#0d0f12` ground, raised cards) | System serif display + system sans | The operator's cockpit: large KPI numerals, tables, the same brass/success/danger family as tints for dark |

The HQ console is deliberately dark where the apps are light: it is the
back office reading numbers at a desk, not a storefront. It stays the same
language — serif display voice, brass accents, pill buttons, card
elevation, the same semantic family — expressed for a different room.

## Enforcement

- `packages/ui/src/tokens.ts` is the token contract; `resolveTokens` drops a
  malformed tenant value field-by-field rather than unbranding the app.
- `docs/DO-NOT-RESEMBLE.md` bounds what the language may ever look like;
  the `audit-originality` skill is its enforcement pass.
- `docs/MENU-IMAGERY.md` is the same contract for photographs: one square
  format, one grade band, one render component. `pnpm normalize-menu-images
  --check` runs it in CI.
- Runtime verification drives all three surfaces in a browser before a
  release (see BUILD-REPORT's verification appendix).
