#!/usr/bin/env bash
#
# Stop-hook: commit any leftover working-tree changes and push the branch.
#
# Why a hook and not a habit: "always push" has to survive a session ending
# mid-thought, and the web container is reclaimed after idle -- anything not
# pushed is gone. This runs when the turn ends, so the branch on GitHub is
# never behind the container.
#
# It is a safety net, not the primary path. A deliberate commit written during
# the turn leaves a clean tree, and this only pushes it -- so real commit
# messages stay real, and only genuine leftovers get a mechanical one.
#
# Refuses rather than guesses: detached HEAD, the default branch, a half-
# resolved merge, or a diff that smells like a credential all stop it.

set -uo pipefail

emit() { printf '{"systemMessage":%s}\n' "$(printf '%s' "$1" | jq -Rs .)"; exit 0; }

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}" 2>/dev/null || exit 0
root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$root" || exit 0

branch=$(git symbolic-ref --short -q HEAD) \
  || emit "autocommit: detached HEAD, nothing pushed. Check out a branch first."

case "$branch" in
  main|master) emit "autocommit: refusing to auto-push to '$branch'. Work on a feature branch." ;;
esac

for f in MERGE_HEAD REBASE_HEAD CHERRY_PICK_HEAD BISECT_LOG; do
  [ -e "$(git rev-parse --git-path "$f")" ] \
    && emit "autocommit: '$f' present -- a merge/rebase is mid-flight. Resolve it, then commit by hand."
done

dirty=$(git status --porcelain)

if [ -n "$dirty" ]; then
  # Credential guard. .gitignore already covers .env, *.pem, *.key, *.p12 and
  # friends; these are the ones that slip past it. EXPO_PUBLIC_* is exempt by
  # design -- CLAUDE.md notes those ship readable in the bundle.
  if paths=$(git status --porcelain -z | tr '\0' '\n' | sed 's/^...//' | grep -Ei \
      '(^|/)\.env($|\.)|\.(pem|key|p12|pfx|jks|mobileprovision|p8)$|(^|/)id_(rsa|ed25519)($|\.)' ); then
    emit "autocommit: BLOCKED -- these look like credential files:
$paths
Nothing was committed or pushed. Remove them or add them to .gitignore."
  fi

  git add -A
  if secrets=$(git diff --cached -U0 | grep -E '^\+' | grep -Ev '^\+.*EXPO_PUBLIC_' | grep -Eo \
      'sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|SERVICE_ROLE_KEY[[:space:]]*[=:][[:space:]]*[A-Za-z0-9._-]{20,}' \
      | sort -u); then
    git reset -q
    emit "autocommit: BLOCKED -- the diff contains what looks like a live secret:
$secrets
Nothing was committed or pushed. Scrub it, then commit by hand."
  fi

  count=$(git diff --cached --name-only | wc -l | tr -d ' ')
  files=$(git diff --cached --name-only | head -8)
  [ "$count" -gt 8 ] && files="$files
... and $((count - 8)) more"

  git commit -q -F - <<MSG
Autocommit: $count file(s) from an assistant turn

Committed by the Stop hook because the turn ended with an uncommitted
working tree. The message is mechanical -- see the diff for what changed.

$files

Co-Authored-By: Claude <noreply@anthropic.com>
MSG
  [ $? -ne 0 ] && emit "autocommit: commit failed, nothing pushed."
  committed=" committed $count file(s) and"
else
  committed=""
fi

# Clean tree still needs a push when earlier commits are unpushed.
if git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' >/dev/null 2>&1 \
   && [ -z "$(git log '@{upstream}..HEAD' --oneline)" ] && [ -z "$committed" ]; then
  exit 0
fi

for delay in 2 4 8 16 0; do
  push=$(git push -u origin "$branch" 2>&1) && \
    emit "autocommit:$committed pushed $branch to origin."
  [ "$delay" -eq 0 ] && break
  sleep "$delay"
done

emit "autocommit: push of $branch FAILED after retries -- your work is committed locally but not on GitHub:
$push"
