# Reference observations — a self-order kiosk

Notes from walking a public lobby kiosk end to end as a guest, from photographs
and a screen recording taken at the machine.

These notes record **structure** — what each screen decides and in what order.
They stop where `FLOW-OBSERVATIONS.md` stops, and for the same reason:
`docs/DO-NOT-RESEMBLE.md` treats conventional flow order as convention rather
than trade dress, and treats the parts that *identify* a brand as the thing not
to take. So there is no palette here, no type, no mascot or badge shape, no
microcopy, and no captured file anywhere in this repository. Nothing was
vendored. The competitor is not named, and CI enforces that
(`.github/workflows/verify.yml`, the originality gate).

`REFERENCE-GAPS.md` previously recorded surface 2 as having no published
reference at all. That was true of published material and is still true; what
changed is that the surface was walked in person.

---

## 01 — Attract

The resting state, and therefore the shop's face for most of the day. Brand mark
and a single invitation. The whole surface is the target: a guest approaching
from several feet away should not have to find a button.

## 02 — Entry

**One question, answered by a constellation of circular photographs at three or
four different sizes.** Not a grid — the sizes and offsets vary, so the eye is
led rather than made to scan. The largest tile is the category the shop most
wants sold; small tiles carry the secondary business (gift cards, catering,
merchandise) without a separate menu.

The structural finding: **what is on this screen is a merchandising decision,
not a menu dump.** A coffee shop and a bakery would populate it completely
differently, and neither list is derivable from the catalog. That is why this
platform makes the first step tenant configuration rather than code.

Persistent chrome throughout: brand mark and a way to start over, top left; a
back affordance once past the first step; and a small utility row top right
(rewards, gift balance, allergens) that never becomes the main event.

## 03 — Narrowing (optional)

Where a shop sells one thing in several formats, a second constellation narrows
before the catalog appears. One level only.

## 04 — Container selection

**The sellable SKU is a container, not a flavour.** Sizes are offered as
circular tiles with a name, a short description and a price, and multi-packs
carry a computed saving against the single price.

## 05 — Filling the container

The screen this whole model turns on:

- The heading states an **exact requirement**, not a maximum.
- A **tray widget** shows the box filling, with a plain "N left" beside it.
- Choices are photographs; **tapping the same one twice puts two in the box**,
  so a valid selection is a multiset rather than a set.
- Per-choice nutrition sits inline; allergens are a linked detail.
- **The action says what is missing** — "Choose 2 more" — and stays inert until
  the count is exact.

## 06 — Review

"How does this look?" The filled container is drawn, with a quantity stepper,
optional extras, an upsell to the next size up, and one primary action carrying
the price.

## 07 — Bag

Line items with price, edit and remove. Subtotal, then checkout.

## 08 — Payment

A totals card — subtotal, tax, tip, total — above the tender choice, so the
amount is seen before the method is picked.

## 09 — Identify (only for an account tender)

Scan or phone number, then an on-screen numeric keypad. The account screen
states points, balance, order total and remainder **as separate lines**, which
makes the arithmetic checkable rather than asserted.

## 10 — Processing

A single line naming what is happening, over a large glyph, that resolves to a
completion state. No cancel.

## 11 — Name

A name for the order, entered on-screen.

## 12 — Handoff

A thank-you addressed to the guest, a receipt option, and a prominent "start new
order" — the kiosk frees itself rather than waiting to be dismissed. An optional
attribution question ("where did you hear about us") sits alongside as
multi-select chips in labelled groups.

---

## What was adopted, and what was not

**Adopted — the structure.** A guided single-task flow; a merchandising-led
first screen; exact-count container filling with per-choice quantities; an
action that states what is missing; money on the primary action; an optional
identify step that never blocks an anonymous purchase; a self-clearing handoff.
All of these are conventional or convergent, and several the platform had
already specified independently (`docs/DESIGN.md` had money-on-the-action before
this walk; migration 0029 had exact-count packs).

**Not adopted — anything identifying.** Palette, type, mark, motion signature,
photography treatment, and every word of copy. This platform's kiosk reads its
own tokens and its own copy dictionary, and the constellation is computed from
tenant config rather than laid out to match anything.
