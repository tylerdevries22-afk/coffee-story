#!/usr/bin/env bash
set -euo pipefail

: "${VERCEL_TOKEN:?VERCEL_TOKEN is required}"
: "${VERCEL_SCOPE:?VERCEL_SCOPE is required}"
: "${GITHUB_SHA:?GITHUB_SHA is required}"
: "${FACTORY_ARTIFACT_DIGEST:?FACTORY_ARTIFACT_DIGEST is required}"
: "${TENANT:?TENANT is required}"
: "${GITHUB_RUN_ID:?GITHUB_RUN_ID is required}"
: "${GITHUB_RUN_ATTEMPT:?GITHUB_RUN_ATTEMPT is required}"

evidence_path="${1:?Pass one staged Vercel evidence file.}"
rollback_path="${2:?Pass the matching Vercel rollback evidence file.}"
action="${3:-promote}"
case "$action" in
  promote|verify-current) ;;
  *) echo '::error::Unknown Vercel promotion action.' >&2; exit 1 ;;
esac
evidence=$(cat "$evidence_path")
rollback=$(cat "$rollback_path")
project=$(jq -er '.project' <<<"$evidence")
surface=$(jq -er '.surface' <<<"$evidence")
deployment_url=$(jq -er '.deploymentUrl' <<<"$evidence")
deployment_id=$(jq -er '.deploymentId' <<<"$evidence")
prior_deployment_id=$(jq -er '.deploymentId' <<<"$rollback")
candidate_deployment_id=$deployment_id
previous_deployment_id=$prior_deployment_id
production_aliases=$(jq -cer \
  '.productionAliases | select(type == "array" and length > 0
    and all(.[]; type == "string"
      and test("^(\\*\\.)?([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\\.)+[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$")))
    | sort | unique' \
  <<<"$rollback")

