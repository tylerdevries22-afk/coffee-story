# Build report — platform build

Branch `agent/platform-build`, phases 0–9. Verification state at the end of
this report is the state on the branch head: **851 node:test cases green
across six workspaces, lint and typecheck clean everywhere, both Expo apps
bundle for iOS, the customer app bundles for web, the HQ console builds all
17 routes, and `pnpm audit` reports zero known vulnerabilities on both
graphs.**

## What was built, per phase

**Phase 0 — audit (`docs/AUDIT.md`).** Stack map; every hard-coded
color/font/brand string; the one competitor reference (removed); the
finding that no DB schema existed in-repo at all; every route shipping
operator/admin functionality inside the customer binary.

**Phase 1 — monorepo + split.** pnpm workspaces (`node-linker=hoisted` for
Metro); the app moved to `apps/customer` with git mv; the staff/admin trees
moved on to `apps/operator`; `packages/{engine,ui,schema}`, `tenants/`,
`scripts/`, `docs/`, `.claude/skills/`. Rule 7 enforced by construction —
a staff login in the customer app gets a handoff notice. CLAUDE.md carries
the eight architecture rules. CI rewritten for the workspace.

**Phase 2 — schema.** Eight migrations: brands (fees, flag columns,
brand_config), locations, brand_users, square_connections, menus/categories/
items, drops, customers, loyalty (projection + append-only events),
stored-value ledger, referrals, orders, order_events, platform_fees,
campaigns; metrics views. Rule 2 enforced in SQL: a BEFORE INSERT trigger on
order_events validates transitions and projects status; square_event_id
UNIQUE gives webhook idempotency. RLS on every table from JWT claims; the
token table has no client policies at all. Tests read the migration files
and fail if the TS mirrors drift.

**Phase 3 — UI kit.** `@platform/ui`: the spec's exact token surface,
resolveTokens/resolveCopy with field-by-field fallback, ThemeProvider with
injected-storage caching, the 13 components, pure logic under test. The
audited raw hexes replaced with token reads. `tenants/_template/brand.json`
documented field-by-field; coffee-story's placeholder espresso/brass palette.

**Phase 4 — customer app.** app.config.ts reads identity from
`tenants/<TENANT>/brand.json` (bundled copy pinned by a drift test);
ThemeProvider mounted; drop hero + countdown + archive; catering and
referrals pages (flag-gated); loyalty redemption and gift-balance tender at
checkout (payment-split tests); order tracking timeline (demo simulator +
the Realtime subscription module); phone-OTP sign-in; guarded push
registration; 86'd handling end to end; /drops and /refer deep links.

**Phase 5 — operator app.** The live board as the first tab: three columns +
scheduled lane, one-tap legal advances, unseen badge + haptic; order detail
with cancel/partial/full refund; menu control (86 board, pause ordering,
hours note); drop status; tested EOD summary; PIN lock with lockout; every
status change through the tested offline-queue reconciliation.

**Phase 6 — HQ console.** Next.js 15, dark executive theme; KPI dashboard;
locations with Square connection state; menu manager; drops scheduler;
campaigns; customers & loyalty; analytics with working CSV export; the
platform-admin-only fees report; onboarding wizard; brand-config editor with
live preview. Renders fully on fixtures with zero infrastructure.

**Phase 7 — engine.** Fee service (tiered, straddle-splitting, single
rounding, location-timezone months); AES-256-GCM token crypto; a thin
fetch Square client; webhook signature verification + event mapping;
placeOrder end to end; loyalty earn/reverse; stored-value ledger;
notification transports with brand-dictionary templates; job selectors.
HQ API routes: OAuth connect/callback, the idempotent webhook intake.
`scripts/square-sandbox.ts` and `scripts/run-jobs.ts`.

**Phase 8 — onboarding + ops.** `pnpm onboard --tenant <slug>` (validated
CSV contract, DB seed, sharp-generated artwork, listing draft, --apply);
five skills; DO-NOT-RESEMBLE.md; Sentry (hard-gated) in all three apps;
Checkly checks (including "the webhook must reject unsigned requests");
status page stub; ARCHITECTURE.md, RUNBOOK.md, four DRAFT legal templates.

**Phase 9 — verification.** Full gate re-run; two real defects found and
fixed (below); demo-roastery tenant onboarded as the script's second
exercise; `.env.example` written; this report.

## Defects verification caught (fixed on the branch)

- **pnpm ignored the app-level npm `overrides`**, silently reintroducing the
  vulnerable metro/image-size tree the Phase-0 audit had cleared. Moved to
  root `pnpm.overrides`; verified gone.
- **`sharp` arrived with 4 CVEs in bundled libvips** (also pulled by Next);
  overridden to >=0.35.0, re-verified working, audits clean again.
