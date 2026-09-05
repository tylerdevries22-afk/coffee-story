# Preview wall

All five surfaces on one screen, each rendered at the viewport its real device
has and scaled to fit. Useful for a demo, and for catching the thing no single
surface shows you: whether the five read as one platform.

```bash
pnpm preview --tenant stillpoint-builders # build tenant web exports and publish
pnpm preview --wall                       # re-publish the verified build only
```

`EXPO_PUBLIC_TENANT=stillpoint-builders pnpm preview` remains supported. A
full export requires one of those explicit tenant selectors. Wall-only mode
reuses a verified build context and refuses to relabel an older tenant build.

Start the servers from `.claude/launch.json` — one entry per surface — and open
**http://localhost:4170/wall**.

| Surface | Launch config | URL |
| --- | --- | --- |
| Customer | `customer-web` | http://localhost:4170 |
| Kiosk / POS | `kiosk-web` | http://localhost:4180 |
| Operator | `operator-web` | http://localhost:4191 |
| Pickup display | `display` | http://localhost:3200/board/demo |
| HQ console | `hq` | http://localhost:3300 |

The display's root is a signpost, not a screen: a display is always pointed at
one shop, so the wall frames `/board/demo` rather than `/`.

## How it is wired

`surfaces.json` owns the canonical Desktop, Tablet, and Mobile profiles plus
the list the wall renders. Every app card exposes all three profiles without
reloading its iframe. Defaults stay surface-appropriate: console/display use
Desktop, kiosk uses Tablet, and Customer uses Mobile. Publisher-side capability
rules switch a construction-enabled Operator to Mobile and its public display
label to Activity board; no tenant name is encoded in those rules.

`scripts/preview.ts` refuses
to publish when a port in it disagrees with `.claude/launch.json`. Those two
drifting apart produces a wall of blank tiles and no error message, which is a
bad afternoon; the guard turns it into one line of output. Change ports in both
files or in neither.

**Where the exports come from.** `dist/` holds the **iOS** export that
`pnpm verify` writes, so web gets `dist-web/`. Pointing a static server at
`dist/` serves a directory with no HTML in it at all, and the failure reads as a
broken app rather than a missing build — which is what `.claude/launch.json`
used to do. `pnpm preview` derives which apps to export from the launch configs
themselves, so there is no second list to forget.

**Why the wall stays isolated.** The preview command bakes an explicit wall
flag and the loopback broker URL into the three Expo exports. The HQ and display
launch entries carry matching server-only flags. Together they force every
surface onto the same in-memory demo order plane even when the shell, browser,
or laptop also has valid production credentials. The flags are accepted only
with the non-production loopback broker, so they cannot silently disable live
data in a deployed build.

**Where the wall is served from.** It is copied into `apps/customer/dist-web/`
as `wall.html` + `wall-surfaces.json` rather than given a server of its own: the
preview tooling caps a worktree at five dev servers and all five are apps.
`dist-web/` is gitignored build output, so nothing about that lands in the repo
— but an export wipes the wall, which is why publishing is part of the same
command as exporting. If the wall ever shows "Could not read the surface list",
that is what happened; re-run `pnpm preview --wall`.

**Why the console needed a config change.** HQ sends `X-Frame-Options: DENY`
and `frame-ancestors 'none'`, and should — clickjacking has obvious targets
there ("86 this item", "pause ordering", "refund"). `apps/hq/next.config.ts`
now relaxes framing to `'self' http://localhost:*` **in development only**;
a deployed console still refuses outright.

## Rebuilding one surface by hand

```bash
cd apps/kiosk && npx expo export --platform web --output-dir dist-web
```

The three exports run serially because each Metro already fans out across its
own workers. Every app still has a separate `FileStore` cache root; without
that separation an operator export can accidentally serve the customer route
tree.
