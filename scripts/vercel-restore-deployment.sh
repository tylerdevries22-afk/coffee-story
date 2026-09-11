#!/usr/bin/env bash
set -euo pipefail

: "${VERCEL_TOKEN:?VERCEL_TOKEN is required}"
: "${VERCEL_SCOPE:?VERCEL_SCOPE is required}"
: "${PROJECT_PREFIX:?PROJECT_PREFIX is required}"
: "${TENANT:?TENANT is required}"
: "${GITHUB_SHA:?GITHUB_SHA is required}"
: "${FACTORY_ARTIFACT_DIGEST:?FACTORY_ARTIFACT_DIGEST is required}"
: "${GITHUB_RUN_ID:?GITHUB_RUN_ID is required}"
: "${GITHUB_RUN_ATTEMPT:?GITHUB_RUN_ATTEMPT is required}"

rollback_path="${1:?Pass one Vercel rollback evidence file.}"
action="${2:-restore}"
case "$action" in
  restore|verify-current) ;;
  *) echo '::error::Unknown Vercel restoration action.' >&2; exit 1 ;;
esac
rollback=$(cat "$rollback_path")
project=$(jq -er '.project' <<<"$rollback")
surface=$(jq -er '.surface' <<<"$rollback")
deployment_url=$(jq -er '.deploymentUrl' <<<"$rollback")
deployment_id=$(jq -er '.deploymentId' <<<"$rollback")
candidate_id=$(jq -er '.candidateDeploymentId' <<<"$rollback")
candidate_url=$(jq -er '.candidateDeploymentUrl' <<<"$rollback")
candidate_deployment_id=$candidate_id
previous_deployment_id=$deployment_id
production_aliases=$(jq -cer \
  '.productionAliases | select(type == "array" and length > 0
    and all(.[]; type == "string"
      and test("^(\\*\\.)?([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\\.)+[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$")))
    | sort | unique' \
  <<<"$rollback")
[[ "$surface" =~ ^(hq|customer|operator|kiosk|display)$ ]] || {
  echo '::error::Rollback evidence names an invalid surface.' >&2
  exit 1
}
[[ "$VERCEL_SCOPE" =~ ^(team_[A-Za-z0-9]+|[a-z0-9]+(-[a-z0-9]+)*)$ ]] || {
  echo '::error::Vercel scope is invalid.' >&2
  exit 1
}
[[ "$TENANT" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ \
  && "$GITHUB_SHA" =~ ^[0-9a-f]{40}$ \
  && "$FACTORY_ARTIFACT_DIGEST" =~ ^sha256:[0-9a-f]{64}$ \
  && "$GITHUB_RUN_ID" =~ ^[0-9]+$ && "$GITHUB_RUN_ATTEMPT" =~ ^[0-9]+$ \
  && "$(git rev-parse HEAD)" == "$GITHUB_SHA" \
  && -z "$(git status --porcelain=v1 --untracked-files=no)" ]] || {
  echo '::error::Vercel restoration requires the exact clean release commit.' >&2
  exit 1
}
expected_project="${PROJECT_PREFIX}-${surface}"
[[ "$expected_project" =~ ^[a-z0-9]+([a-z0-9-]*[a-z0-9])?$ ]] || {
  echo '::error::Expected Vercel project name is invalid.' >&2
  exit 1
}
test "$project" = "$expected_project" || {
  echo '::error::Rollback evidence names an unexpected project.' >&2
  exit 1
}
jq -e --arg tenant "$TENANT" --arg sha "$GITHUB_SHA" \
  --arg digest "$FACTORY_ARTIFACT_DIGEST" \
  --arg runId "$GITHUB_RUN_ID" --arg runAttempt "$GITHUB_RUN_ATTEMPT" \
  --arg operation "${GITHUB_RUN_ID}:${GITHUB_RUN_ATTEMPT}:${surface}:production" \
  '.schemaVersion == 1 and .provider == "vercel" and .status == "rollback-ready"
  and .tenant == $tenant and .commitSha == $sha and .artifactDigest == $digest
  and .deploymentTarget == "production"
  and .runId == $runId and .runAttempt == $runAttempt and .releaseOperation == $operation
  and (.deploymentId | test("^dpl_[A-Za-z0-9]+$"))
  and (.deploymentUrl | test("^https://[A-Za-z0-9-]+\\.vercel\\.app$"))
  and (.candidateDeploymentId | test("^dpl_[A-Za-z0-9]+$"))
  and (.candidateDeploymentUrl | test("^https://[A-Za-z0-9-]+\\.vercel\\.app$"))
  and .deploymentId != .candidateDeploymentId' <<<"$rollback" >/dev/null

