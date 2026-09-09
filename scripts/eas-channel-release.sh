#!/usr/bin/env bash
set -euo pipefail

: "${EXPO_TOKEN:?EXPO_TOKEN is required}"
: "${GITHUB_SHA:?GITHUB_SHA is required}"
: "${GITHUB_RUN_ID:?GITHUB_RUN_ID is required}"
: "${GITHUB_RUN_ATTEMPT:?GITHUB_RUN_ATTEMPT is required}"
: "${FACTORY_ARTIFACT_DIGEST:?FACTORY_ARTIFACT_DIGEST is required}"

action="${1:?Use capture, verify, switch, or restore.}"
evidence_path="${2:?Pass staged EAS evidence.}"
state_path="${3:-}"
case "$action" in capture|verify|switch|restore) ;; *) echo '::error::Unknown EAS action.'; exit 1 ;; esac
[[ "$action" == verify || -n "$state_path" ]] || {
  echo '::error::This EAS action requires a state path.'
  exit 1
}

surface=$(jq -er '.surface' "$evidence_path")
case "$surface" in customer|operator|kiosk) app_directory="apps/$surface" ;; *) exit 1 ;; esac
candidate=$(jq -er '.candidateBranch' "$evidence_path")
candidate_id=$(jq -er '.candidateBranchId | select(type == "string" and length > 0)' "$evidence_path")
group=$(jq -er '.updateGroup' "$evidence_path")
project_id=$(jq -er '.projectId' "$evidence_path")
uuid_pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
[[ "$project_id" =~ $uuid_pattern && "$candidate_id" =~ $uuid_pattern ]] || {
  echo '::error::Staged EAS evidence has invalid provider identifiers.'
  exit 1
}
[[ "$group" =~ ^[A-Za-z0-9._:-]+$ && "$group" != -* ]] || {
  echo '::error::Staged EAS evidence has an invalid update group.'
  exit 1
}
runtime='exposdk:54.0.0'
expected_candidate="release-${GITHUB_SHA}-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
jq -e --arg surface "$surface" --arg directory "$app_directory" --arg project "$project_id" \
  --arg sha "$GITHUB_SHA" --arg digest "$FACTORY_ARTIFACT_DIGEST" --arg runtime "$runtime" \
  --arg runId "$GITHUB_RUN_ID" --arg runAttempt "$GITHUB_RUN_ATTEMPT" \
  --arg candidate "$expected_candidate" \
  '.schemaVersion == 1 and .provider == "eas-update" and .status == "staged"
    and .surface == $surface and .appDirectory == $directory and .projectId == $project
    and .channel == "production" and .commitSha == $sha and .artifactDigest == $digest
    and .runtimeVersion == $runtime and .platforms == ["android", "ios"]
    and .runId == $runId and .runAttempt == $runAttempt and .candidateBranch == $candidate
    and (.candidateBranchId | type == "string" and length > 0)
    and (.updateGroup | type == "string" and length > 0)' "$evidence_path" >/dev/null

