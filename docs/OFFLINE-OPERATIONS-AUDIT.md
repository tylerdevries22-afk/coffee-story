# Offline payments and receipt printing audit

## Decision

Use a layered design, not one “offline mode” switch:

1. Keep the shop LAN alive with a UPS-backed business router/access point and
   automatic cellular failover.
2. Make the operator app local-first: durable order, payment-sync, and print
   outboxes, each with an idempotent local ID.
3. For Square card payments, replace the kiosk's simulated reader seam with
   Square Mobile Payments SDK in an **attended** POS build using
   `processingMode.autoDetect`.
4. Print from the app's local receipt snapshot to a printer that does not
   depend on the public internet. Use Ethernet/AirPrint while the LAN survives;
   use a supported Bluetooth or USB printer if the access point itself must be
   allowed to fail.

This is the smallest architecture that continues taking orders, taking eligible
card payments, and printing while the WAN is down. Square Terminal API alone
cannot do it because both checkout and receipt actions are cloud commands.

## Two outages that must not be confused

| Failure | What still works | Required print path |
| --- | --- | --- |
| ISP/WAN is down; router and access point are up | Tablets and a local printer can still communicate | Ethernet or AirPrint on the local LAN |
| Router/access point or power is down | Wi-Fi devices cannot communicate locally | UPS the network, or print over Bluetooth/USB/Wi-Fi Direct |
| One tablet loses Wi-Fi | That tablet can still use Bluetooth/USB peripherals | Bluetooth/USB payment reader and printer |

Software cannot send a job across a failed radio or access point. Hardware
redundancy is therefore part of the feature, not an optional operations detail.

## What the repository does today

The live path is cloud-first:

```text
customer/kiosk cart
  -> HTTPS platform API
  -> Postgres order (created) + immutable totals snapshot
  -> Square Orders/Payments API
  -> Square webhook
  -> append-only order_event (paid)
  -> current orders row
  -> Supabase Realtime
  -> operator/display
```

- `orders` holds the current projection. `order_events` is the append-only
  transition ledger. `orders.totals` is the item/tax/tip/total snapshot.
- Square OAuth tokens stay server-side and encrypted. This is correct, but it
  makes every REST payment path dependent on the internet.
- The kiosk currently creates the cloud order before calling
  `apps/kiosk/src/lib/card-reader.ts`; that reader is explicitly simulated.
- The operator already applies status changes optimistically and stores them in
  a location-scoped AsyncStorage queue for reconnect.
- Before this change, the “Ticket printer” setting had no persistence and no
  printer call behind it.
- A live operator board is retained only in React memory. A cold launch during
  an outage does not yet restore the last board. Kiosk/customer carts are local,
  but placing a live order still requires the API. Display and HQ remain cloud
  reads. These are explicit remaining gaps.

## How Square receipts actually work

There are three materially different Square integrations:

| Square path | Payment offline? | Receipt architecture | Fit |
| --- | --- | --- | --- |
| Terminal API + Square Terminal | No | Server creates a Terminal checkout or `RECEIPT` action using a Square `payment_id`; Terminal executes it | Reject for outage continuity |
| Point of Sale API | Yes | This app switches to Square Point of Sale, which stages the transaction and later returns a Square ID | Viable fallback, but loses the embedded flow and itemized POS API support |
| Mobile Payments SDK | Yes, with opt-in and supported hardware | SDK stores an offline payment on-device under `localID`; this app must generate and offer the printed/digital receipt from returned card details | Best embedded Square design |

For Mobile Payments SDK, an offline payment has a local ID first and no Square
payment ID until upload and processing. The reconciliation key must therefore
be owned by this app:

```text
local order ID + payment attempt ID
  -> local order snapshot
  -> Square SDK online payment ID OR offline localID
  -> local receipt snapshot + print outbox
  -> later Square payment ID
  -> idempotent server sync and order_event
```

Square says the app—not Square—must offer the buyer a receipt when Mobile
Payments SDK is embedded. A compliant card receipt must copy the available
cardholder name, brand/last four, application name, AID, entry method, and
authorization code from the SDK response. Never infer those fields or store
PAN/card track data.

Offline Square constraints that change the product decision:

- The seller must opt in and accepts expired, declined, and disputed-payment
  risk. Sandbox does not exercise offline payments.
- Use `autoDetect`; it chooses online/offline based on reachability and seller
  eligibility.
- A Bluetooth reader must have been secure and online recently and remain
  Bluetooth-connected. Queued payments must upload within Square's window.
- Do not update or reinstall the app while its SDK offline queue is nonempty.
- Mobile Payments SDK prohibits unattended terminals/kiosks. It is allowed only
  when the device is in staff sight, inaccessible after hours, and trained staff
  can assist. A truly unattended kiosk must use a different approved product or
  fall back to pay-at-counter during an outage.
- Square's SDK cannot drive printers attached through Square Stand/Kiosk; the
  app still needs its own supported print transport.

## Implemented now

The operator app now has a safe local kitchen-ticket path for orders already on
the board:

```text
order enters in_progress
  -> copy the local board/order snapshot
  -> persist location-scoped print job in AsyncStorage
  -> render self-contained HTML (no URLs or cloud assets)
  -> send to the saved iOS AirPrint printer
  -> persist completion ID to suppress duplicates
```

Safety behavior:

- Printer selection and enablement persist per location.
- A job is durable before printing; a storage failure fails closed and alerts
  staff to print manually.
- The print request has a 15-second deadline and at most two attempts.
- Attempt two is visibly marked `COPY — VERIFY BEFORE MAKING` because a timed
  out first print might still emerge from the printer.
