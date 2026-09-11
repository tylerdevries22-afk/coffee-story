#!/usr/bin/env bash
set -euo pipefail

: "${EXPO_TOKEN:?EXPO_TOKEN is required}"
: "${SURFACE:?SURFACE is required}"
: "${GITHUB_SHA:?GITHUB_SHA is required}"
: "${GITHUB_RUN_ID:?GITHUB_RUN_ID is required}"
: "${GITHUB_RUN_ATTEMPT:?GITHUB_RUN_ATTEMPT is required}"
: "${FACTORY_ARTIFACT_DIGEST:?FACTORY_ARTIFACT_DIGEST is required}"

case "$SURFACE" in
  customer|operator|kiosk) app_directory="apps/$SURFACE" ;;
  *) echo '::error::Native surface is invalid.' >&2; exit 1 ;;
esac
[[ "$GITHUB_SHA" =~ ^[0-9a-f]{40}$ ]] || {
  echo '::error::A full immutable Git commit SHA is required.' >&2
  exit 1
}
[[ "$FACTORY_ARTIFACT_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || {
  echo '::error::A canonical factory artifact digest is required.' >&2
  exit 1
}
[[ "$GITHUB_RUN_ID" =~ ^[0-9]+$ && "$GITHUB_RUN_ATTEMPT" =~ ^[0-9]+$ ]] || {
  echo '::error::GitHub run identity is invalid.' >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$GITHUB_SHA" ]] || {
  echo '::error::The checked-out source does not match the requested update commit.' >&2
  exit 1
}
[[ -z "$(git status --porcelain=v1 --untracked-files=all)" ]] || {
  echo '::error::Exact-commit updates require a clean checkout.' >&2
  exit 1
}

eas=(npx --yes eas-cli@21.4.0)
candidate_branch="release-${GITHUB_SHA}-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
message="release:${GITHUB_SHA}:${SURFACE}:${GITHUB_RUN_ID}:${GITHUB_RUN_ATTEMPT}"
runtime_version='exposdk:54.0.0'
work_directory=$(pwd)
temporary_directory=$(mktemp -d)
trap 'rm -r "$temporary_directory"' EXIT

run_in_app() {
  (cd "$work_directory/$app_directory" && timeout --kill-after=10s "$@")
}

retry_json() {
  local destination="$1" duration="$2"
  shift 2
  for attempt in 1 2 3; do
    if run_in_app "$duration" "$@" > "$destination"; then return 0; fi
    if (( attempt < 3 )); then sleep $((attempt * 2)); fi
  done
  return 1
}

canonical_updates() {
  local source="$1" group="$2"
  jq -ce --arg branch "$candidate_branch" --arg group "$group" \
    --arg runtime "$runtime_version" --arg sha "$GITHUB_SHA" \
    'if type == "array" and length == 2
        and (map(.platform) | sort) == ["android", "ios"]
        and (map(.id) | unique | length) == 2
        and (map(.group) | unique) == [$group]
        and all(.[]; .branch == $branch and .runtimeVersion == $runtime
          and .gitCommitHash == $sha
          and (.id | type == "string"
            and test("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"))
          and (.manifestPermalink | type == "string" and test("^https://[^[:space:]]+$")))
      then map({id,platform,manifestPermalink}) | sort_by(.id)
      else error("invalid EAS update set") end' "$source"
}

validate_group() {
  canonical_updates "$1" "$2" >/dev/null
}

config_json="$temporary_directory/config.json"
retry_json "$config_json" 45s "${eas[@]}" config --platform ios --profile production \
  --json --non-interactive
project_id=$(jq -er '.extra.eas.projectId
  | select(type == "string"
    and test("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"))' \
  "$config_json")

group=''
update_json="$temporary_directory/update.json"
if run_in_app 20m "${eas[@]}" update --branch "$candidate_branch" \
  --environment production --platform all --message "$message" \
  --json --non-interactive > "$update_json"; then
  published_group=$(jq -er 'if type == "array" and length > 0
    and (map(.group) | unique | length) == 1 then .[0].group else error("invalid group") end' \
    "$update_json" 2>/dev/null || true)
  if [[ -n "$published_group" ]] && validate_group "$update_json" "$published_group"; then
    group="$published_group"
    cp "$update_json" "$temporary_directory/group.json"
  fi
fi
# shellcheck source=scripts/eas-stage-state.sh
source scripts/eas-stage-state.sh
if [[ -z "$group" ]]; then
  recovery_deadline=$((SECONDS + 180))
  group=$(reconcile_group_until "$recovery_deadline" || true)
fi
[[ -n "$group" ]] || { echo '::error::EAS did not publish or reconcile the candidate update.' >&2; exit 1; }

branch_json="$temporary_directory/branch-final.json"
retry_json "$branch_json" 45s "${eas[@]}" branch:view "$candidate_branch" \
  --limit 1 --json --non-interactive
[[ "$(jq -r '.currentPage[0].group // empty' "$branch_json")" == "$group" ]] || {
  echo '::error::The candidate branch does not expose the staged update group.' >&2
  exit 1
}
candidate_branch_id=$(jq -er '.id | select(type == "string" and length > 0)' "$branch_json")
[[ "$candidate_branch_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || {
  echo '::error::EAS returned an invalid candidate branch identifier.' >&2
  exit 1
}
retry_json "$temporary_directory/group-final.json" 45s "${eas[@]}" update:view "$group" \
  --json --non-interactive
validate_group "$temporary_directory/group-final.json" "$group"
updates=$(canonical_updates "$temporary_directory/group-final.json" "$group")
update_digest=$(printf '%s' "$updates" | sha256sum | cut -d' ' -f1)

mkdir -p eas-stage
jq -n --arg provider eas-update --arg surface "$SURFACE" --arg appDirectory "$app_directory" \
  --arg projectId "$project_id" --arg channel production --arg candidateBranch "$candidate_branch" \
  --arg candidateBranchId "$candidate_branch_id" --arg updateGroup "$group" \
  --arg runtimeVersion "$runtime_version" --arg commitSha "$GITHUB_SHA" \
  --arg artifactDigest "$FACTORY_ARTIFACT_DIGEST" --arg runId "$GITHUB_RUN_ID" \
  --arg runAttempt "$GITHUB_RUN_ATTEMPT" --arg updateDigest "$update_digest" \
  --argjson updates "$updates" \
  '{schemaVersion:1,provider:$provider,status:"staged",surface:$surface,
    appDirectory:$appDirectory,projectId:$projectId,channel:$channel,
    candidateBranch:$candidateBranch,candidateBranchId:$candidateBranchId,
    updateGroup:$updateGroup,runtimeVersion:$runtimeVersion,
    platforms:["android","ios"],commitSha:$commitSha,artifactDigest:$artifactDigest,
    runId:$runId,runAttempt:$runAttempt,updateDigest:$updateDigest,updates:$updates}' \
  > "eas-stage/${SURFACE}.json"
printf "### %s EAS candidate\n\n\`%s\` on \`%s\`\n" "$SURFACE" "$group" "$candidate_branch" \
  >> "${GITHUB_STEP_SUMMARY:?GITHUB_STEP_SUMMARY is required}"
