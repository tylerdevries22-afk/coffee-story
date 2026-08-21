# Coffee Story App — Reuse & Rebrand Plan

Source: `~/Dev/faithful-heart-healing-oasis` (Faithful Heart & Healing Oasis)
Target: `/Users/tylerdevries/coffee-story` — a fully rebranded Expo app for **Coffee Story** (coffeestoryco.com), "Coffee Story by Barakah Brews — A Blessing In Every Cup", Aurora CO.

---

## 1. Codebase audit (what we are reusing)

Two mobile targets exist in the source repo:

| Target | Expo SDK | Runs in App Store Expo Go? | Notes |
|---|---|---|---|
| `mobile/` | 57 | ❌ (Expo Go embeds SDK 54) | Production dev-client build; Stripe + Skia native |
| `mobile-expo-go-demo/` | 54 | ✅ | Purpose-built Expo Go demo; same `src/` synced |

**Decision: base the Coffee Story app on `mobile-expo-go-demo`** (SDK 54). It is the only variant that satisfies "works on Expo Go" today, and it also runs in the iOS Simulator via `expo start` → `i`.

### Stack
- expo-router v6 (typed routes, `src/app/`), React Native 0.81, React 19.1
- Reanimated 4 + Worklets, react-native-skia (liquid-glass rewards visual), expo-glass-effect
- expo-video (home hero), expo-image, expo-sensors (liquid tilt), expo-haptics
- Supabase client (demo mode runs fully local — no backend required)
- Stripe (simulated in demo; Apple Pay unavailable in Expo Go)
- Fonts: Fraunces (display serif) + Inter (sans) via @expo-google-fonts
- Tests throughout: theme contrast (WCAG pins), rewards rules, POS totals, navigation state, etc.

### App structure
- **Roles:** client + staff (demo role picker on auth screen)
- **Client routes:** home, book, rewards, gift, more (visits, services, resources, profile, privacy, payments, messages, membership, location, intake, gift-balance, faq, care-policy, admin)
- **Staff routes:** today, calendar, clients, quick-actions, more → checkout (POS), admin (services, rewards, settings, proposal)
- **Rewards centerpiece:** `src/components/rewards/glass-heart.tsx` — Skia glass **heart** filling with animated "galaxy" liquid, tilt-responsive (device motion), per-tier palettes (`glass-heart-palettes.ts`), haptics
- **Rewards logic:** `src/features/rewards/` — tiers `Rooted / Renewed / Radiant / Oasis`, 10–13 pts/$, 1-yr expiry, redeem catalog ($10 credit 500 pts, aromatherapy 800, $25 credit 1500, free session 2000), referral codes (`HEART-XXXXXXXX`), cash entries
- **Single theme source:** `src/theme/tokens.ts` (plum `brand*` ramp + `gold*` ramp + ink neutrals + Fraunces/Inter) — one-file palette swap; contrast pinned by `contrast.test.ts`
- **Business data:** `src/data/catalog.ts` (massage services), `src/data/demo.ts` (demo dataset: appointments, ledger, gift cards, messages, staff dashboard, SOAP notes), `src/data/gift-designs.ts`, `src/features/more/information-pages.ts` (FAQ/location copy)
- **Brand strings:** `Faithful Heart` appears in ~34 user-facing spots; `HEART_POINTS_LABEL` centralized in `features/rewards/presentation.ts`
- **Assets:** `assets/brand/logo.png`, `assets/hero/home-hero.mp4` + posters, `assets/services/*.webp` (5), `assets/gift/*.webp` (8), `assets/rewards/heart-nebula.webp`, `assets/tabs/hand-heart*.png`, app icons, `assets/expo.icon`

### Rebrand surface area
~1,400 case-insensitive matches of `faithful|oasis|massage|heart|spa|therap*` across 135 files (many are the same handful of concepts repeated: brand name, service names, heart rewards).

---

## 2. Coffee Story brand inputs (from coffeestoryco.com)