- Printed IDs are retained for deduplication. Customer-authored values are HTML
  escaped; the receipt contains no remote resources.
- Exhausted jobs remain locally recorded rather than being silently called
  successful. Staff receive an order-specific manual-print alert.
- The output says the payment processor supplies the official card receipt.
  Current board data lacks Square's EMV receipt fields, so calling this an
  official card receipt would be unsafe and misleading.

This implementation protects printing during an **internet** outage when the
local AirPrint LAN is alive. Its durable transport boundary is ready for a
vendor Bluetooth/USB adapter, but no generic implementation can be selected
until the printer model is chosen.

## Solutions considered

| Option | Strength | Limitation | Decision |
| --- | --- | --- | --- |
| UPS + dual-WAN/LTE router | Covers most real outages without changing payments | Does not cover carrier/provider-wide outage | Required first layer |
| Local AirPrint/Ethernet print | Simple, uses the new local snapshot/outbox | Fails if LAN/AP fails | Ship for WAN outages |
| Bluetooth/USB thermal printer SDK | Works when Wi-Fi/AP fails | Vendor-specific native module and hardware | Required when AP failure is in scope |
| Square Terminal API receipt action | Itemized Square Terminal receipt | Cloud action requires existing Square payment ID | Do not use as offline fallback |
| Square Mobile Payments SDK | Embedded, on-device offline payment queue | Native build, seller opt-in/risk, attended-only | Best Square payment path |
| Square Point of Sale API | Mature Square app handles offline payment | App switching; limited itemization/control | Contingency path |
| Stripe Terminal React Native SDK | Strong offline SDK and receipt details | Provider migration and reconciliation rewrite | Viable if Square constraints fail |
| Cloud retry queue only | Easy server implementation | Cannot take/print a new sale with no network | Insufficient |
| Store-local edge hub | Lets all shop screens exchange orders without WAN | Additional device, discovery, auth, replication | Phase 3 if every screen must coordinate offline |

## “All apps” operating contract

| Surface | During outage | Required remaining work |
| --- | --- | --- |
| Operator/POS | Restore cached board; create local orders; take SDK offline payments; print; queue transitions | Cache board/order ledger, native Square adapter, payment reconciliation, Bluetooth/USB adapter |
| Kiosk | Browse cached menu/build cart; attended units may use SDK | Persist menu; create local orders; enforce attended posture; unattended fallback to pay-at-counter |
| Customer phone | Browse cached menu/build cart | Cannot promise checkout if the customer's phone has no route to the shop; show a clear offline state, never “paid” |
| Pickup display | Continue showing last snapshot | Persist last safe board; use store-local signed event relay for new offline orders |
| Prep/Crew | Continue from last snapshot and queue writes | Cache current-day tasks/batches and reconcile with version checks |
| HQ | Read last cached summary only | Administrative writes remain online-only; do not queue sensitive financial mutations blindly |

If every shop screen must see new orders while WAN is down, add a store-local
edge service on UPS power. It issues signed, location-scoped events over the LAN
and replicates to Postgres after reconnect. Do not let peer tablets invent
authoritative ticket numbers independently: use UUID local IDs, and assign the
human daily number centrally at the edge or after reconciliation.

## Safe rollout

1. Install UPS-backed router/AP, automatic LTE failover, and printer transport;
   test ISP loss separately from AP power loss.
2. Ship the local print outbox and run 50 WAN-loss print drills. Verify no blank
   tickets, no unmarked duplicates, and correct per-location printer isolation.
3. Persist encrypted/validated last-known operator, display, prep, and menu
   snapshots with schema versions and bounded retention.
4. Build the Square Mobile Payments SDK adapter in an EAS development/store
   build, not Expo Go. Authorize online, pair supported readers, use a stable
   payment-attempt UUID, and copy required receipt fields into a minimal local
   receipt record.
5. Reconcile `localID -> Square payment ID -> server order/event` idempotently.
   Never mark an offline payment “settled”; show `accepted offline—pending`
   until Square reports `PROCESSED`.
6. Add configurable offline risk ceilings: maximum sale, maximum queued count
   and value, maximum queue age, and cash/pay-at-counter fallback.
7. Block logout, seller switching, app updates, and destructive local-data
   operations while Square or app outboxes are nonempty.
8. Drill: WAN cut before order, during payment, after payment/before print,
   printer timeout, app kill/relaunch, reconnect, later decline, duplicate
   webhook, and partial device failure. Reconcile money and order ledgers to
   exactly one logical sale.

## Primary references

- [Square Mobile Payments SDK](https://developer.squareup.com/docs/mobile-payments-sdk)
- [Square iOS offline payments](https://developer.squareup.com/docs/mobile-payments-sdk/ios/offline-payments)
- [Square Mobile Payments SDK receipts](https://developer.squareup.com/docs/mobile-payments-sdk/ios/take-payments#receipts)
- [Square Terminal receipt actions](https://developer.squareup.com/docs/terminal-api/advanced-features/issue-receipts)
- [Square Point of Sale API offline mode](https://developer.squareup.com/docs/pos-api/cookbook/offline-mode)
- [Square Stand/Kiosk peripheral limitation](https://developer.squareup.com/docs/mobile-payments-sdk/ios/square-stand)
- [Expo SDK 54 Print](https://docs.expo.dev/versions/v54.0.0/sdk/print/)
- [Stripe Terminal offline payments](https://docs.stripe.com/terminal/features/operate-offline/collect-card-payments)
