# Product cut-outs

A drink standing in a glass, on transparency. The second imagery contract in
this repo, parallel to [`MENU-IMAGERY.md`](MENU-IMAGERY.md) and deliberately
never merged with it.

## Why a second contract rather than a variant

1. **Square is the load-bearing rule of the photograph contract**, and a glass
   is portrait. `menu-image.ts` says so, `MENU-IMAGERY.md` repeats it, and
   `menu-image.test.ts` pins `aspect === 1`. A portrait variant would not
   extend that contract, it would repeal it.
2. **The photograph grade measures a background a cut-out does not have.**
   Luminance 30–72 measures a dim café interior; warmth 30–102 measures
   tungsten on walnut. `menuImageCorrection` is tuned so that no in-house
   photograph is ever flagged, against 50 measured photographs and zero
   cut-outs. Reusing it produces either false flags or a band-widening that
   weakens the gate for the other 61 assets.
3. `MenuImageMeasurement` would otherwise mean two different things depending
   on which file described it — whole-frame mean here, alpha-weighted opaque
   mean there.

What *is* inherited is the doctrine: **refuse rather than clamp**, pull only as
far as the nearest band edge, and keep the bands wide enough that every
in-house asset passes untouched.

## The rule

**Every cut-out is seated, not framed.** The subject is trimmed to its own
alpha, scaled to one glass height, and stood on one baseline — so a wide drink
and a narrow one share a rim line rather than a bounding box. Fit the bounding
box instead and a shelf of six visibly staggers.

## The spec

`PRODUCT_CUTOUT_SPEC` in `packages/ui/src/product-cutout.ts` is the single
source of truth; the render layer and the normaliser read the same numbers.

| | |
| --- | --- |
| Canvas | 720 × 1280 (9:16) |
| Format | lossy WebP with alpha — quality 82, alphaQuality 100, effort 6 |
| Seat | glass height 0.92, baseline 0.98, centred, max width 0.86 |
| Grade | alpha-weighted over opaque pixels only; bands seeded from the batch |

Format was measured, not assumed, on a real cut-out: WebP q82 + alpha **17.7
KB**, lossless 134.9 KB (7.6×), AVIF q60 37.1 KB (2.1×, plus an Android decode
risk), PNG 1454 KB (82×). `alphaQuality` made no difference to size at any
value, so it is pinned open. The shipped assets run 70–100 KB each, because a
glass is largely semi-transparent and the alpha plane is where the detail is.

## The locked template

One glass, one camera, one lighting setup. **Only the `LIQUID:` line changes.**

```
Photorealistic studio product photograph of one single tall drinking glass.
THE GLASS IS A PERFECT STRAIGHT-SIDED CYLINDER: its sides are exactly vertical
and the same width from the thick base all the way up to the rim, absolutely
not tapered, not conical, not flared and not curved. It is clear, completely
unbranded with no logo and no label, standing upright on nothing, filled almost
to the rim. FULL PRODUCT SHOT: the whole glass is in frame including its thick
base and the bottom rim of the glass, with clearly visible empty background
beneath the base and above the rim. The glass is small in the frame, occupying
only the middle 55 percent of the frame height, centred, and touches no edge.
Shot dead-on at drink height with a very slight downward tilt so the ellipse of
the rim is just visible. Soft key light from the upper left, gentle rim light
down the right edge, no blown-out highlights. Light condensation on the glass
and a few ice cubes just visible near the top.
LIQUID: <per-drink>
THE BACKGROUND IS A COMPLETELY FLAT EVEN GREY FIELD, the identical grey in
every corner, with no gradient, no vignette, no backdrop sweep and no shadow
cast onto it. Nothing else in the frame: no table, no surface, no coaster, no
hands, no straw, no lid, no text, no logo.
```

Generate at **2:3**, not at the storage aspect — the seat step re-canvases
anyway, and a taller generation frame makes the model crop the base off.
Generate on a **flat grey field**, not on transparency: matte extraction is far
cleaner from a flat known ground than from a model's attempt at alpha. Then run
background removal, and drop the RGBA result into the tenant folder.

