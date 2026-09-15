# Handoff — one tenant pack, stored in Elevate, mirrored into customer repos

**Written 2026-09-14.** Read this with `.adaptive-context/ledger.json` (same facts,
machine-readable) and the approved plan at
`~/.claude/plans/dreamy-seeking-lecun.md` (the authority on scope).

> **Live model context did not transfer.** No KV-cache, no unsaved chat, no
> in-flight reasoning moved with this document. Everything the next agent can
> rely on is on disk or on a remote, and is written down below. The full prior
> conversation is replayable from
> `.adaptive-context/memory/conversation.jsonl` (1613 turns) — but it is a
> transcript, not a resumed mind.

## Objective

Adding a customer in Elevate should let you attach one of your GitHub repos and
have a standardized `tenants/<slug>/` folder appear in it — a folder
coffee-story's onboarding already knows how to read. One canonical pack, stored
in Elevate's Supabase (`public.tenant_packs`, keyed on slug), materialized into
customer repos as git commits and pushed to coffee-story's API.

**Ownership split that resolves the whole design:** Elevate defines what a valid
pack *is*; coffee-story additionally decides what it can *build*. Flow is
one-directional — the row is canonical, the folder is a materialization:

    wizard -> tenant_packs row (canonical) -> git commit to customer repo
                                          -> POST to coffee-story's API

A hand-edit in a customer repo is **drift, not an edit**: sync detects it and
**refuses**, showing the diff. Promoting a repo edit into the row is a separate,
explicit "import from repo" action.

## Working directories

| Repo | Path | Branch | HEAD |
|---|---|---|---|
| coffee-story | `~/Dev/coffee-story` | `fix/hq-pack-full-file-set` | `ea2fc713` |
| Elevate | `~/Dev/elevate-web-dev-solutions` | `dev` | `c4b31d5` |

**Elevate's local `dev` is behind `origin/dev` (`74af867`).** Pull before judging
any merge state — PR #75 was CLEAN a few hours ago and is BEHIND now. Re-verify;
do not trust a remembered status.

## Where the plan actually stands

| Phase | Status | Evidence |
|---|---|---|
| A1 — spec `docs/TENANT-PACK.md` + zod schema in `lib/tenant-pack/schema/` | **Not done** | `git ls-tree -r origin/dev` returns nothing for either path |
| A2 — three parser widenings | **Done** | merged coffee-story #198 |
| A3 — filter modules to built surfaces | **Done** | merged #198, `servesABuiltSurface` |
| A4 — HQ five-file shape -> full standard | **Written, PR red** | #201, see below |
| A5 — golden-fixture contract test, both sides | **Done** | Elevate #71 + coffee-story #198 |
| B1 — `20260914130000_tenant_packs.sql` | **Done** | Elevate #73 |
| B2 — assets bucket + manifest | **Code done, bucket missing** | Owner action 2 |
| C — wizard repo step | **Written, no PR** | on `feat/tenant-folder-sync` |
| D1–D4 — builder, GitHub write client, `.tenant-pack.json`, sync | **Not landed** | Elevate #75 open, BEHIND |
| D5–D6 — connector + sync route | **Written, no PR** | commits `640be6a`, `f36dcc0` |
| E — coffee-story receiving endpoint + migration `20260914140000` | **Not started** | newest migration is `20260914130000` |
| F — import the five existing tenant folders | **Not started** | |
| Verification — 7-step scratch-repo exercise | **Never run** | |

`artifacts/api-server/src/github.ts` on Elevate `dev` is still **read-only** —
one `GET /user/repos`. That is the proof D2 has not landed.

## Open pull requests

| PR | State | Branch |
|---|---|---|
| coffee-story #201 | BLOCKED | `fix/hq-pack-full-file-set` |
| Elevate #76 | BEHIND | `docs/tenant-folder-owner-actions` |
| Elevate #75 | BEHIND | `feat/tenant-folder-sync-core` |
| Elevate #70 | DIRTY (conflicts) | `feat/ordering-app-tab` |

### #201's red check — diagnosed, and one cause fixed in this handoff

`verify` fails at 3s only because it is the aggregator; the real failure is
`verify-workspaces`. Root cause: `pnpm audit:tokens` rule 4 flagged **9 colour
literals** in `packages/tenant-config/src/pack-defaults.ts:19-28` — a file this
PR adds.

