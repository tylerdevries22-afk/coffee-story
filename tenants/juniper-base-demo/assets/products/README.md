# Product cut-outs

Drop one alpha master per item here, named for its menu slug:
`matcha-latte.png`, `adeni-chai.png`.

Generate them from the locked template in `docs/PRODUCT-CUTOUTS.md` — one
glass, one camera, one lighting setup, only the liquid changes — then run
background removal. Generate on a flat grey field, never on transparency.

Then:

```bash
pnpm normalize-product-cutouts --tenant <slug>   # seats them; writes .webp beside the masters
pnpm onboard --tenant <slug> --apply             # copies them in, regenerates the import map
```

A missing cut-out is not an error: the shelf that uses these shows however many
exist. Shoot four of ten and you get a shelf of four.

**No branding on the glass.** An asset has to survive a rebrand and a menu
change, and a branded glass is the one thing that cannot be reused by the next
brand.