**No branding on the glass, ever.** `MENU-IMAGERY.md` already rules that a cup
bearing a wordmark fails, "because the asset has to survive a rebrand and a
menu change" — and a branded glass is the one thing that would make these
assets un-reusable by a second franchise, which is the property the whole
pipeline exists to create.

Three things the model will drift on, so check every render: the glass taper
(it likes conical tumblers), the base being cropped off, and a colour that
disagrees with the drink's name. All three are cheap to regenerate.

## Running it

```bash
pnpm normalize-product-cutouts                 # coffee-story
pnpm normalize-product-cutouts --tenant <slug>
pnpm normalize-product-cutouts --check         # CI
```

Masters live in `tenants/<slug>/assets/products/*.png`; seated results in
`apps/customer/assets/products/*.webp` with `.cutouts.json` beside them.
**Different directories on purpose**: a master is a 3–7 MB RGBA PNG per drink
per tenant and has no business in an app bundle, and a tenant's artwork belongs
beside its `brand.json`.

The split also does more than any assertion could. Neither directory is one the
photograph normaliser's readdir filter can see — and a cut-out that wandered
into `assets/menu/` would be centre-cropped square, measured against a
café-interior grade band, and re-encoded without its alpha, all of which still
produces a file that looks plausible in a diff. `normalize-menu-images.ts` now
refuses any file carrying transparency for that reason.

## What `--check` actually asserts

Colour is only one third of it, and the least interesting third.

**Geometry** — bbox height, baseline and centre within tolerance of the seat
fractions, width under `maxWidth`, canvas exactly 720 × 1280, and **the WebP
fourcc at bytes 12–16 is `VP8X`, not `VP8 `**. That last one is the cheapest
assertion here and the most valuable: it catches the likeliest regression by
far, an asset that came back flattened, still recognisable, still roughly the
right size, and completely wrong. Every asset in `assets/menu/` is `VP8 `;
every asset here must be `VP8X`.

**Matte** — the failures background removal actually produces, which no colour
band can see: *halo* (rim brighter than body — one-directional, because the
symmetric version just flags pale drinks), *speckle* (largest connected opaque
region holds ≥ 99% of alpha mass), and *hard edge* (a minimum share of the
perimeter is partially transparent — a hard-thresholded mask reads jagged at 3×
where nobody catches it at thumbnail size).

**Colour** — alpha-weighted luminance, warmth and saturation over opaque pixels
only. Bands were seeded from the first six renders and padded generously,
because six samples is too few to set a tight band and the job is to catch the
tail, not to police a 5% difference between two teas. Tighten as the library
grows.

The review artefact is `apps/customer/assets-library/product-cutouts-contact-sheet.png`,
which draws every cut-out **twice — once over the app's warm paper, once over
ink**. That is the only way a person sees a light matte halo, and it is what
the sheet exists for.

## Adding a franchise

1. Drop RGBA masters in `tenants/<slug>/assets/products/<item-slug>.png`.
2. `pnpm normalize-product-cutouts --tenant <slug>`.
3. `pnpm onboard --tenant <slug> --apply` — copies the seated `.webp`s into the
   app and regenerates `apps/customer/src/tenant/product-media.ts`, the static
   import map. Metro cannot require a path chosen at runtime, so onboarding
   materialises the choice, exactly as it already does for `brand.json`.

**A missing cut-out is not an error.** `resolveProductMedia` returns null and
the shelf is one row shorter. This is a deliberate divergence from the
photograph path, where `withImage()` throws at module load — a menu row with no
picture is a build mistake, but a tenant part-way through shooting its menu
must still boot.

## Where this is going

`ProductMediaRef` is a union with a `remote` arm that is currently unused.
`menu_items.image_url`, the `menu-images` storage bucket and its
`{brand_id}/`-scoped RLS all already exist and have no readers and no writers.
When one arrives — an owner uploading from HQ — nothing about the resolver or
the component changes; `ProductMediaCatalog.remote` stops being empty. That is
the whole reason the resolver returns a reference rather than a Metro module
id, and it is what closes gap 4 in `docs/FIVE-SURFACES.md` and the comment in
`apps/kiosk/src/data/catalog.ts`.
