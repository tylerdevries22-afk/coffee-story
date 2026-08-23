# Reference observations — public ordering flow

Frame-by-frame notes from `reference/ordering-flow/`. Captured by
`scripts/capture-reference.mjs` against a public web ordering surface, walked
to the point where an account would be required. No account was created, no
payment details entered, no employee-gated surface touched, and no bot check
circumvented.

These notes record **structure** — what each screen decides and in what order.
Visual identity is deliberately not transcribed: `docs/DO-NOT-RESEMBLE.md`
treats conventional flow order as convention rather than trade dress, and that
line is where this document stops.

---

## 01 — Order entry

Fulfillment mode is the **first and only** decision on the screen. Delivery and
Pickup are equal-weight primary cards; gift cards and catering sit below as
secondary. No menu, no prices, no location yet.

Worth noting: the guest cannot browse before committing to a mode. That is a
deliberate funnel — every downstream price and availability answer depends on
mode plus location, so asking first avoids re-pricing a populated cart.

## 02 — Location picker

A searchable list, each row carrying the store's **live availability state**
inline ("Now Pouring", "Curbside Unavailable"). Availability is surfaced
*before* the guest invests any effort, not discovered at checkout.

## 03 — Menu with order chrome

Persistent chrome pins the three order variables — **mode / time / location** —
in a bar above the catalog, each independently editable without leaving the
menu. A future-dated window surfaces as a "Preorder In Progress" pill.

The catalog itself paints noticeably later than the chrome. Any port of this
pattern needs a designed loading state for the catalog region, because the
chrome arriving alone is a visible intermediate state.

## 04 — Menu categories

**The catalog is organised by pack size, not by flavor.** Sections are
container-shaped ("Large Desserts", "Mini Desserts" with a stated 2.6″
diameter), and within each the rows are Single / 4-Pack / 6-Pack / 12-Pack.

Each multi-pack carries a computed **"Save N%"** badge relative to buying
singles (8% / 13% / 18% on large; 27% / 33% on mini). Prices are shown per
pack, and elsewhere as "starting at" for configurable items.

## 05 — Pack configurator  ← the structural finding

Opening a pack presents a two-pane sheet: product imagery left, configuration
right. Everything that matters is here:

- **Heading states an exact requirement** — "Select 1 Flavor", "Select 6
  Flavors". Not a maximum; an exact count.
- **Flavors are grouped by rotation class**, and the class is *labelled in the
  UI*: "Classic Flavors — Always available".
- **Each flavor has a quantity stepper** (− 0 +), not a checkbox. The guest
  allocates N units across flavors, so 6 units might be 2 of one and 4 of
  another.
- **Per-flavor nutrition** is inline (700 cal, 550 cal); allergens are a
  linked detail sheet rather than inline text.
- **Gift toggle** sits at pack level, not per flavor.
- **The action button states what is missing**, not what it does: "Add 1 More
  · $4.49", disabled until the exact count is satisfied, with running price on
  the button itself.

That last point is convergent with this platform's own design language —
`docs/DESIGN.md` already specifies money riding the primary action ("Add to
Bag … $6"). No change needed there; it validates the existing decision.

## 06 — Flavor selection, scrolled

Continues the grouped list. Availability is expressed per flavor *inside the
pack*, which is the propagation target an 86 has to reach.

## Listings

`reference/listings/consumer-app-listing.png` — publisher gallery, roughly six
frames of real product UI.

`reference/listings/crew-app-listing.png` — captured as **evidence of absence**.
The gallery contains two placeholder cards reading "for employees of" and no
product UI whatsoever. This is the record that the crew surface has no
published reference, not a usable reference itself.
