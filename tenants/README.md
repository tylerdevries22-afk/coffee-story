# Tenant source of truth

Each folder under `tenants/` is a complete white-label input. The native app
folders contain generated copies because Metro needs static imports; edit the
tenant folder, never those copies.

## Start a tenant

```bash
cp -R tenants/_template tenants/<slug>
pnpm normalize-menu-images --tenant <slug>
pnpm normalize-product-cutouts --tenant <slug>
pnpm onboard --tenant <slug>
pnpm onboard --tenant <slug> --apply
```

The dry run validates the versioned manifest, categories, menu, modifiers, packs, and identity,
then prepares listing material and artwork when a logo exists. `--apply`
honors `brand.json.surfaces` and refreshes only the declared guest binaries:

- customer and kiosk `brand.json` copies;
- the generated customer and kiosk menu JSON, static media maps, and menu WebPs;
- customer hero, gift, rewards, and product assets;
- customer PWA metadata and customer/kiosk native artwork;
- the kiosk name, slug, scheme, and bundle identifiers through its dynamic
  Expo config, including the tenant's separate kiosk EAS update project when
  `identity.kioskEasProjectId` is set.

## Ownership map

| Input | Owns |
| --- | --- |
| `brand.json` | strict schema version, organization/network/inheritance lineage, deployable surfaces, provider ownership, identities, tokens, rules, locations |
| `modules.json` | complete desired capability state, pinned versions, config artifacts, enabled state, and allowed surfaces |
| `menu.csv` | item identity, category title, description, price, sizes |
| `menu-categories.json` | stable category ids, order, display taglines |
| `modifiers.json` | item option groups and price deltas |
| `packs.json` | optional pack size, choice source, single-item price reference, and explicit eligible item slugs |
| `assets/menu/` | one normalized `<item-slug>.webp` per menu row |
| `assets/products/` | optional transparent shelf cut-outs |
| `assets/hero/`, `gift/`, `rewards/` | customer campaign artwork |
| `assets/logo.svg` or `logo.png` | generated icon, splash, adaptive, and web art |

`pnpm onboard --tenant _template` validates the template itself and stops
there: scaffolding has no identity to seed, so `--apply`, `--require-db` and
`--owner-user-id` are refused for it. That is how the folder every tenant is
copied from stays correct.

`locations` is the canonical list and every entry is upserted by `(brand, name)`.
Legacy `location` remains accepted and is normalized to a one-entry list with a
deprecation warning. Do not declare both. Anything shipping `menu.csv` or
`operations.json` needs at least one location; a staff-only construction
franchise may declare none.

`organization.kind` is `independent`, `franchisor`, `franchisee`, or `operator`.
Franchisors own their `network`; franchisees are members and must pin network
inheritance to a source tenant and revision. `providers` records each external
capability, provider, and owner so production provisioning never guesses who
controls credentials.

Database onboarding treats `modules.json` as one complete snapshot. It calls
`reconcile_brand_modules` once with a canonically sorted desired state; its
brand-scoped transaction lock makes retries safe. The RPC installs/updates
declared modules and disables omitted or explicitly disabled modules without
relying on legacy feature flags.

Single-slot guest artwork never falls through to files from the previously
applied tenant. A declared customer/kiosk surface must have either a logo that
can generate the complete icon set or a complete generated set. Customer builds
also require every statically imported hero, gift, and rewards illustration.

The customer app is one tenant per build. The operator app is one neutral
listing and receives its brand after staff sign-in. Never copy one tenant's
identity into operator pre-login UI.

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm normalize-menu-images --tenant <slug> --check
pnpm audit --audit-level=high
```

Database-backed integration and E2E suites require the `SUPABASE_TEST_*` and
`E2E_*_DIR` variables documented by those test packages; a local run without
that stack reports them as skipped.
