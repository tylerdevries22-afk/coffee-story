#!/usr/bin/env bash
set -euo pipefail

: "${VERCEL_TOKEN:?VERCEL_TOKEN is required}"
: "${VERCEL_SCOPE:?VERCEL_SCOPE is required}"
: "${PROJECT_PREFIX:?PROJECT_PREFIX is required}"

evidence_path="${1:?Pass one staged Vercel evidence file.}"
evidence=$(cat "$evidence_path")
project=$(jq -er '.project' <<<"$evidence")
surface=$(jq -er '.surface' <<<"$evidence")
candidate_id=$(jq -er '.deploymentId' <<<"$evidence")
candidate_url=$(jq -er '.deploymentUrl' <<<"$evidence")
[[ "$surface" =~ ^(hq|customer|operator|kiosk|display)$ ]] || {
  echo '::error::Staged Vercel evidence names an invalid surface.'
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
  echo '::error::Staged Vercel evidence names an unexpected project.'
  exit 1
}
jq -e --arg project "$project" --arg surface "$surface" \
  --arg candidateId "$candidate_id" --arg candidateUrl "$candidate_url" \
  '.provider == "vercel" and .status == "canary-passed"
    and .project == $project and .surface == $surface
    and .deploymentId == $candidateId and .deploymentUrl == $candidateUrl
    and ($candidateId | test("^dpl_[A-Za-z0-9]+$"))
    and ($candidateUrl | test("^https://[^/]+\\.vercel\\.app$"))' <<<"$evidence" >/dev/null

if [[ "$VERCEL_SCOPE" == team_* ]]; then
  scope_query="teamId=$VERCEL_SCOPE"
else
  scope_query="slug=$VERCEL_SCOPE"
fi
canonical_host="${project}.vercel.app"
record=$(curl --silent --show-error --fail-with-body --retry 2 --retry-all-errors \
  --connect-timeout 5 --max-time 15 -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v13/deployments/${canonical_host}?${scope_query}")

deployment_id=$(jq -r '.uid // .id // empty' <<<"$record")
deployment_host=$(jq -r '.url // empty' <<<"$record")
jq -e --arg id "$deployment_id" --arg host "$deployment_host" \
  --arg project "$project" \
  '($id | test("^dpl_[A-Za-z0-9]+$"))
    and ($host | test("^[A-Za-z0-9-]+\\.vercel\\.app$"))
    and .name == $project and (.readyState // .state) == "READY"
    and .target == "production"' <<<"$record" >/dev/null || {
  echo "::error::${project} has no validated production deployment to restore."
  exit 1
}
test "$deployment_id" != "$candidate_id" || {
  echo "::error::${project} candidate is already live before final promotion."
  exit 1
}

jq -cn --arg deploymentId "$deployment_id" \
  --arg deploymentUrl "https://${deployment_host}" --arg project "$project" \
  --arg surface "$surface" --arg candidateDeploymentId "$candidate_id" \
  --arg candidateDeploymentUrl "$candidate_url" \
  '{schemaVersion:1,provider:"vercel",project:$project,surface:$surface,
    deploymentId:$deploymentId,deploymentUrl:$deploymentUrl,
    candidateDeploymentId:$candidateDeploymentId,
    candidateDeploymentUrl:$candidateDeploymentUrl,
    status:"rollback-ready"}'
