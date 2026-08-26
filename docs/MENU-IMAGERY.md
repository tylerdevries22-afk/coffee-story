# Menu imagery

The house standard for menu photographs, and the tooling that enforces it.
Design tokens govern colour, type and spacing (rule 4); this governs the
photographs, which until now were governed by nothing.

## Why this exists

An audit of the 61 Coffee Story menu assets found three separate problems:

| Problem | Measurement |
| --- | --- |
| Subject scale varied 2–3× | `espresso`/`cortado` filled ~30–40% of frame height; `ade-mango`/`boba-thai-tea` ~85% |
| Exposure and colour were uncontrolled | Whole-frame luminance 30.7–158.4; warmth (R−B) −3 to +100; mean saturation 0.17–0.89 |
| One source was cropped six different ways | 56²/76²/64²/72² thumbnails, a full-width 260pt hero (1.5:1) and a full-width 132pt services card (≈3:1), all cover-cropping a 600×682 portrait |

The third is why the same drink looked like a different photograph depending on
which screen you saw it. A 1.5:1 crop of a 0.88 portrait keeps only the middle
band; a 1:1 crop keeps a centred square. Same asset, different picture.

Eleven of the 61 were not house photographs at all but phone snapshots, and
three of those contain no menu item whatsoever — `spanish-latte` is a photograph
of a wooden wall, `turkish-coffee` of a retail shelf, `adeni-chai` of the
service counter.

## The spec

Defined once in `packages/ui/src/menu-image.ts` as `MENU_IMAGE_SPEC`, covered by
`menu-image.test.ts`, and consumed by both the render layer and the normaliser.

**Format.** Square, 900×900, WebP quality 82. Square is the load-bearing rule:
every render surface is square too, so the only thing that changes between them
is display size.

**Framing.** The item centred, filling roughly 70% of frame height, shot at eye
level with a slight downward tilt, standing on a dark walnut table with clear
headroom above and the table edge below.

**Lighting.** Warm tungsten key from the upper left, soft falloff, deep warm
shadows, amber highlights. The background is the café interior — dark vertical
wood slats, amber pendants, burgundy velvet — thrown well out of focus. No
flash, no daylight, no flat overhead lighting.

**Content.** No text, signage, logos, packaging, hands or people in frame. The
tenant's own branding is not an exception: a cup with the Coffee Story or
Barakah Brews wordmark on it still fails, because the asset has to survive a
rebrand and a menu change.

**Grade bands.** Measured over the whole frame, and deliberately wide — a black
americano is legitimately darker than a matcha, and flattening the menu to one
number would destroy its variety.

| Axis | Band | Measured in-house | Measured off-spec |
| --- | --- | --- | --- |
| Luminance (Rec.709 of mean colour, 0–255) | 30–72 | 31–84 | 73–158 |
| Warmth (mean R − mean B) | 30–102 | 32–100 | −3 to 92 |
| Saturation (mean per-pixel HSV S, 0–1) | 0.45–0.90 | 0.46–0.88 | 0.17–0.62 |

Saturation is measured per pixel and then averaged, **not** taken from the mean
colour. A frame of vivid greens and pinks averages to near-grey; measuring the
average reads it as washed out and invites a correction that turns it neon.
That was a real bug in the first cut of this pipeline.

## The normaliser

```sh
pnpm normalize-menu-images --tenant <slug>          # normalise tenant source
pnpm normalize-menu-images --tenant <slug> --check  # CI gate for drift
```

For each asset it centre-crops to square (biased slightly low, because a drink
sits below centre and its saucer matters more than the ceiling), resizes to
900×900, measures, and then does one of three things:

- **In band on every axis** — copied through untouched.
- **Outside, but reachable** — pulled to the *nearest band edge*, never to a
  midpoint. That is the smallest correction that does the job, and it means a
  corrected value lands exactly in band, so a second pass is a no-op.
- **Outside by more than `maxCorrection`** — left alone entirely and reported as
  needing a reshoot. Half-applying a clamped correction is worse than doing
  nothing: it neither matches the house look nor stays honest to the original.

The tenant folder is the source. `pnpm onboard --tenant <slug> --apply` copies
the normalised assets into both per-brand customer and kiosk bundles and
generates an identical static Metro image map for each app.

For a live tenant, onboarding also uploads those exact WebP bytes to the public
`menu-images` bucket at
`<brand-id>/menu-item/<menu-item-id>/<sha256>.webp` and writes the public URL to
`menu_items.image_url`. The database row is the live source of truth for HQ,
customer, and kiosk; the bundled copy is an offline/demo fallback for that
same tenant, never a second editable catalog. Customer and kiosk subscribe to
menu changes and refetch the complete published tree after an edit.

