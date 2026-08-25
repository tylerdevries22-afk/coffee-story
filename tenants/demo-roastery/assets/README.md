# Tenant assets

The brand's own artwork, owned by this folder. Subfolders hold the themed
imagery (`hero/`, `gift/`, `rewards/`, `menu/`, `products/`) — each has its own
README with naming and format rules.

## The logo

`logo.svg` is preferred over `logo.png`: `pnpm onboard --tenant <slug>`
generates the app-store icon, splash and adaptive art with sharp
(`tenants/<slug>/app-store/generated/`), and a vector master rasterises
cleanly at every one of those sizes. Onboarding falls back to `logo.png` when
no SVG exists; the PNG should be a large square with transparency.
