#!/usr/bin/env bash
set -euo pipefail

: "${EXPO_TOKEN:?EXPO_TOKEN is required}"
: "${GITHUB_SHA:?GITHUB_SHA is required}"
: "${GITHUB_RUN_ID:?GITHUB_RUN_ID is required}"
: "${GITHUB_RUN_ATTEMPT:?GITHUB_RUN_ATTEMPT is required}"
: "${FACTORY_ARTIFACT_DIGEST:?FACTORY_ARTIFACT_DIGEST is required}"

[[ "$GITHUB_SHA" =~ ^[0-9a-f]{40}$ \
  && "$FACTORY_ARTIFACT_DIGEST" =~ ^sha256:[0-9a-f]{64}$ \
  && "$GITHUB_RUN_ID" =~ ^[0-9]+$ && "$GITHUB_RUN_ATTEMPT" =~ ^[0-9]+$ ]] || {
  echo '::error::Hosted release identity is invalid.' >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$GITHUB_SHA" \
  && -z "$(git status --porcelain=v1 --untracked-files=no)" ]] || {
  echo '::error::Hosted release commands require the exact clean commit.' >&2
  exit 1
}

action="${1:?Use capture, verify, verify-live, switch, restore, or verify-restored.}"
evidence_path="${2:?Pass staged EAS evidence.}"
state_path="${3:-}"
case "$action" in
  capture|verify|verify-live|switch|restore|verify-restored) ;;
  *) echo '::error::Unknown EAS action.' >&2; exit 1 ;;
esac
[[ "$action" == verify || -n "$state_path" ]] || {
  echo '::error::This EAS action requires a state path.' >&2
  exit 1
}

surface=$(jq -er '.surface' "$evidence_path")
case "$surface" in
  customer|operator|kiosk) app_directory="apps/$surface" ;;
  *) echo '::error::Staged EAS evidence has an invalid surface.' >&2; exit 1 ;;
esac
candidate=$(jq -er '.candidateBranch' "$evidence_path")
candidate_id=$(jq -er '.candidateBranchId | select(type == "string" and length > 0)' "$evidence_path")
group=$(jq -er '.updateGroup' "$evidence_path")
project_id=$(jq -er '.projectId' "$evidence_path")
candidate_update_digest=$(jq -er '.updateDigest | select(type == "string")' "$evidence_path")
uuid_pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
[[ "$project_id" =~ $uuid_pattern && "$candidate_id" =~ $uuid_pattern ]] || {
  echo '::error::Staged EAS evidence has invalid provider identifiers.' >&2
  exit 1
}
[[ "$group" =~ ^[A-Za-z0-9._:-]+$ && "$group" != -* ]] || {
  echo '::error::Staged EAS evidence has an invalid update group.' >&2
  exit 1
}
[[ "$candidate_update_digest" =~ ^[0-9a-f]{64}$ ]] || {
  echo '::error::Staged EAS evidence has an invalid update digest.' >&2
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
    and (.updateGroup | type == "string" and length > 0)
    and (.updateDigest | test("^[0-9a-f]{64}$"))
    and (.updates | type == "array" and length == 2)' "$evidence_path" >/dev/null

eas=(npx --yes eas-cli@21.4.0)
root=$(pwd)
temporary_directory=$(mktemp -d)
trap 'rm -r "$temporary_directory"' EXIT
run_in_app() { (cd "$root/$app_directory" && timeout --kill-after=10s "$@"); }
# shellcheck source=scripts/eas-release-state.sh
source scripts/eas-release-state.sh
verify_project || { echo '::error::The EAS project identity changed.' >&2; exit 1; }
if [[ "$action" != restore && "$action" != verify-restored ]]; then
  verify_candidate || { echo '::error::Staged EAS evidence no longer matches the provider.' >&2; exit 1; }
fi
[[ "$action" == verify ]] && { jq -c '.status = "verified"' "$evidence_path"; exit 0; }

if [[ "$action" == capture ]]; then
  channel="$temporary_directory/channel.json"
  view_channel "$channel"
  IFS=$'\t' read -r prior_id prior_name < <(mapped_branch "$channel")
  [[ "$prior_id" =~ $uuid_pattern ]] || {
    echo '::error::The current EAS production branch identifier is invalid.' >&2
    exit 1
  }
  [[ -n "$prior_name" ]] || {
    echo '::error::The current EAS production branch name could not be resolved.' >&2
    exit 1
  }
  [[ "$prior_id" != "$candidate_id" && "$prior_name" != "$candidate" ]] || {
    echo '::error::The candidate EAS branch is already live before final promotion.' >&2
    exit 1
  }
  IFS=$'\t' read -r prior_group prior_digest \
    < <(branch_snapshot "$prior_name" "$prior_id")
  [[ "$prior_group" =~ ^[A-Za-z0-9._:-]+$ && "$prior_digest" =~ ^[0-9a-f]{64}$ ]] || {
    echo '::error::The current EAS production update could not be captured exactly.' >&2
    exit 1
  }
  jq -cn --arg provider eas-update --arg surface "$surface" --arg projectId "$project_id" \
    --arg channel production --arg priorBranchId "$prior_id" --arg priorBranch "$prior_name" \
    --arg priorUpdateGroup "$prior_group" --arg priorUpdateDigest "$prior_digest" \
    --arg candidateBranch "$candidate" --arg candidateBranchId "$candidate_id" \
    --arg updateGroup "$group" \
    '{schemaVersion:1,provider:$provider,status:"captured",surface:$surface,
      projectId:$projectId,channel:$channel,priorBranchId:$priorBranchId,
      priorBranch:$priorBranch,priorUpdateGroup:$priorUpdateGroup,
      priorUpdateDigest:$priorUpdateDigest,candidateBranch:$candidateBranch,
      candidateBranchId:$candidateBranchId,updateGroup:$updateGroup}' > "$state_path"
  exit 0
