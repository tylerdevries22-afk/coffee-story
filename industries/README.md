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
