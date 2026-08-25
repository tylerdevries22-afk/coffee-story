# Menu photographs

One photograph per menu item, named for its menu.csv slug: `<item-slug>.webp`.
The name must match a slug in `menu.csv` exactly — the render layer resolves
photos by slug, so a mismatched name is an item with no photo.

Format is the house contract (`MENU_IMAGE_SPEC`, documented in
docs/MENU-IMAGERY.md):

- Square, 900×900, WebP quality 82. Every render surface is square, so the
  stored asset is too.
- Item centred, filling roughly 70% of frame height; warm tungsten light; no
  text, logos, packaging, hands or people in frame — a branded cup fails,
  because the asset has to survive a rebrand.

Run `pnpm normalize-menu-images --tenant demo-roastery` after adding or replacing a photo. It
centre-crops to square, resizes to 900×900, grades into the house luminance /
warmth / saturation bands (in-band photos pass through untouched), and records
the result in the `.normalized.json` manifest it keeps beside the files.
`pnpm normalize-menu-images --tenant demo-roastery --check` is the CI gate for drift.