- **Name:** Coffee Story · by Barakah Brews · tagline "A Blessing In Every Cup"
- **Positioning:** modern coffee experience rooted in culture; community; halal-friendly; prayer room; "Our Coffee, Your Story"
- **Address:** 2222 S Havana St Unit A1, Aurora CO 80014 · (720) 609-2971
- **Hours:** Sun–Thu 8am–11pm, Fri–Sat 8am–12am
- **Menu pillars:** signature lattes (Spanish, pistachio, tiramisu, ube, lavender honey), Turkish coffee, Adeni chai, matcha (Rooh Afza), boba, cold brew, frappes, smoothies, sparkling ades, mochi donuts, milk cakes (pistachio/lotus/saffron), honeycomb cheese bread, sandwiches/wraps/paninis, breakfast
- **Roaster:** Corvus Coffee (Colorado)
- **Extras:** late-night hours, mobile coffee cart catering, Wi-Fi + study-friendly
- **Socials:** Instagram / Facebook / TikTok
- Website image assets may be reused (owner granted permission) — will be downloaded and optimized (webp) during Phase 5.

---

## 3. Execution phases

**Phase 0 — Baseline.** Copy `mobile-expo-go-demo` → workspace (excluding node_modules/.git). `npm install`. Run `lint`, `typecheck`, `test` → green baseline before any change.

**Phase 1 — Identity & config.** `app.json`: name → `Coffee Story`, slug → `coffee-story`, scheme → `coffeestory`, bundleIdentifier → `com.coffeestory.app`, splash background/logo, all permission strings reworded, strip old EAS `owner`/`projectId`/`updates` (local dev without the old Expo account). `package.json` name. Tab-icon and app-icon replacements queued for Phase 5.

**Phase 2 — Theme.** Rewrite `src/theme/tokens.ts`: plum ramp → coffee ramp (espresso browns), gold ramp → caramel/crema, ink → warm neutral browns, surface → cream. Keep `contrast.test.ts` green (update pins where intended). Keep Fraunces + Inter (already a coffee-appropriate serif/sans pairing) unless website fonts are preferred.

**Phase 3 — Rewards redesign.** Per chosen direction (see Q1–Q4): reskin the liquid-glass vessel (heart → cup/bean/heart-with-coffee-liquid), rewrite `TIER_PALETTES` to coffee liquids (espresso / caramel / matcha / crema-gold), rename tiers, `HEART_POINTS_LABEL` → new currency name, referral prefix, all rewards-screen copy, redeem catalog → coffee rewards (free drink, size upgrade, pastry, beans bag).

**Phase 4 — Content & data.** `catalog.ts` → Coffee Story menu with real items/prices; `demo.ts` → orders instead of appointments, coffee reward ledger, gift cards (`FH-` → `CS-` codes), messages, staff dashboard (barista shifts, order queue), remove/replace SOAP-notes & intake (health-specific) with order notes/preferences; `information-pages.ts` → real FAQ/hours/location; notifications feed copy; home hero copy; auth screen wordmark.

**Phase 5 — Assets.** Download website imagery (curl) → `assets/brand`, `assets/hero`, `assets/menu`, `assets/gift`; generate app icon + splash from Coffee Story logo; replace `hand-heart` tab icon; remove `heart-nebula.webp` or replace with coffee texture. Optimize to webp/png sizes Expo expects.

**Phase 6 — Verify & launch.** `npm run lint && npm run typecheck && npm test` green → `npx expo export --platform ios` passes → `expo start` (QR for Expo Go on your phone) → press `i` to launch in iOS Simulator on this Mac. Fix anything that surfaces.

---

## 4. Known limitations (inherited from the demo target)

- Apple Pay / Google Pay unavailable inside Expo Go — checkout stays simulated (same as source demo).
- Publishing a hosted QR (EAS Update) requires your Expo account; local `expo start` QR works without it.
- App Store Expo Go only embeds SDK 54 — that's why the SDK 54 base is required.
