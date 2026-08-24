---
name: audit-originality
description: Grep the tree for any competitor name (the one gate, fails on a hit), then screenshot the surface and report advisory notes on tokens, copy, assets, and layout against docs/DO-NOT-RESEMBLE.md.
---

# Audit originality

Run before any listing submission, pitch, or public screenshot — and after any
theming change. The standard is `docs/DO-NOT-RESEMBLE.md`.

That standard has **one gate and the rest is advice**, and this skill reports it
that way. A run produces either FAIL (the name check hit) or PASS with a notes
list. Notes do not block; a person reads them and decides.

## Step 1 — the gate

Grep the whole tree for any competitor name: code, comments, commit messages,
copy, assets, listings, prompts, tests, fixtures. Include the screenshots'
visible text.

**Match on word boundaries, not substrings**, and exclude build output:

```bash
git ls-files | grep -vE '\.(png|jpg|jpeg|webp|mp4|ico)$' \
  | xargs grep -iEn '\b<name>\b' 2>/dev/null
```

The count must be zero. Any hit is a **FAIL** that names the file and line. This
is the only blocking check, because it is the only one that is unambiguous — a
competitor's mark in a shipped binary or a store listing is a trademark problem
regardless of how the screen looks.

The word boundary is not pedantry, it is what makes the gate usable. A plain
`grep -ri` matches inside unrelated identifiers and the gate then fails forever
on a coincidence: Sentry's minified `getBreadcrumbLogLevel` contains one
competitor's name as an internal substring, which is what
`docs/BUILD-REPORT.md` gap 9 records. Running over `git ls-files` rather than
the working tree keeps `.next/`, `.metro-cache/`, and `node_modules/` out of it
for the same reason.

A boundary-matched hit is still worth a human read before you rewrite anything —
a real word can appear innocently — but it should be rare enough to be worth
reading.

## Step 2 — inventory the surface

Every route in `apps/customer/src/app/` and `apps/operator/src/app/`, plus every
HQ page. Screenshot each (simulator or `expo start --web`), light mode, demo
data. This is what the advisory checks read.

## Step 3 — advisory notes

Report what you notice, with the reason, and move on. None of these fail a run.

- **Assets.** Anything in `assets/` that is not the tenant's own or
  platform-original, and anything unsourced. Flag prominently if a file looks
  like it came from a competitor's site — shipping their actual files is the one
  advisory item `DO-NOT-RESEMBLE` still calls effectively hard, because it is
  copyright rather than taste.
- **Identity.** A palette or mark that reads as a specific competitor's brand
  rather than the tenant's — signature colour pairing, badge or mascot shapes,
  logo silhouette. The test is whether a customer would be confused about who
  they are buying from, which is a high bar; a merely similar colour is not it.
- **Words.** Slogans, catchphrases, points-currency names, distinctive
  microcopy that belongs to someone else.
- **Layout.** Only note a screen a reasonable person would mistake for a
  specific other product. Generic patterns — a menu list, a checkout receipt, a
  three-column board — are fine and should not be flagged.

## Step 4 — verdict

FAIL only on step 1. Otherwise PASS, followed by the notes with the smallest
change that would clear each one, so the reader can weigh cost against
judgement. Record the verdict, the notes, and the date in the tenant's
`app-store/` folder.