vc=(pnpm exec -- vercel)
scope=(--scope "$VERCEL_SCOPE" --token "$VERCEL_TOKEN")
if [[ "$VERCEL_SCOPE" == team_* ]]; then
  scope_query="teamId=$VERCEL_SCOPE"
else
  scope_query="slug=$VERCEL_SCOPE"
fi
# shellcheck source=scripts/vercel-release-state.sh
source scripts/vercel-release-state.sh
release_deadline=$((SECONDS + 420))

record=$(vercel_api_record "$deployment_id")
jq -e --arg id "$deployment_id" --arg project "$project" \
  --arg host "${deployment_url#https://}" \
  '(.uid // .id) == $id and .name == $project and .url == $host
    and (.readyState // .state) == "READY" and .target == "production"' \
  <<<"$record" >/dev/null
candidate_record=$(vercel_api_record "$candidate_id")
jq -e --arg id "$candidate_id" --arg project "$project" \
  --arg host "${candidate_url#https://}" \
  --arg sha "$GITHUB_SHA" --arg digest "$FACTORY_ARTIFACT_DIGEST" \
  '(.uid // .id) == $id and .name == $project and .url == $host
    and (.readyState // .state) == "READY" and .target == "production"
    and .meta.githubCommitSha == $sha and .meta.factoryArtifactDigest == $digest' \
  <<<"$candidate_record" >/dev/null
restore_ok=''
mutation_sent=''
for attempt in $(seq 1 84); do
  (( SECONDS < release_deadline )) || break
  if ! read_release_state; then
    if (( attempt < 84 )); then sleep 5; continue; fi
    break
  fi
  [[ "$rolling_release_active" == false ]] || {
    echo '::error::Vercel has an active rolling release.' >&2
    exit 1
  }
  if previous_aliases_complete && [[ "$current_deployment_id" == "$deployment_id" ]]; then
    if alias_job_pending; then
      if alias_job_matches promote "$candidate_id" \
        || alias_job_matches rollback "$deployment_id"; then
        sleep 5
        continue
      fi
      echo '::error::Another Vercel alias operation is still running.' >&2
      exit 1
    elif [[ -z "$mutation_sent" ]] || { alias_job_matches rollback "$deployment_id" \
      && alias_job_successful; }; then
      restore_ok=1
      break
    fi
  fi
  if [[ "$action" == verify-current ]]; then
    if alias_job_pending && alias_job_matches rollback "$deployment_id"; then
      sleep 5
      continue
    fi
    echo "::error::${project} is no longer routed to the restored deployment." >&2
    exit 1
  fi
  if alias_job_pending; then
    if alias_job_matches promote "$candidate_id" \
      || alias_job_matches rollback "$deployment_id"; then
      sleep 5
      continue
    fi
    echo '::error::Another Vercel alias operation is still running.' >&2
    exit 1
  fi
  if [[ -n "$mutation_sent" ]]; then
    alias_job_matches rollback "$deployment_id" \
      && [[ "$alias_job_status" == failed ]] && break
    sleep 5
    continue
  fi
  [[ "$candidate_aliases" != '[]' \
    && ( "$current_deployment_id" == "$candidate_id" \
      || "$current_deployment_id" == "$deployment_id" ) ]] || {
    echo "::error::${project} aliases changed outside the captured release set." >&2
    exit 1
  }
  mutation_sent=1
  timeout --kill-after=10s 4m "${vc[@]}" rollback "$deployment_url" --yes --timeout 3m \
    "${scope[@]}" >&2 || true
  sleep 2
done
test -n "$restore_ok" || {
  echo "::error::Vercel did not restore ${project} to ${deployment_id}." >&2
  exit 1
}
jq -c --arg status "$(if [[ "$action" == restore ]]; then echo restored; else echo verified; fi)" \
  '.status = $status' <<<"$rollback"