- **Web static rendering died in the monorepo** ("Unexpectedly escaped
  traversal"): workspace-root detection resolves the render entry from the
  workspace root, escaping Metro's file map. `EXPO_NO_METRO_WORKSPACE_ROOT`
  set in both metro configs.
- **The two Expo apps poisoned each other through the shared Metro cache**
  (an operator export served the customer's route tree). Per-app cache
  stores now.

## Known gaps — in rough priority order

1. **Nothing has touched a live backend.** No Supabase project was migrated
   or seeded, the Square sandbox script has not run (no credentials in this
   environment), Realtime/OTP/push/webhooks are code-verified and
   API-documented but not integration-tested. `scripts/square-sandbox.ts`
   is the first thing to run once credentials exist.
2. **The customer app still runs on its demo/portal data layer.** The new
   platform surfaces (drops, tracking, redemption) work end to end in Demo;
   wiring checkout to `placeOrder` and the menu to `menu_items` is the next
   integration step. The bag remains in-memory by design.
3. **HQ forms don't post yet** — every affordance states what it drives;
   the write paths need the engine wired to live credentials (and real auth
   session cookies via @supabase/ssr, which is scaffolded but unexercised).
4. **Campaign delivery stops at the double-send-safe claim**; the fan-out
   worker (audience query → transports) is not built.
5. **Operator app identity is placeholder** (`com.example.operator`, no EAS
   project); PIN persists per-session only (SecureStore wiring pending);
   the audible chime needs expo-audio; the board runs on the demo feed.
6. **Legacy duplication:** customer and operator still carry duplicated
   theme/lib/component copies from the split; new shared code goes to
   packages (consolidation is incremental). The legacy static tokens.ts
   files remain until screens migrate onto ThemeProvider.
7. **coffee-story's menu.csv is a 12-item starter**; the compiled catalog
   remains authoritative until menus move server-side. Tax rates, fee terms,
   the Vercel host, and the contact mailbox still need client confirmation
   (carried over from Phase 0).
8. `runtimeVersion: exposdk:54.0.0` still spans all EAS channels (the Expo
   Go demo constraint; business decision pending).
9. The originality grep in CI should exclude build dirs: Sentry's minified
   `getBreadcrumbLogLevel…` contains the competitor substring by accident
   (`.next/` build output only; the tracked tree is clean).

## Credentials needed to go further (exact env names)

All documented with comments in the root `.env.example`:

| Purpose | Names |
| --- | --- |
| Supabase | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| Square application | `SQUARE_APP_ID`, `SQUARE_APP_SECRET`, `SQUARE_ENV`, `SQUARE_TOKEN_KEY` (32B base64), `SQUARE_WEBHOOK_SIGNATURE_KEY`, `SQUARE_WEBHOOK_URL` |
| Square sandbox exercise | `SQUARE_SANDBOX_ACCESS_TOKEN`, `SQUARE_SANDBOX_LOCATION_ID` |
| Twilio SMS | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` |
| Resend email | `RESEND_API_KEY`, `RESEND_FROM` |
| Sentry | `SENTRY_DSN` (hq), `EXPO_PUBLIC_SENTRY_DSN` (each app) |
| Checkly | `CHECKLY_API_KEY`, `CHECKLY_ACCOUNT_ID`, `PLATFORM_BASE_URL` |
| Apple/EAS | Apple team + a real operator bundle id; `EXPO_TOKEN` as a CI repository secret; per-tenant `easProjectId` in brand.json |
| Build selection | `TENANT` (defaults to coffee-story) |

## Runtime verification appendix (browser-driven)

All three surfaces were launched and driven with headless Chromium
(Playwright against the customer/operator web exports and the built HQ
server), screenshotting every step — not just bundled.

**Verified working end to end:**
- Customer: boot → setup wizard → home with the live drop countdown → the
  full order journey (pickup, location, time grid, menu with category strip,
  item sheet with sizes/options and live-priced button, bag with stepper→bin,
  note, checkout with per-jurisdiction tax rows) → Beans redemption driving
  the total to $0 with $0 tax → Place Order → confirmation snapshot → the
  tracking timeline advancing on the simulator. 86'd item rendered sold-out
  and unpressable; the drops archive rendered live + past runs. Zero console
  errors.
- Operator: boot straight to the staff workspace → the Orders board in three
  side-by-side columns at iPad width with the scheduled lane → one-tap
  advance → order detail with partial/full refund controls → menu control
  (pause toggle, live 86 board) → settings → PIN lock/unlock cycle.
- HQ: all ten pages rendered on fixtures (dashboard KPIs, locations, drops,
  campaigns, customers, analytics, platform fees, brand editor with live
  preview, onboarding, per-tenant status), and the CSV export streamed
  correct rows.

**Defects found by driving (fixed on this branch):**
1. The web tab bar painted over the order flow's covering pages —
   react-native-web gives every View z-index 0, so the flow's layers can
   never out-stack a sibling bar. The bar now hides on an explicit
   `barCovered` signal from the flow, matching the native covering metaphor.
2. The operator board's three columns stacked vertically at iPad width
   (`columnsWide` never declared the row direction).
3. The web staff bar had no Orders tab at all (it hard-codes its own list;
   the Phase-5 wiring had only touched the native triggers), and the board
   glyph was missing from the icon map.
4. The operator demo booted into the guest-handoff notice: its demo role
   defaulted to client. The operator demo now opens on the shift floor.
5. Massage-era copy surfaced at runtime that no grep for the old brand
   caught: the setup wizard's "care plan" hint, a "Pressure — medium" intake
   summary, "booking and care", the staff wizard's "ready for bookings",
   and the home hero's "Book Now". All now speak coffee (the API's
   `pressurePreference` wire values stay; `strengthLabel` renders
   Light/Medium/Bold).
6. The board's new-order haptic logged a blocked `navigator.vibrate` call
   on web; guarded to native.
7. Design-philosophy alignment: HQ display type now carries the serif voice
   (system serif stack, no font fetch), its brass accent is documented as
   the dark-ground tint of the apps' brass-500, and `docs/DESIGN.md`
   codifies the one-language/three-expressions system (linked from
   CLAUDE.md).

**Known cosmetic leftovers:** HQ has no favicon (a 404 in devtools); the
legacy staff Today/Calendar surfaces still speak appointments (transitional,
see gap 6); a `navigator.vibrate` warning still fires once at workspace boot
from a legacy haptic path.
