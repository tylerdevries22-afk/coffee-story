---
name: weekly-report
description: Produce the owner's Monday email from order_events — in-app share, top items, loyalty redemption, drop performance, and one recommendation.
---

# Weekly report

Audience: the brand owner, Monday morning, one screen of email. Numbers from
the metrics views; tone plain; exactly one recommendation.

## Steps

1. **Window**: the 7 days ending Sunday night in the brand's primary-location
   timezone. Compare against the 7 days before it.
2. **Pull** `brand_daily_metrics` (revenue, orders, AOV, in-app share,
   loyalty redemption rate) and `drop_performance` for any drop whose window
   touched the week; top items from the week's order snapshots
   (`order_events.snapshot.lines`, `type = 'paid'`).
3. **Write the email** (template: subject "Your week at {appName}"):
   - three headline numbers with week-over-week deltas (revenue, orders,
     in-app share) — state deltas as "+$412 (+6%)", never bare percentages
   - top 5 items with quantities
   - loyalty: redemption rate and points redeemed
   - the drop, if one ran: orders, revenue, vs the previous drop
   - **one recommendation**, grounded in this week's numbers (e.g. "Tuesday
     is your quietest revenue day; schedule the next drop to start Tuesday").
     One. The owner should never scroll.
4. **Send** through the engine's email transport (Resend) from the platform's
   sending domain, or paste into the owner thread if sends aren't configured.
   All copy uses the brand dictionary's names (appName, pointsName).
