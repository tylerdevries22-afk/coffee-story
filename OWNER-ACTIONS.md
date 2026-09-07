# Owner actions

External dependencies, decisions, and machine-state findings that an agent cannot
resolve on its own. Each item states the evidence and the exact action needed.

Last refreshed: 2026-09-06.

## 1. Worktree handoff blocker — RESOLVED, no action needed

The repeated `WorktreeCreate hook failed: [repo-fleet] blocked: worktree_creation_blocked`
error is gone. `~/.claude/settings.json` (lines 133–143) now registers
`python3 ~/.claude/hooks/repo_fleet_worktree.py`, a work-preserving creator that
replaced the old unconditional blocker.

Verified end-to-end against a disposable repo carrying a staged edit, an unstaged
edit stacked on it, an untracked file, and an `.adaptive-context/ledger.json`:

- hook exited 0 and printed the created worktree path
- target `git status --porcelain` reproduced the source exactly (`MM tracked.txt`, `?? untracked.txt`)
- the staged/unstaged split survived (`git diff --cached --stat` → `tracked.txt | 1 +`)
- untracked and `.adaptive-context` files were copied intact
- branch `worktree-proof-task` was created
- `.adaptive-context/` and `.claude/worktrees/` were appended to `info/exclude`

**An earlier recommendation to clear the `WorktreeCreate` registration is withdrawn.**
Clearing it would remove the preservation logic, not a blocker.

Residual limit: `worktree_support._repository` raises `github_origin_required`
unless `git remote get-url origin` matches a GitHub URL. Coffee Story's origin
passes. A repo with no GitHub origin still cannot get a managed worktree.

## 2. repo-fleet has 61 files of unpushed work on an unborn HEAD — ACTION NEEDED

Path: a `repo-fleet` checkout under the local repos root, not the
sibling location first assumed. The absolute path is private operational
detail and is deliberately not recorded in a tracked file; it is in the
recovery ledger under `.adaptive-context/`, which is git-excluded.

| Probe | Result |
| --- | --- |
| `git rev-list --count HEAD` | `fatal: ambiguous argument 'HEAD'` — zero commits |
| staged files | 46 |
| untracked files | 15 |
| stashes | 0 |
| origin | `git@github.com:tylerdevries22-afk/repo-fleet.git` |

Nothing is committed, so nothing is recoverable from a reflog, a bundle, or the
remote. This is the largest single work-loss exposure on the machine.

**Owner action:** make an initial commit (or an explicit archive) in that repo.
An agent should not choose the commit boundary or message for 61 files of
unreviewed work that has never had a baseline.

## 3. Quarantine audit — clean, with one at-risk file already rescued

`~/Dev/.quarantine-worktrees-20260906/` holds 8 entries, not the 2 previously
recorded: `all-refs-20260906.bundle` (20 MB) plus 7 worktree directories.

The `mv` severed every worktree's gitdir link
(`fatal: not a git repository: …/.git/worktrees/…`), and the five relevant
branches no longer exist in the live `~/Dev/mission-control/.git`. The bundle is
their only surviving copy; it fetches cleanly into a fresh repo, so it is
self-contained.

Each branch-backed tree was diffed against its tip using a populated temp index
(`GIT_INDEX_FILE=… read-tree` then `diff`, because the scratch repo's own index
is empty and a bare diff falsely reports every file as deleted):

| Worktree | Branch tip | Result |
| --- | --- | --- |
| `mission-control-fly-ws-fix` | `ac8c1f84` `codex/fly-ws-stability` | clean |
| `mission-control-fly-diagnostics` | `12431c94` `codex/fly-test-diagnostics` | clean |
| `ui-ux-audit` | `b13d0057` `codex/ui-ux-production-audit` | clean |
| `desktop-package` | `54d1fbd7` `codex/desktop-package` | clean |
| `consolidate-desktop` | `405395b6` `codex/consolidate-mission-control-desktop` | clean |

`12431c94…` is the same SHA the handoff recorded as Mission Control task 46's
cleanup point.

**No committed or modified tracked work was lost by the quarantine.**

One untracked source file existed only inside the quarantine — absent from the
bundle (bundles carry commits, not untracked files), absent from the live
checkout, and referenced nowhere in live `mission-control/src`:

`src/components/dashboard/empty-state-launchpad.tsx` (9385 bytes), byte-identical
in `consolidation-review/` and `consolidation-adversarial/`.

It has been copied to `~/Dev/.quarantine-worktrees-20260906/rescued-untracked/`
alongside a README. Everything else untracked in the quarantine is a database or
lock file (`ruvector.db`, `agentdb.rvf`, `agentdb.rvf.lock`).

