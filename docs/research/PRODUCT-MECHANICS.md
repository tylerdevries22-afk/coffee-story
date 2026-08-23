# Product mechanics — the part that actually shaped the build

Screenshots showed layout. These mechanics, drawn from public reporting and
from the captured flow, determined the **schema**. Each row below became a
migration or was confirmed already correct.

## The lineup model

| Mechanic | Evidence | Consequence for the build |
|---|---|---|
| Fixed set of permanent items plus a rotating weekly set plus a day-specific item | Public reporting; confirmed by the configurator's labelled group **"Classic Flavors — Always available"** | `menu_items.rotation` enum (`permanent` / `rotating` / `day_specific`) + `weekday` |
| The week's lineup is **revealed** the evening before it becomes orderable | Public reporting | `drops.reveal_at`, a `revealed` status between `scheduled` and `live`, and a teaser state in the customer app with no add-to-bag control |
| Menu and recipe content is centrally controlled and propagates to every store screen | Public reporting; operator interviews | `menu_items` / `menu_categories` / `drops` added to the Realtime publication, so a running kiosk or display updates without a reload |

## The purchase model  ← revised after capture

The captured configurator overturned an assumption worth recording, because
the original plan had it wrong:

**The sellable SKU is a container, not a flavor.** A guest buys a 6-Pack and
then allocates six units across available flavors. Flavors are never
independently purchasable line items in the multi-pack path.

Specifics the configurator makes unambiguous:

- Selection is an **exact count**, not a maximum: "Select 6 Flavors", and the
  action stays disabled until satisfied.
- Each choice carries its **own quantity stepper**, so a valid selection is a
  multiset (2 × A, 4 × B), not a set.
- Choices are **grouped by rotation class**, with the class labelled.
- Multi-packs price at a **computed discount** against the single price,
  surfaced as "Save N%".
- Nutrition is per choice; allergens are a linked detail.
- The gift flag is **pack-level**.

The existing `menu_items.modifiers` JSONB supports single/multi select with
`maxChoices` and priced choices, but not exact-count, not per-choice
quantities, and not a dynamic choice source bound to the live lineup. That gap
is real and is what migration `…029_pack_configuration.sql` addresses.

## Loyalty

| Mechanic | Consequence |
|---|---|
| Points accrue **only when signed in**; the cart prompts for sign-in to attribute the order | The kiosk needs an optional identify step that never blocks an anonymous purchase |
| Points convert to spendable credit at a stated rate; a later move to opaque tiering drew public criticism for quietly devaluing rewards | Keep the earn/redeem arithmetic legible on screen. The repo's existing `loyalty_events` + `LoyaltyMeter` already express a visible rate — do not replace it with an unexplained tier multiplier |

## Confirmed already correct

- **Payments are third-party behind custom UX.** The most-repeated
  recommendation in the research is not to build a payment layer. The repo
  already runs Square per-location OAuth with encrypted tokens and computed
  application fees. No change.
- **Money on the primary action.** The captured CTA reads "Add 1 More ·
  $4.49" — price on the button. `docs/DESIGN.md` already specifies this
  independently.
- **Central content ownership.** `brand_config` plus a corporate-owned menu
  already matches the operating model.

## Curbside

An "I'm here" arrival check-in notifies the store on arrival. The repo
supports `curbside` as a fulfillment type but has no arrival signal, so staff
never learn the guest arrived. Arrival is deliberately modelled as a column
plus an event rather than a status transition — a curbside order can arrive
while still in progress, and the state machine must not be perturbed by it.
