---
name: launch-drop
description: Launch a rotating drop — item + date window in, announcement copy, hero prompt, countdown config, and the campaign row out.
---

# Launch a drop

Input: which menu item, the start and end instants (shop-local time), and
whether announcement sends are wanted (push/SMS per the brand's flags).

## Steps

1. **Resolve the item** in the tenant's menu (`menu_items` or the app
   catalog). The drop needs its `item_id`; if the item is new, add it to the
   menu first (86'd/unlisted until the drop goes live if it must stay secret).
2. **Write the drop row**: `starts_at`/`ends_at` in UTC (convert from the
   location's timezone), `status: 'scheduled'`. The jobs tick
   (`scripts/run-jobs.ts`) flips it live and ended on the window — never
   hand-set `live`.
3. **Hero asset.** Draft an image prompt from the brand's own photography
   style (lighting, surface, props the shop actually uses). The asset lands on
   `drops.hero_asset_url`. Keep another product's name out of the prompt —
   that is the one hard rule; see `docs/DO-NOT-RESEMBLE.md` for the rest.
4. **Countdown config is automatic**: the customer app renders the chip from
   the window ("Drops in 2d 4h" → "Ends in 4h 12m"). Sanity-check the window
   against shop hours — a drop that starts when the shop is shut reads as
   broken.
5. **Announcement copy**, in the brand dictionary's voice, one line each:
   - push: name the item, name the scarcity ("gone when it's gone")
   - SMS (only if the `sms` flag is on): shorter, no link shorteners
   Store as a `campaigns` row (channel, audience, `scheduled_at` a few
   minutes after the drop goes live, `drop_id` set) — the tick claims and
   sends it.
6. **After the window**, pull `drop_performance` for the debrief: orders,
   revenue, orders/day vs the last drop.