[[ "$surface" =~ ^(hq|customer|operator|kiosk|display)$ ]] || {
  echo '::error::Staged Vercel evidence names an invalid surface.' >&2
  exit 1
}
[[ "$VERCEL_SCOPE" =~ ^(team_[A-Za-z0-9]+|[a-z0-9]+(-[a-z0-9]+)*)$ ]] || {
  echo '::error::Vercel scope is invalid.' >&2
  exit 1
}
[[ "$TENANT" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || {
  echo '::error::Tenant slug is invalid.' >&2
  exit 1
}
[[ "$GITHUB_SHA" =~ ^[0-9a-f]{40}$ \
  && "$FACTORY_ARTIFACT_DIGEST" =~ ^sha256:[0-9a-f]{64}$ \
  && "$GITHUB_RUN_ID" =~ ^[0-9]+$ && "$GITHUB_RUN_ATTEMPT" =~ ^[0-9]+$ ]] || {
  echo '::error::Vercel promotion release identity is invalid.' >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$GITHUB_SHA" \
  && -z "$(git status --porcelain=v1 --untracked-files=no)" ]] || {
  echo '::error::Vercel promotion requires the exact clean release commit.' >&2
  exit 1
}

jq -e --arg sha "$GITHUB_SHA" --arg digest "$FACTORY_ARTIFACT_DIGEST" \
  --arg project "$project" --arg surface "$surface" \
  --arg runId "$GITHUB_RUN_ID" --arg runAttempt "$GITHUB_RUN_ATTEMPT" \
  --arg operation "${GITHUB_RUN_ID}:${GITHUB_RUN_ATTEMPT}:${surface}:production" \
  '.schemaVersion == 1 and .provider == "vercel" and .status == "canary-passed"
    and .commitSha == $sha and .artifactDigest == $digest
    and .project == $project and .surface == $surface
    and .deploymentTarget == "production"
    and .runId == $runId and .runAttempt == $runAttempt and .releaseOperation == $operation
    and (.deploymentId | test("^dpl_[A-Za-z0-9]+$"))
    and (.deploymentUrl | test("^https://[A-Za-z0-9-]+\\.vercel\\.app$"))' \
  <<<"$evidence" >/dev/null
test "$(jq -r '.tenant // empty' <<<"$evidence")" = "$TENANT" || {
  echo '::error::Staged Vercel evidence names an unexpected tenant.' >&2
  exit 1
}
expected_project="${PROJECT_PREFIX:?PROJECT_PREFIX is required}-${surface}"
[[ "$expected_project" =~ ^[a-z0-9]+([a-z0-9-]*[a-z0-9])?$ ]] || {
  echo '::error::Expected Vercel project name is invalid.' >&2
  exit 1
}
test "$project" = "$expected_project" || {
  echo '::error::Staged Vercel evidence names an unexpected project.' >&2
  exit 1
}
jq -e --arg project "$project" --arg surface "$surface" --arg tenant "$TENANT" \
  --arg sha "$GITHUB_SHA" --arg digest "$FACTORY_ARTIFACT_DIGEST" \
  --arg runId "$GITHUB_RUN_ID" --arg runAttempt "$GITHUB_RUN_ATTEMPT" \
  --arg operation "${GITHUB_RUN_ID}:${GITHUB_RUN_ATTEMPT}:${surface}:production" \
  --arg candidateId "$deployment_id" --arg candidateUrl "$deployment_url" \
  '.schemaVersion == 1 and .provider == "vercel" and .status == "rollback-ready"
    and .project == $project and .surface == $surface
    and .candidateDeploymentId == $candidateId
    and .candidateDeploymentUrl == $candidateUrl
    and .tenant == $tenant and .commitSha == $sha and .artifactDigest == $digest
    and .deploymentTarget == "production"
    and .runId == $runId and .runAttempt == $runAttempt and .releaseOperation == $operation
    and (.deploymentId | test("^dpl_[A-Za-z0-9]+$"))
    and .deploymentId != $candidateId' <<<"$rollback" >/dev/null

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
jq -e --arg id "$deployment_id" --arg sha "$GITHUB_SHA" \
  --arg digest "$FACTORY_ARTIFACT_DIGEST" --arg project "$project" \
  --arg host "${deployment_url#https://}" \
  '(.uid // .id) == $id and .name == $project and (.readyState // .state) == "READY"
    and .target == "production"
    and .url == $host and .meta.githubCommitSha == $sha
    and .meta.factoryArtifactDigest == $digest' \
  <<<"$record" >/dev/null
promote_ok=''
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
  if candidate_aliases_complete && [[ "$current_deployment_id" == "$deployment_id" ]] \
    && alias_job_matches promote "$deployment_id" \
    && alias_job_successful; then
    promote_ok=1
    break
  fi
  [[ "$action" == promote ]] || {
    echo "::error::${project} is no longer routed to the promoted deployment." >&2
    exit 1
  }
  if alias_job_pending; then
    alias_job_matches promote "$deployment_id" || {
      echo '::error::Another Vercel alias operation is still running.' >&2
      exit 1
    }
    sleep 5
    continue
  fi
  if [[ -n "$mutation_sent" ]]; then
    alias_job_matches promote "$deployment_id" \
      && [[ "$alias_job_status" == failed ]] && break
    sleep 5
    continue
  fi
  previous_aliases_complete && [[ "$current_deployment_id" == "$prior_deployment_id" ]] || {
    echo "::error::${project} aliases changed without a matching promotion job." >&2
    exit 1
  }
  rolling_release_disabled || { echo '::error::Disable Vercel rolling releases first.' >&2; exit 1; }
  mutation_sent=1
  timeout --kill-after=10s 4m "${vc[@]}" promote "$deployment_url" --yes --timeout 3m \
    "${scope[@]}" >&2 || true
  sleep 2
done
test -n "$promote_ok" || { echo '::error::Vercel promotion failed.' >&2; exit 1; }

canonical="https://${project}.vercel.app"
vercel_target=(--deployment "$canonical" "${scope[@]}")
curl_flags=(--fail-with-body --retry 1 --retry-all-errors --connect-timeout 5 --max-time 30)
health_failed() { echo '::error::Vercel post-promotion health check did not match the release.' >&2; exit 1; }
if [[ "$surface" == hq ]]; then
  : "${HEALTH_CHECK_TOKEN:?HEALTH_CHECK_TOKEN is required for HQ verification}"
  body=$(timeout --kill-after=10s 75s "${vc[@]}" curl '/api/health?deep=1' "${vercel_target[@]}" -- \
    "${curl_flags[@]}" --header "x-health-check-token: $HEALTH_CHECK_TOKEN")
  jq -e --arg tenant "$TENANT" --arg commit "$GITHUB_SHA" \
    '.version as $version | .ok == true and .tenant == $tenant
      and ($version | type) == "string" and ($version | length) >= 7
      and ($commit | startswith($version))' \
    <<<"$body" >/dev/null || health_failed
else
  body=$(timeout --kill-after=10s 75s "${vc[@]}" curl / "${vercel_target[@]}" -- "${curl_flags[@]}")
  meta_pattern='<meta[^>]*('
  meta_pattern+="name=[\"']platform-tenant[\"'][^>]*content=[\"']${TENANT}[\"']"
  meta_pattern+="|content=[\"']${TENANT}[\"'][^>]*name=[\"']platform-tenant[\"'])"
  grep -Eiq "$meta_pattern" <<<"$body" || health_failed
fi

if ! { read_release_state && candidate_aliases_complete \
  && [[ "$rolling_release_active" == false ]] \
  && [[ "$current_deployment_id" == "$deployment_id" ]] \
  && alias_job_matches promote "$deployment_id" \
  && alias_job_successful; }; then
    echo '::error::Vercel routing changed during the final health check.' >&2
    exit 1
fi

jq -c --arg status "$(if [[ "$action" == promote ]]; then echo promoted; else echo verified; fi)" \
  '.status = $status' <<<"$evidence"
