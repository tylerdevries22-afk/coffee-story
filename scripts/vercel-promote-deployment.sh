#!/usr/bin/env bash
set -euo pipefail

: "${VERCEL_TOKEN:?VERCEL_TOKEN is required}"
: "${VERCEL_SCOPE:?VERCEL_SCOPE is required}"
: "${GITHUB_SHA:?GITHUB_SHA is required}"
: "${FACTORY_ARTIFACT_DIGEST:?FACTORY_ARTIFACT_DIGEST is required}"
: "${TENANT:?TENANT is required}"

evidence_path="${1:?Pass one staged Vercel evidence file.}"
rollback_path="${2:?Pass the matching Vercel rollback evidence file.}"
evidence=$(cat "$evidence_path")
rollback=$(cat "$rollback_path")
project=$(jq -er '.project' <<<"$evidence")
surface=$(jq -er '.surface' <<<"$evidence")
deployment_url=$(jq -er '.deploymentUrl' <<<"$evidence")
deployment_id=$(jq -er '.deploymentId' <<<"$evidence")
prior_deployment_id=$(jq -er '.deploymentId' <<<"$rollback")

[[ "$surface" =~ ^(hq|customer|operator|kiosk|display)$ ]] || {
  echo '::error::Staged Vercel evidence names an invalid surface.'
  exit 1
}
[[ "$VERCEL_SCOPE" =~ ^(team_[A-Za-z0-9]+|[a-z0-9]+(-[a-z0-9]+)*)$ ]] || {
  echo '::error::Vercel scope is invalid.'
  exit 1
}

jq -e --arg sha "$GITHUB_SHA" --arg digest "$FACTORY_ARTIFACT_DIGEST" \
  --arg project "$project" --arg surface "$surface" \
  '.provider == "vercel" and .status == "canary-passed"
    and .commitSha == $sha and .artifactDigest == $digest
    and .project == $project and .surface == $surface
    and (.deploymentId | test("^dpl_[A-Za-z0-9]+$"))
    and (.deploymentUrl | test("^https://[A-Za-z0-9-]+\\.vercel\\.app$"))' \
  <<<"$evidence" >/dev/null
expected_project="${PROJECT_PREFIX:?PROJECT_PREFIX is required}-${surface}"
[[ "$expected_project" =~ ^[a-z0-9]+([a-z0-9-]*[a-z0-9])?$ ]] || {
  echo '::error::Expected Vercel project name is invalid.'
  exit 1
}
test "$project" = "$expected_project" || {
  echo '::error::Staged Vercel evidence names an unexpected project.'
  exit 1
}
jq -e --arg project "$project" --arg surface "$surface" \
  --arg candidateId "$deployment_id" --arg candidateUrl "$deployment_url" \
  '.schemaVersion == 1 and .provider == "vercel" and .status == "rollback-ready"
    and .project == $project and .surface == $surface
    and .candidateDeploymentId == $candidateId
    and .candidateDeploymentUrl == $candidateUrl
    and (.deploymentId | test("^dpl_[A-Za-z0-9]+$"))
    and .deploymentId != $candidateId' <<<"$rollback" >/dev/null

vc=(pnpm exec -- vercel)
scope=(--scope "$VERCEL_SCOPE" --token "$VERCEL_TOKEN")
if [[ "$VERCEL_SCOPE" == team_* ]]; then
  scope_query="teamId=$VERCEL_SCOPE"
else
  scope_query="slug=$VERCEL_SCOPE"
fi
deployment_record() {
  curl --silent --show-error --fail-with-body --retry 2 --retry-all-errors \
    --connect-timeout 5 --max-time 15 -H "Authorization: Bearer $VERCEL_TOKEN" \
    "https://api.vercel.com/v13/deployments/${deployment_id}?${scope_query}"
}
canonical_record() {
  curl --silent --show-error --fail-with-body --retry 2 --retry-all-errors \
    --connect-timeout 5 --max-time 15 -H "Authorization: Bearer $VERCEL_TOKEN" \
    "https://api.vercel.com/v13/deployments/${project}.vercel.app?${scope_query}"
}

record=$(deployment_record)
jq -e --arg id "$deployment_id" --arg sha "$GITHUB_SHA" \
  --arg digest "$FACTORY_ARTIFACT_DIGEST" --arg project "$project" \
  --arg host "${deployment_url#https://}" \
  '(.uid // .id) == $id and .name == $project and (.readyState // .state) == "READY"
    and .url == $host and .meta.githubCommitSha == $sha
    and .meta.factoryArtifactDigest == $digest' \
  <<<"$record" >/dev/null
promote_ok=''
for attempt in 1 2; do
  record=$(canonical_record)
  current_deployment_id=$(jq -er '.uid // .id' <<<"$record")
  if [[ "$current_deployment_id" == "$deployment_id" ]]; then
    promote_ok=1
    break
  fi
  [[ "$current_deployment_id" == "$prior_deployment_id" ]] || {
    echo "::error::${project} changed concurrently to ${current_deployment_id}; refusing to overwrite it."
    exit 1
  }
  if timeout 4m "${vc[@]}" promote "$deployment_url" --yes --timeout 3m \
    "${scope[@]}" >&2; then
    promote_ok=1
    break
  fi
  if (( attempt < 2 )); then sleep $((attempt * 2)); fi
done
test -n "$promote_ok" || { echo '::error::Vercel promotion failed.'; exit 1; }

promoted=''
for _attempt in $(seq 1 6); do
  record=$(canonical_record || true)
  if [[ "$(jq -r '.uid // .id // empty' <<<"${record:-{}}")" == "$deployment_id" \
    && "$(jq -r '.target // empty' <<<"${record:-{}}")" == production \
    && "$(jq -r '.readyState // .state // empty' <<<"${record:-{}}")" == READY ]]; then
    promoted=1
    break
  fi
  sleep 5
done
test -n "$promoted" || { echo '::error::Vercel did not confirm promotion.'; exit 1; }

canonical="https://${project}.vercel.app"
vercel_target=(--deployment "$canonical" "${scope[@]}")
curl_flags=(--fail-with-body --retry 1 --retry-all-errors --connect-timeout 5 --max-time 30)
if [[ "$surface" == hq ]]; then
  : "${HEALTH_CHECK_TOKEN:?HEALTH_CHECK_TOKEN is required for HQ verification}"
  body=$(timeout 75s "${vc[@]}" curl '/api/health?deep=1' "${vercel_target[@]}" -- \
    "${curl_flags[@]}" --header "x-health-check-token: $HEALTH_CHECK_TOKEN")
  jq -e --arg tenant "$TENANT" --arg commit "$GITHUB_SHA" \
    '.version as $version | .ok == true and .tenant == $tenant
      and ($version | type) == "string" and ($version | length) >= 7
      and ($commit | startswith($version))' \
    <<<"$body" >/dev/null
else
  body=$(timeout 75s "${vc[@]}" curl / "${vercel_target[@]}" -- "${curl_flags[@]}")
  grep -Eiq "platform-tenant[^>]*${TENANT}|${TENANT}[^>]*platform-tenant" <<<"$body"
fi

jq -c '.status = "promoted"' <<<"$evidence"
