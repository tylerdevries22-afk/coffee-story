#!/usr/bin/env bash
set -euo pipefail

: "${VERCEL_TOKEN:?VERCEL_TOKEN is required}"
: "${VERCEL_SCOPE:?VERCEL_SCOPE is required}"
: "${PROJECT_PREFIX:?PROJECT_PREFIX is required}"

rollback_path="${1:?Pass one Vercel rollback evidence file.}"
rollback=$(cat "$rollback_path")
project=$(jq -er '.project' <<<"$rollback")
surface=$(jq -er '.surface' <<<"$rollback")
deployment_url=$(jq -er '.deploymentUrl' <<<"$rollback")
deployment_id=$(jq -er '.deploymentId' <<<"$rollback")
candidate_id=$(jq -er '.candidateDeploymentId' <<<"$rollback")
[[ "$surface" =~ ^(hq|customer|operator|kiosk|display)$ ]] || {
  echo '::error::Rollback evidence names an invalid surface.'
  exit 1
}
[[ "$VERCEL_SCOPE" =~ ^(team_[A-Za-z0-9]+|[a-z0-9]+(-[a-z0-9]+)*)$ ]] || {
  echo '::error::Vercel scope is invalid.'
  exit 1
}
expected_project="${PROJECT_PREFIX}-${surface}"
[[ "$expected_project" =~ ^[a-z0-9]+([a-z0-9-]*[a-z0-9])?$ ]] || {
  echo '::error::Expected Vercel project name is invalid.'
  exit 1
}
test "$project" = "$expected_project" || {
  echo '::error::Rollback evidence names an unexpected project.'
  exit 1
}
jq -e '.schemaVersion == 1 and .provider == "vercel" and .status == "rollback-ready"
  and (.deploymentId | test("^dpl_[A-Za-z0-9]+$"))
  and (.deploymentUrl | test("^https://[^/]+\\.vercel\\.app$"))
  and (.candidateDeploymentId | test("^dpl_[A-Za-z0-9]+$"))
  and (.candidateDeploymentUrl | test("^https://[^/]+\\.vercel\\.app$"))
  and .deploymentId != .candidateDeploymentId' <<<"$rollback" >/dev/null

vc=(pnpm exec -- vercel)
scope=(--scope "$VERCEL_SCOPE" --token "$VERCEL_TOKEN")
if [[ "$VERCEL_SCOPE" == team_* ]]; then
  scope_query="teamId=$VERCEL_SCOPE"
else
  scope_query="slug=$VERCEL_SCOPE"
fi
api_record() {
  local deployment="$1"
  curl --silent --show-error --fail-with-body --retry 2 --retry-all-errors \
    --connect-timeout 5 --max-time 15 -H "Authorization: Bearer $VERCEL_TOKEN" \
    "https://api.vercel.com/v13/deployments/${deployment}?${scope_query}"
}

record=$(api_record "$deployment_id")
jq -e --arg id "$deployment_id" --arg project "$project" \
  --arg host "${deployment_url#https://}" \
  '(.uid // .id) == $id and .name == $project and .url == $host
    and (.readyState // .state) == "READY"' <<<"$record" >/dev/null
restore_started=''
for attempt in 1 2; do
  current_record=$(api_record "${project}.vercel.app")
  current_id=$(jq -er '.uid // .id' <<<"$current_record")
  if [[ "$current_id" == "$deployment_id" ]]; then
    restore_started=1
    break
  fi
  [[ "$current_id" == "$candidate_id" ]] || {
    echo "::error::${project} changed concurrently to ${current_id}; refusing to overwrite it."
    exit 1
  }
  if timeout 4m "${vc[@]}" promote "$deployment_url" --yes --timeout 3m \
    "${scope[@]}" >&2; then
    restore_started=1
    break
  fi
  if (( attempt < 2 )); then sleep $((attempt * 2)); fi
done
test -n "$restore_started" || {
  echo "::error::Vercel rejected restoration of ${project}."
  exit 1
}

restored=''
for _attempt in $(seq 1 6); do
  record=$(api_record "${project}.vercel.app" || true)
  if [[ "$(jq -r '.uid // .id // empty' <<<"${record:-{}}")" == "$deployment_id" \
    && "$(jq -r '.target // empty' <<<"${record:-{}}")" == production \
    && "$(jq -r '.readyState // .state // empty' <<<"${record:-{}}")" == READY ]]; then
    restored=1
    break
  fi
  sleep 5
done
test -n "$restored" || {
  echo "::error::Vercel did not restore ${project} to ${deployment_id}."
  exit 1
}
jq -c '.status = "restored"' <<<"$rollback"