fi

jq -e --arg surface "$surface" --arg project "$project_id" --arg candidate "$candidate" \
  --arg candidateId "$candidate_id" --arg group "$group" \
  '.schemaVersion == 1 and .provider == "eas-update"
    and .status == "captured" and .surface == $surface and .projectId == $project
    and .channel == "production" and .candidateBranch == $candidate and .updateGroup == $group
    and .candidateBranchId == $candidateId
    and (.priorBranchId | type == "string" and length > 0)
    and (.priorBranch | type == "string" and length > 0)
    and (.priorUpdateGroup | type == "string" and length > 0)
    and (.priorUpdateDigest | test("^[0-9a-f]{64}$"))' "$state_path" >/dev/null
prior_id=$(jq -er '.priorBranchId' "$state_path")
prior_name=$(jq -er '.priorBranch' "$state_path")
prior_group=$(jq -er '.priorUpdateGroup' "$state_path")
prior_digest=$(jq -er '.priorUpdateDigest' "$state_path")
[[ "$prior_id" =~ $uuid_pattern ]] || {
  echo '::error::Captured EAS rollback evidence has an invalid branch identifier.' >&2
  exit 1
}
[[ "$prior_name" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ \
  && "$prior_group" =~ ^[A-Za-z0-9._:-]+$ \
  && "$prior_id" != "$candidate_id" && "$prior_name" != "$candidate" ]] || {
  echo '::error::Captured EAS rollback identity is invalid.' >&2
  exit 1
}

if [[ "$action" == verify-live ]]; then
  channel="$temporary_directory/channel-live.json"
  view_channel "$channel"
  IFS=$'\t' read -r current_id current_name < <(mapped_branch "$channel")
  [[ "$current_id" == "$candidate_id" \
    && ( -z "$current_name" || "$current_name" == "$candidate" ) ]] || {
    echo '::error::The EAS production channel no longer targets the candidate.' >&2
    exit 1
  }
  jq -c '.status = "verified"' "$evidence_path"
  exit 0
fi

if [[ "$action" == verify-restored ]]; then
  verify_branch_snapshot "$prior_name" "$prior_id" "$prior_group" "$prior_digest" || {
    echo '::error::The captured EAS rollback branch no longer matches its snapshot.' >&2
    exit 1
  }
  channel="$temporary_directory/channel-restored.json"
  view_channel "$channel"
  IFS=$'\t' read -r current_id current_name < <(mapped_branch "$channel")
  [[ "$current_id" == "$prior_id" \
    && ( -z "$current_name" || "$current_name" == "$prior_name" ) ]] || {
    echo '::error::The EAS production channel no longer targets the restored branch.' >&2
    exit 1
  }
  jq -c '.status = "verified"' "$state_path"
  exit 0
fi

if [[ "$action" == switch ]]; then
  verify_candidate || { echo '::error::The EAS candidate changed before promotion.' >&2; exit 1; }
  move_channel "$prior_id" "$prior_name" "$candidate_id" "$candidate" || exit 1
  verify_candidate || { echo '::error::The EAS candidate changed during promotion.' >&2; exit 1; }
  jq -c '.status = "promoted"' "$evidence_path"
else
  verify_branch_snapshot "$prior_name" "$prior_id" "$prior_group" "$prior_digest" || {
    echo '::error::The captured EAS rollback branch changed before restoration.' >&2
    exit 1
  }
  move_channel "$candidate_id" "$candidate" "$prior_id" "$prior_name" || exit 1
  verify_branch_snapshot "$prior_name" "$prior_id" "$prior_group" "$prior_digest" || {
    echo '::error::The restored EAS update no longer matches the captured state.' >&2
    exit 1
  }
  jq -n --arg provider eas-update --arg surface "$surface" --arg projectId "$project_id" \
    --arg restoredBranchId "$prior_id" --arg restoredBranch "$prior_name" \
    '{schemaVersion:1,provider:$provider,status:"restored",surface:$surface,
      projectId:$projectId,restoredBranchId:$restoredBranchId,restoredBranch:$restoredBranch}'
fi