That file *defines* the starter palette rather than consuming one, exactly as
`pack-from-setup.ts` does, and that file was already allowlisted. Fixed here by
adding one `ALLOWED` entry in `scripts/audit-tokens.ts` with its reason.
`pnpm audit:tokens` now passes locally: *"no colour literals outside 23 declared
definition sites."*

**This is not proof #201 is green.** `verify` is an `&&` chain
(`audit:tokens && audit:brand && lint && tsc -p scripts && test:scripts && -r verify`)
that stopped at the first link, so everything after it never ran. Watch the PR's
own checks.

## Git state — what was pushed, and what was deliberately left

**18 commits across 15 `codex/*` branches existed on no remote at all.** All 15
are now pushed to `origin` under their own names. This was the work a handoff
would silently have lost.

    codex/admin-content-context      codex/cadence-p1-final
    codex/admin-site-tree            codex/cadence-period-close    (2 commits)
    codex/cadence-browser-final      codex/cadence-transactions
    codex/cadence-browser-tests      codex/cadence-ui
    codex/cadence-final-hazards      codex/shared-client-shell
    codex/cadence-idempotency        codex/shell-convergence
    codex/cadence-images             codex/shell-final-fixes
    codex/cadence-me-admin (3)

Three push hazards were removed while doing it:

- `codex/admin-site-tree` tracked **`origin/dev`** and `codex/cadence-idempotency`
  tracked **`origin/main`**. A bare `git push` from either worktree would have
  written to a trunk. Both now track their own remote branch.
- `fix/boundary-test-contention` also tracked `origin/dev` and has no commits of
  its own. Its upstream is now **unset**, so a bare `git push` from the
  `flaky-boundary` worktree fails loudly instead of writing to `dev`.

**`feat/tenant-folder-sync` has nothing to push**, despite reading "ahead 6,
behind 5". `git cherry` proves 5 of its 6 commits are already on
`origin/feat/tenant-folder-sync` under rebased SHAs, and the sixth (the #74 RLS
fix, `8972ac1`) is already on `origin/dev`. The local branch is a stale
pre-rebase copy. **Do not force-push it.** Reconcile by resetting the local
branch to the remote if you want a tidy tree — everything survives on origin.

**coffee-story has nothing to push.** Every branch is on a remote, there are no
stashes, and `chore/mcp-hosts-adopt-20260911` (whose remote branch is gone) is
preserved by two tags that are confirmed **pushed**:
`archive/20260912/...` and `recovery/...`.

### Left alone, on purpose

- **`.claude/session-notes.md.1`** (coffee-story, modified, 1.2 MB) — an
  automation's append-only compaction log, tracked by accident via an
  autocommit, not authored by this session. It was removed once in `acd7333f`
  and came back. Do **not** `git add -A` in this repo; you will sweep it in.
- **Elevate stash@{0}** — "WIP tenant ordering app integration before Cadence
  final release", taken on `feat/cadence-finish`. Stashes are local-only and no
  workflow here merges them. It is untouched; it will not survive a move to
  another machine.
- **`refs/codex/turn-diffs/*`** (4 refs, coffee-story) — Codex CLI's internal
  checkpoints, not work.

## Elevate worktrees (20, all correctly under `.claude/worktrees/`)

All clean. The `flaky-boundary` worktree carried temporary
`[SLOWREQ]`/`[FAILREQ]` stderr instrumentation in
`artifacts/api-server/src/routes/apiBoundaryTestHarness.ts`; **it has been
reverted** and must not reach a commit. Backup of the original is at
`/tmp/harness.bak`.

## The flaky boundary-test investigation (unfinished)

Two authorization-boundary tests time out only under full-suite load:
`previewPublicBoundary.test.ts:10` (14264 ms vs 231 ms alone) and
`projectActivityBoundary.test.ts:9` (6430 ms vs 162 ms alone).

**Hard constraint from the user: find the real cause. Do NOT raise the timeout.**
A silent timeout on an authorization-boundary test is exactly the failure that
must not be tolerated. **Verify with several consecutive full-suite runs.**

**Disproved** — the harness's 5 s `AbortSignal.timeout` losing to ordinary CPU
slowness. Across five full-suite runs (one plain, one under artificial CPU load,
one recursive `pnpm -r run test`, three concurrent suites) the slowest single
request was **1267 ms** and no request was ever aborted. Also ruled out: request
count (two tests making 23 requests each pass; these make 10 and 14) and
rate-limiter presence (19 of 37 boundary tests use limiters; only 2 fail).