eas=(npx --yes eas-cli@21.4.0)
root=$(pwd)
temporary_directory=$(mktemp -d)
trap 'rm -r "$temporary_directory"' EXIT
run_in_app() { (cd "$root/$app_directory" && timeout "$@"); }
retry_json() {
  local destination="$1" duration="$2"
  shift 2
  for attempt in 1 2 3; do
    if run_in_app "$duration" "$@" > "$destination"; then return 0; fi
    if (( attempt < 3 )); then sleep $((attempt * 2)); fi
  done
  return 1
}
view_channel() {
  retry_json "$1" 30s "${eas[@]}" channel:view production --limit 100 \
    --json --non-interactive
}
mapped_branch() {
  local source="$1" mapping branch_id
  mapping=$(jq -cer '.currentPage as $channel | ($channel.branchMapping | fromjson) as $map
    | select($channel.name == "production" and $channel.isPaused == false)
    | $map | select(.version == 0 and (.data | length) == 1
      and .data[0].branchMappingLogic == "true")' "$source") || return 1
  branch_id=$(jq -er '.data[0].branchId' <<<"$mapping")
  jq -r --arg id "$branch_id" '[.currentPage.updateBranches[] | select(.id == $id)] as $matches
    | if ($matches | length) > 1 then error("branch mapping is ambiguous")
      else [$id, ($matches[0].name // "")] | @tsv end' "$source"
}
verify_candidate() {
  local config="$temporary_directory/config.json" branch="$temporary_directory/branch.json"
  local updates="$temporary_directory/updates.json"
  retry_json "$config" 30s "${eas[@]}" config --platform ios --profile production \
    --json --non-interactive
  [[ "$(jq -r '.extra.eas.projectId // empty' "$config")" == "$project_id" ]] || return 1
  retry_json "$branch" 30s "${eas[@]}" branch:view "$candidate" \
    --limit 1 --json --non-interactive
  [[ "$(jq -r '.id // empty' "$branch")" == "$candidate_id" ]] || return 1
  [[ "$(jq -r '.currentPage[0].group // empty' "$branch")" == "$group" ]] || return 1
  retry_json "$updates" 30s "${eas[@]}" update:view "$group" --json
  jq -e --arg branch "$candidate" --arg group "$group" --arg runtime "$runtime" \
    --arg sha "$GITHUB_SHA" 'type == "array" and length == 2
      and (map(.platform) | sort) == ["android", "ios"]
      and (map(.group) | unique) == [$group]
      and all(.branch == $branch and .runtimeVersion == $runtime and .gitCommitHash == $sha)' \
    "$updates" >/dev/null
}
if [[ "$action" != restore ]]; then
  verify_candidate || { echo '::error::Staged EAS evidence no longer matches the provider.'; exit 1; }
fi
[[ "$action" == verify ]] && { jq -c '.status = "verified"' "$evidence_path"; exit 0; }

if [[ "$action" == capture ]]; then
  channel="$temporary_directory/channel.json"
  view_channel "$channel"
  IFS=$'\t' read -r prior_id prior_name < <(mapped_branch "$channel")
  [[ -n "$prior_name" ]] || {
    echo '::error::The current EAS production branch name could not be resolved.'
    exit 1
  }
  [[ "$prior_id" != "$candidate_id" && "$prior_name" != "$candidate" ]] || {
    echo '::error::The candidate EAS branch is already live before final promotion.'
    exit 1
  }
  jq -n --arg provider eas-update --arg surface "$surface" --arg projectId "$project_id" \
    --arg channel production --arg priorBranchId "$prior_id" --arg priorBranch "$prior_name" \
    --arg candidateBranch "$candidate" --arg candidateBranchId "$candidate_id" \
    --arg updateGroup "$group" \
    '{schemaVersion:1,provider:$provider,status:"captured",surface:$surface,
      projectId:$projectId,channel:$channel,priorBranchId:$priorBranchId,
      priorBranch:$priorBranch,candidateBranch:$candidateBranch,
      candidateBranchId:$candidateBranchId,updateGroup:$updateGroup}' > "$state_path"
  exit 0
fi

jq -e --arg surface "$surface" --arg project "$project_id" --arg candidate "$candidate" \
  --arg candidateId "$candidate_id" --arg group "$group" \
  '.schemaVersion == 1 and .provider == "eas-update"
    and .status == "captured" and .surface == $surface and .projectId == $project
    and .channel == "production" and .candidateBranch == $candidate and .updateGroup == $group
    and .candidateBranchId == $candidateId
    and (.priorBranchId | length > 0) and (.priorBranch | length > 0)' "$state_path" >/dev/null
prior_id=$(jq -er '.priorBranchId' "$state_path")
prior_name=$(jq -er '.priorBranch' "$state_path")

move_channel() {
  local expected_id="$1" expected_name="$2" target_id="$3" target_name="$4"
  local channel="$temporary_directory/channel-move.json"
  for attempt in 1 2; do
    view_channel "$channel"
    IFS=$'\t' read -r current_id current_name < <(mapped_branch "$channel")
    if [[ "$current_id" == "$target_id" ]]; then
      [[ -z "$current_name" || "$current_name" == "$target_name" ]] && return 0
      echo '::error::The EAS target branch ID resolved to an unexpected name.'
      return 1
    fi
    [[ "$current_id" == "$expected_id" \
      && ( -z "$current_name" || "$current_name" == "$expected_name" ) ]] || {
      echo "::error::EAS channel changed concurrently to ${current_name:-$current_id}; refusing to overwrite it."
      return 1
    }
    run_in_app 45s "${eas[@]}" channel:edit production --branch "$target_name" \
      --json --non-interactive > "$temporary_directory/edit-${attempt}.json" || true
    sleep $((attempt * 2))
  done
  view_channel "$channel"
  IFS=$'\t' read -r current_id current_name < <(mapped_branch "$channel")
  [[ "$current_id" == "$target_id" \
    && ( -z "$current_name" || "$current_name" == "$target_name" ) ]]
}

if [[ "$action" == switch ]]; then
  move_channel "$prior_id" "$prior_name" "$candidate_id" "$candidate" || exit 1
  jq -c '.status = "promoted"' "$evidence_path"
else
  move_channel "$candidate_id" "$candidate" "$prior_id" "$prior_name" || exit 1
  jq -n --arg provider eas-update --arg surface "$surface" --arg projectId "$project_id" \
    --arg restoredBranchId "$prior_id" --arg restoredBranch "$prior_name" \
    '{schemaVersion:1,provider:$provider,status:"restored",surface:$surface,
      projectId:$projectId,restoredBranchId:$restoredBranchId,restoredBranch:$restoredBranch}'
fi
