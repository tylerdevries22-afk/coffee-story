# Industry blueprints

An industry is an immutable platform template; a tenant is an isolated brand overlay.
Clone an industry stack, then create any number of tenants inside it. Never copy a
tenant's mutable data into another tenant.

```text
industries/<industry>/blueprint.json   Shared vocabulary and template version
tenants/<tenant>/brand.json            Identity, theme, business rules, first location
tenants/<tenant>/menu.csv               Compatibility authoring projection
tenants/<tenant>/training-profile.json Tenant-specific training overlay
```

The shared domain uses `folder`, `offering`, `resource`, and `relation`. A blueprint
only changes labels: coffee uses category/menu item/recipe; construction can use
service group/service/procedure. Supabase owns live records and immutable releases;
these folders are portable, reviewable bootstrap inputs.

## Industry wording

A blueprint labels the domain nouns; the words a *guest* reads come from the matching
copy pack in `packages/ui/src/copy-industry.ts`, keyed by the same industry key. A
brand dictionary resolves in three layers — universal (`UNIVERSAL_COPY`) then the
industry pack then the tenant's own `copy` block — so a tenant only writes what it
says differently from its industry, and a vertical that says "request" never inherits
another vertical's "bag".

Adding an industry therefore means two files, and
`tests/consistency/src/industry-copy-packs.test.ts` fails until both exist:

1. `industries/<key>/blueprint.json`
2. a `<key>` entry in `INDUSTRY_COPY`, supplying every key in `VERTICAL_COPY_KEYS`

`generic` is the exception: it is a pack with no blueprint, because it is not an
industry a tenant is onboarded into — it is where a brand that names no industry
lands. Every tenant must still declare `business.industryKey` (`generic` is a valid
answer); the gate fails a tenant folder that leaves it out.

A brand config read from the database carries the key in `brand_config.business`,
written by `pnpm onboard`. A brand row seeded before this field existed resolves to
`generic` until it is re-seeded — deliberately, since the alternative is guessing a
vertical from nothing.