HQ uploads use a new versioned object key and never overwrite an earlier key.
Authenticated client roles can insert tenant-prefixed menu/training objects,
but cannot update or delete their bytes; retention cleanup remains a trusted
service operation. The `content_media_versions` ledger records each current
thumbnail by stable menu-item UUID. HQ shows the newest revisions and restoring
one is an ordinary menu-item update, which is itself recorded as another
revision. Storage uses these public, tenant-prefixed buckets:

| Bucket | Purpose | Contract |
| --- | --- | --- |
| `menu-images` | Storefront menu thumbnails | public read, 6 MiB, raster images |
| `brand-assets` | Tenant logos and shared artwork | public read, 10 MiB, image/SVG |
| `training-media` | Module artwork and tenant-owned lesson images | public read, 10 MiB, raster images |

Deploy database migrations before the HQ/customer build. Deep health requires
release `20260826155933`, so a build cannot silently serve the editor against a
database that lacks the ledger or training bucket.

Idempotency comes from `tenants/<slug>/assets/menu/.normalized.json`, which
records the hash of what the script last produced. An unchanged file is skipped;
a newly dropped photograph misses the hash and gets normalised.

### What it cannot check

The audit measures exposure and colour. It cannot measure **framing**, so it
will happily pass a well-exposed photograph of a wall. `spanish-latte`,
`milk-cake`, `strawberry-nutella-croissant` and `honeycomb-bites` are in-band on
every axis and still wrong. Subject framing stays a human judgement — use the
contact sheet.

## Rendering

`apps/customer/src/components/menu-image.tsx` and
`apps/kiosk/src/components/menu-image.tsx` are the only places a menu
photograph may be drawn on their respective surfaces. Both take a `variant`,
never a size:

| Variant | Frame | Used by |
| --- | --- | --- |
| `thumb` | 56², radius sm | home screen menu row |
| `line` | 64², radius sm | bag line item |
| `tile` | 72², radius md | drop row |
| `row` | 76², radius md | order flow menu list |
| `hero` | full width, 1:1 | item sheet hero, services card |
| `kioskHero` | 300², circle | first-screen anchor tile |
| `kioskNode` | 200², circle | first-screen standard tile |
| `kioskMinor` | 132², circle | first-screen secondary tile |
| `kioskChoice` | 172², circle | item and pack-fill choice |
| `kioskSlot` | 96², circle | filled pack slot |
| `kioskLine` | 88², radius md | kiosk bag line |

`hero` is square by aspect ratio rather than a fixed height, which is what makes
the hero show the identical framing the thumbnails do. Its containers must not
pin a height — that was the old 260pt hero, and it is what clipped the subject.

## Reshooting an asset

The 50 house photographs were generated to a single prompt template. To match
them, keep the SUBJECT line specific and leave everything else verbatim, and
pass two or three existing house assets as style references:

```
Photorealistic food photography matching the exact style, lighting and color
grade of the reference images. SUBJECT: <the item, described concretely>.
SETTING: a warm, dimly lit modern specialty coffee shop - dark vertical wood
slat walls, amber pendant lights and burgundy velvet seating thrown far out of
focus behind. The item sits on a polished dark walnut table top. CAMERA: 50mm
lens at f/2.0, eye level with the product, slight downward tilt, shallow depth
of field. LIGHT: warm tungsten key from the upper left, soft falloff, deep warm
shadows, rich amber highlights, no flash, no daylight. COMPOSITION: square 1:1,
the product perfectly centered and filling about 72 percent of the frame
height, clear headroom above, table edge below. Absolutely no text, no signage,
no logos, no labels, no packaging, no hands, no people.
```

Drop the result into `tenants/<tenant>/assets/menu/<item-slug>.webp` and run
`pnpm normalize-menu-images --tenant <tenant>`; the manifest hash will miss and it will be
squared, measured and mirrored to the operator app.

## Source-quality backlog

Eleven assets still need replacing. Seven are reported by
`pnpm normalize-menu-images --check`:

`ade-sunset`, `adeni-chai`, `latte`, `matcha-latte`, `midnight-lychee`,
`mochi-donut`, `turkish-coffee`

Four more pass the grade but fail on framing, so the tooling cannot see them:

`spanish-latte` (a wall), `milk-cake` (overhead, branded cup in frame),
`strawberry-nutella-croissant` (overhead plate), `honeycomb-bites` (overhead
plate)