**Owner action:** decide whether that component is wanted. If yes, move it into
`~/Dev/mission-control/src/components/dashboard/` and commit it; if no, it can go
with the quarantine. Until then, do not sweep the quarantine directory.

## 4. Five mission-control stashes are still unpopped — ACTION NEEDED

```
stash@{0}: On main: wip-chat-ui-keep-out-of-cleanup-build
stash@{1}: On feat/mac-cleanup-monitor: wip: feat/mac-cleanup-monitor mixed with chat rail
stash@{2}: On main: wip: leftover fleet/mac-cleanup untracked
stash@{3}: On main: wip-unrelated-chat
stash@{4}: On feat/claude-1-2-fleet: wip: fleet and mac-cleanup (preserve before main UI work)
```

**Owner action:** triage. Stashes are the least durable form of saved work and
these predate the quarantine.

## 5. MCP servers awaiting authorization — ACTION NEEDED

These require an OAuth flow that cannot run in a non-interactive session:

`plugin:21st:21st`, `reui`, and `plugin:sales:{apollo, atlassian, clay, close,
fireflies, hubspot, monday, notion, outreach, similarweb, slack, zoominfo}`.

**Owner action:** authorize them in claude.ai connector settings, or run
`claude mcp` / `/mcp` from an interactive session. Those capabilities are
unavailable until then. Do not send authorization codes, tokens, or callback
URLs through this session.

## 6. Coffee Story release approvals — still pending, unchanged

`tenants/coffee-story/release.json` binds an earlier verified source commit and
carries five deliberately pending owner/provider approval records: credentials,
legal review, commercial setup, store listings, and a durable
`DISPLAY_DEVICE_REFRESH_SECRET`. Store accounts, signing, and the first EAS
builds need owner action and may incur external cost. None of these may be
marked approved without immutable external evidence.

## 7. Mission Control standalone build exceeds the Fly worker memory ceiling — BLOCKED, owner action required

The production build half of the Mission Control verification gate cannot pass on
Fly. Three attempts died with exit 137 (SIGKILL), and the agent has no remaining
lever to change the outcome.

| Task | Job | Runtime | Failure |
| --- | --- | --- | --- |
| 52 | `cd1ff3fb5b32407e97687d225c0e0a66` | 1906 s | exit 137, past the 1800 s deadline |
| 55 attempt 1 | `47b6db19c0ef460ea79d9ac259517dc5` | 3600 s | worker disappeared — infrastructure, not a build result |
| 55 attempt 2 | `389083cdf0d1464b871876305f5c0ec0` | 979 s | exit 137 under the cap |
| 57 | `ee3cf0d5cb934f669d3cabf1253cd2c2` | 635 s | exit 137 under the cap |

**Evidence that this is memory, not time.** A live sample taken while task 57 was
running read **3,787 MB resident with CPU collapsed to 0.98%** — a heap under
garbage-collection pressure, not a busy compile. The `memory_bytes` on the
*terminal* rows (717 MB, 921 MB) is a post-mortem sample taken after the process
was already killed and understates the peak; it should not be read as the ceiling.
The three under-cap failures are also arriving progressively earlier
(1906 s → 979 s → 635 s), which is consistent with a memory wall rather than a
timeout.

**Why the agent cannot fix this.**

- `mc_submit_fly_leaf` is `additionalProperties: false`. There is no `env`,
  `NODE_OPTIONS`, memory, or `image_kind` input — the controller picks the image
  class, and every job above ran on the identical `core-performance` image.
- mission-control itself sets no memory ceiling: `grep -rn "max-old-space\|NODE_OPTIONS"`
  across `package.json`, `next.config.*` and `.github/workflows/` returns nothing,
  so `next build --webpack` runs on Node's unconstrained default heap.
- Running it locally is not permitted here: `safe_local_fallback` is `false` and
  the offload-required flag is set.

**Owner options (any one unblocks the gate).**

1. Set a heap ceiling in mission-control itself, e.g. `NODE_OPTIONS=--max-old-space-size=6144`
   in the `build` script, so the build fails loudly or fits rather than being killed.
2. Raise the worker memory or add a larger image class in the Mission Control
   controller configuration, and expose it to `mc_submit_fly_leaf`.
3. Accept the static half alone as the promotion gate and verify the build on a
   machine that is not memory-capped.

**Consequence while this is open.** The standalone controller build cannot be
promoted, and the post-promotion Coffee Story smoke stays blocked behind it. Gate A
(lint, typecheck, test) passed at `5873220a`, but `fork/main` has since advanced to
`ef9463a3`, so that evidence is orphaned and would have to be re-run at the current
default anyway.

**Cost spent on this gate:** $0.188 estimated Fly compute across four submissions.
