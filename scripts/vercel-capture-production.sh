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

evidence_path="${1:?Pass one staged Vercel evidence file.}"
evidence=$(cat "$evidence_path")
project=$(jq -er '.project' <<<"$evidence")
surface=$(jq -er '.surface' <<<"$evidence")
candidate_id=$(jq -er '.deploymentId' <<<"$evidence")
candidate_url=$(jq -er '.deploymentUrl' <<<"$evidence")
[[ "$surface" =~ ^(hq|customer|operator|kiosk|display)$ ]] || {
  echo '::error::Staged Vercel evidence names an invalid surface.' >&2
  exit 1
}
[[ "$VERCEL_SCOPE" =~ ^(team_[A-Za-z0-9]+|[a-z0-9]+(-[a-z0-9]+)*)$ ]] || {
  echo '::error::Vercel scope is invalid.' >&2
  exit 1
}
[[ "$GITHUB_SHA" =~ ^[0-9a-f]{40}$ \
  && "$FACTORY_ARTIFACT_DIGEST" =~ ^sha256:[0-9a-f]{64}$ \
  && "$GITHUB_RUN_ID" =~ ^[0-9]+$ && "$GITHUB_RUN_ATTEMPT" =~ ^[0-9]+$ \
  && "$(git rev-parse HEAD)" == "$GITHUB_SHA" \
  && -z "$(git status --porcelain=v1 --untracked-files=no)" ]] || {
  echo '::error::Rollback capture requires the exact clean release commit.' >&2
  exit 1
}
expected_project="${PROJECT_PREFIX}-${surface}"
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
  --arg candidateId "$candidate_id" --arg candidateUrl "$candidate_url" \
  '.schemaVersion == 1 and .provider == "vercel" and .status == "canary-passed"
    and .project == $project and .surface == $surface
    and .deploymentTarget == "production" and .tenant == $tenant
    and .commitSha == $sha and .artifactDigest == $digest
    and .runId == $runId and .runAttempt == $runAttempt and .releaseOperation == $operation
    and .deploymentId == $candidateId and .deploymentUrl == $candidateUrl
    and ($candidateId | test("^dpl_[A-Za-z0-9]+$"))
    and ($candidateUrl | test("^https://[A-Za-z0-9-]+\\.vercel\\.app$"))' \
  <<<"$evidence" >/dev/null
test "$(jq -r '.tenant' <<<"$evidence")" = "$TENANT" || {
  echo '::error::Staged Vercel evidence names an unexpected tenant.' >&2
  exit 1
}

if [[ "$VERCEL_SCOPE" == team_* ]]; then
  scope_query="teamId=$VERCEL_SCOPE"
else
  scope_query="slug=$VERCEL_SCOPE"
fi
# shellcheck source=scripts/vercel-release-state.sh
source scripts/vercel-release-state.sh
canonical_host="${project}.vercel.app"
state=$(project_alias_state)
jq -e '.rollingRelease == null' <<<"$state" >/dev/null || {
  echo '::error::Rollback capture refuses an active Vercel rolling release.' >&2
  exit 1
}
candidate_record=$(vercel_api_record "$candidate_id")
jq -e --arg id "$candidate_id" --arg project "$project" \
  --arg host "${candidate_url#https://}" --arg sha "$GITHUB_SHA" \
  --arg digest "$FACTORY_ARTIFACT_DIGEST" \
  '(.uid // .id) == $id and .name == $project and .url == $host
    and (.readyState // .state) == "READY" and .target == "production"
    and .meta.githubCommitSha == $sha and .meta.factoryArtifactDigest == $digest' \
  <<<"$candidate_record" >/dev/null
record=$(vercel_api_record "$canonical_host")

deployment_id=$(jq -r '.uid // .id // empty' <<<"$record")
deployment_host=$(jq -r '.url // empty' <<<"$record")
production_aliases=$(read_production_aliases)
jq -e --arg id "$deployment_id" --arg host "$deployment_host" \
  --arg project "$project" \
  '($id | test("^dpl_[A-Za-z0-9]+$"))
    and ($host | test("^[A-Za-z0-9-]+\\.vercel\\.app$"))
    and .name == $project and (.readyState // .state) == "READY"
    and .target == "production"' <<<"$record" >/dev/null || {
  echo "::error::${project} has no validated production deployment to restore." >&2
  exit 1
}
test "$deployment_id" != "$candidate_id" || {
  echo "::error::${project} candidate is already live before final promotion." >&2
  exit 1
}
while IFS= read -r production_alias; do
  alias_record=$(vercel_api_record "$production_alias")
  [[ "$(jq -er '.uid // .id' <<<"$alias_record")" == "$deployment_id" ]] || {
    echo '::error::A production domain does not resolve to the captured deployment.' >&2
    exit 1
  }
done < <(jq -r '.[]' <<<"$production_aliases")

jq -cn --arg deploymentId "$deployment_id" \
  --arg deploymentUrl "https://${deployment_host}" --arg project "$project" \
  --arg surface "$surface" --arg candidateDeploymentId "$candidate_id" \
  --arg candidateDeploymentUrl "$candidate_url" --argjson productionAliases "$production_aliases" \
  --arg tenant "$TENANT" --arg commitSha "$GITHUB_SHA" \
  --arg artifactDigest "$FACTORY_ARTIFACT_DIGEST" --arg deploymentTarget production \
  --arg runId "$GITHUB_RUN_ID" --arg runAttempt "$GITHUB_RUN_ATTEMPT" \
  --arg releaseOperation "${GITHUB_RUN_ID}:${GITHUB_RUN_ATTEMPT}:${surface}:production" \
  '{schemaVersion:1,provider:"vercel",project:$project,surface:$surface,
    deploymentId:$deploymentId,deploymentUrl:$deploymentUrl,
    candidateDeploymentId:$candidateDeploymentId,
    candidateDeploymentUrl:$candidateDeploymentUrl,productionAliases:$productionAliases,
    tenant:$tenant,commitSha:$commitSha,artifactDigest:$artifactDigest,
    deploymentTarget:$deploymentTarget,runId:$runId,runAttempt:$runAttempt,
    releaseOperation:$releaseOperation,
    status:"rollback-ready"}'