**Live leads.** `AUTH_FLOW_TIMEOUT_MS = 12_000` (`authResolver.ts:19`) is close to
the 14264 ms failure; `AUTH_ATTEMPT_TIMEOUT_MS = 5_000` x 2 attempts + 250 ms
retry delay (`supabaseAuthTransport.ts:4-6`) is close to 6430 ms. Unexplained: how
they fire at all, since the harness mocks `globalThis.fetch` to return instantly.
**The suspected trigger** — that mock does
`Buffer.from(bearer.split(".")[1]!, "base64url")`, which throws when no
authorization header is set, and these two tests are the only ones using the `""`
(anonymous) and `"customer"` roles.

Unrelated but real, seen once under recursive load:
`artifacts/elevate-web/src/pages/RecoveryIdentity.behavior.test.tsx` — "switching
users in another tab closes the previous user's recovery form".

## Owner actions — all four outstanding, all block progress

1. **`GITHUB_TOKEN` needs `Contents: Read and write`.** Today it is read-only
   metadata. Mint a fine-grained PAT scoped to **selected repositories**, not all
   repos; with the D2 allowlist that bounds what the materializer can reach.
2. **Create the private `tenant-pack-assets` bucket** in Elevate's Supabase project.
3. **Apply Elevate migration `20260914090000`** (PR #70) via the protected
   sequence in `DEPLOYMENT.md:209-213` — explicitly *not* `supabase db push`.
4. Carried over: deploy coffee-story's pending migrations; create `SENTRY_DSN` and
   `EXPO_PUBLIC_SENTRY_DSN`; make `hosted-integration` required and enable
   `enforce_admins`; Coffee Story's five release approvals.

## Next actions, in order

1. Watch coffee-story **#201** after this push. If `verify` still fails, the next
   link in the `&&` chain is the cause — read `verify-workspaces`, not `verify`.
2. Pull Elevate `dev` (`c4b31d5` -> `74af867`), then merge `dev` into **#75** to
   clear BEHIND, re-verify, and land it. #75 is the closest to landing and D1–D4
   depend on nothing else.
3. Then **#76** (also BEHIND).
4. After #75 lands: rebase `feat/tenant-folder-sync` onto `dev` and open its PR
   (phases C, D5–D6 are written and were verified green locally: api-server
   780/780, elevate-web 476/476, all gates clean).
5. Finish the flaky boundary-test diagnosis above.
6. Phase A1 (the spec + zod schema) is still entirely unwritten and is the
   remaining structural gap in "Elevate owns the schema".
7. Read `hosted-integration` on coffee-story `main` at `79b75a31` — a monitor
   expired without reporting, so the advisor fix is **unconfirmed**.

## Standing constraints (still binding)

- Merge only when all three required checks (`verify`, `audit`, `security`)
  actually pass. `enforce_admins` is off on `dev`; PR #160 merged red and broke
  `dev` for a day.
- Never force-push. Never delete a branch that heads an open PR. Never touch
  `main` during integration work. Never resolve another branch's conflicts on the
  user's behalf.
- Worktrees only at `~/Dev/<project>/.claude/worktrees/<task>`; never a second
  clone. `git worktree remove` silently discards gitignored files — inspect
  `git status --porcelain --ignored=matching` first. Move one with
  `git worktree move`, never `mv`.
- Before deleting a branch, confirm its tip survives elsewhere. A local-only tag
  is not a backup; a CLOSED pull request is not evidence that work landed.
- Never read, copy, log, or commit `~/Work/credentials`. Never commit secrets.
  Every `EXPO_PUBLIC_*` value is publicly readable in the bundle.
- Mission Control Fly offload is required on this host: `mc_submit_fly_leaf`
  only, never `flyctl`; keep dirty/unpushed trees, secrets and deploys local. If
  an eligible leaf cannot be admitted, leave it pending rather than falling back
  locally.

## Environment gap

Several MCP servers need OAuth that cannot run in a non-interactive session:
`21st`, the whole `sales:*` set (apollo, atlassian, clay, close, fireflies,
hubspot, monday, notion, outreach, similarweb, slack, zoominfo), and `reui`.
Authorize them via claude.ai connector settings, or `claude mcp` / `/mcp` in an
interactive session. Their capabilities are unavailable until then.
