# Preview wall

All five surfaces on one screen, each rendered at the viewport its real device
has and scaled to fit. Useful for a demo, and for catching the thing no single
surface shows you: whether the five read as one platform.

## Running it

Start the five servers first — `.claude/launch.json` has one entry each:

| Surface | Config | URL |
| --- | --- | --- |
| Customer | `customer-web` | http://localhost:4170 |
| Kiosk / POS | `kiosk-web` | http://localhost:4180 |
| Operator | `operator-web` | http://localhost:4190 |
| Pickup display | `display` | http://localhost:3200/board/demo |
| HQ console | `hq` | http://localhost:3300 |

Then publish the wall into the customer app's static server and open it:

```bash
cp tools/preview-wall/index.html apps/customer/dist-web/wall.html
```

http://localhost:4170/wall

It rides along inside a server that is already running because the preview
tooling caps a worktree at five dev servers, and all five are apps. The copy
lands in `dist-web/`, which is gitignored build output, so nothing about this
enters the repo — and re-exporting the customer app wipes it. Re-run the copy.

## Rebuilding the three Expo surfaces

`customer-web`, `kiosk-web` and `operator-web` serve static web exports. `dist/`
holds the **iOS** export that `pnpm verify` writes, so web gets its own
directory:

```bash
cd apps/customer && npx expo export --platform web --output-dir dist-web
```

Same for `apps/kiosk` and `apps/operator`. They can run concurrently — each app
has its own Metro `FileStore` cache root.

## Why HQ needed a config change

The console sends `X-Frame-Options: DENY` and `frame-ancestors 'none'`, and
should: clickjacking has obvious targets there ("86 this item", "refund"). So
`apps/hq/next.config.ts` now relaxes framing to `'self' http://localhost:*` in
development only. A deployed console still refuses outright.
