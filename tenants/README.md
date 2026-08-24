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

The dry run validates the brand, categories, menu, modifiers, and identity,
then prepares listing material and artwork when a logo exists. `--apply`
requires the customer media contract and refreshes:

- customer and kiosk `brand.json` copies;
- the generated customer menu JSON and static media maps;
- customer hero, gift, rewards, menu, and product assets;
- customer PWA metadata and customer/kiosk native artwork;
- the kiosk name, slug, scheme, and bundle identifiers through its dynamic
  Expo config.

## Ownership map

| Input | Owns |
| --- | --- |
| `brand.json` | identities, tokens, copy, features, business rules, location |
| `menu.csv` | item identity, category title, description, price, sizes |
| `menu-categories.json` | stable category ids, order, display taglines |
| `modifiers.json` | item option groups and price deltas |
| `assets/menu/` | one normalized `<item-slug>.webp` per menu row |
| `assets/products/` | optional transparent shelf cut-outs |
| `assets/hero/`, `gift/`, `rewards/` | customer campaign artwork |
| `assets/logo.svg` or `logo.png` | generated icon, splash, adaptive, and web art |

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
