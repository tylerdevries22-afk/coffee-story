#!/usr/bin/env bash
set -euo pipefail

: "${VERCEL_SCOPE:?VERCEL_SCOPE is required}"
: "${VERCEL_TOKEN:?VERCEL_TOKEN is required}"
: "${PROJECT:?PROJECT is required}"
: "${SURFACE:?SURFACE is required}"
: "${TENANT:?TENANT is required}"
: "${DEPLOY_ENVIRONMENT:?DEPLOY_ENVIRONMENT is required}"
: "${FACTORY_ARTIFACT_DIGEST:?FACTORY_ARTIFACT_DIGEST is required}"
: "${GITHUB_SHA:?GITHUB_SHA is required}"
: "${GITHUB_RUN_ID:?GITHUB_RUN_ID is required}"
: "${GITHUB_RUN_ATTEMPT:?GITHUB_RUN_ATTEMPT is required}"

[[ "$PROJECT" =~ ^[a-z0-9]+([a-z0-9-]*[a-z0-9])?$ ]] || {
  echo '::error::Vercel project name is invalid.' >&2
  exit 1
}
[[ "$VERCEL_SCOPE" =~ ^(team_[A-Za-z0-9]+|[a-z0-9]+(-[a-z0-9]+)*)$ ]] || {
  echo '::error::Vercel scope is invalid.' >&2
  exit 1
}
[[ "$SURFACE" =~ ^(hq|customer|operator|kiosk|display)$ ]] || {
  echo '::error::Hosted surface is invalid.' >&2
  exit 1
}
[[ "$TENANT" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || {
  echo '::error::Tenant slug is invalid.' >&2
  exit 1
}
[[ "$GITHUB_SHA" =~ ^[0-9a-f]{40}$ ]] || {
  echo '::error::A full immutable Git commit SHA is required.' >&2
  exit 1
}
[[ "$FACTORY_ARTIFACT_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || {
  echo '::error::A canonical factory artifact digest is required.' >&2
  exit 1
}
[[ "$GITHUB_RUN_ID" =~ ^[0-9]+$ && "$GITHUB_RUN_ATTEMPT" =~ ^[0-9]+$ ]] || {
  echo '::error::GitHub release run identity is invalid.' >&2
  exit 1
}

vc=(pnpm exec -- vercel)
scope=(--scope "$VERCEL_SCOPE" --token "$VERCEL_TOKEN")

retry_command() {
  local timeout_value="$1"
  shift
  for attempt in 1 2 3; do
    timeout --kill-after=10s "$timeout_value" "$@" && return 0
    if (( attempt < 3 )); then sleep $((attempt * 2)); fi
  done
  return 1
}

[[ "$(git rev-parse HEAD)" == "$GITHUB_SHA" ]] || {
  echo '::error::The checked-out source does not match the requested deployment commit.' >&2
  exit 1
}
[[ -z "$(git status --porcelain=v1 --untracked-files=all)" ]] || {
  echo '::error::Exact-commit deployment requires a clean checkout.' >&2
  exit 1
}
retry_command 60s "${vc[@]}" link --yes --project "$PROJECT" "${scope[@]}" >/dev/null
[[ -z "$(git status --porcelain=v1 --untracked-files=all)" ]] || {
  echo '::error::Vercel link changed the exact-commit checkout.' >&2
  exit 1
}

release_operation="${GITHUB_RUN_ID}:${GITHUB_RUN_ATTEMPT}:${SURFACE}:${DEPLOY_ENVIRONMENT}"
deploy=(deploy --force --no-wait --no-color
  --meta "githubCommitSha=$GITHUB_SHA"
  --meta "factoryArtifactDigest=$FACTORY_ARTIFACT_DIGEST"
  --meta "factoryReleaseOperation=$release_operation")
if [[ "$DEPLOY_ENVIRONMENT" == production ]]; then
  deploy+=(--prod --skip-domain)
elif [[ "$DEPLOY_ENVIRONMENT" == preview ]]; then
  deploy+=(--target preview)
else
  echo "::error::Unsupported Vercel deployment environment: $DEPLOY_ENVIRONMENT" >&2
  exit 1
fi

if [[ "$VERCEL_SCOPE" == team_* ]]; then
  scope_query="teamId=$VERCEL_SCOPE"
else
  scope_query="slug=$VERCEL_SCOPE"
fi
# shellcheck source=scripts/vercel-stage-state.sh
source scripts/vercel-stage-state.sh
deployment_url=''
if deployment_output=$(timeout --kill-after=10s 3m \
  "${vc[@]}" "${deploy[@]}" "${scope[@]}"); then
  deployment_url=$(tail -1 <<<"$deployment_output")
fi
[[ "$deployment_url" =~ ^(https://)?[A-Za-z0-9-]+\.vercel\.app$ ]] \
  || deployment_url=$(recover_staged_deployment || true)
[[ "$deployment_url" =~ ^(https://)?[A-Za-z0-9-]+\.vercel\.app$ ]] || {
  echo '::error::Vercel did not return a deployment URL.' >&2
  exit 1
}
[[ "$deployment_url" == https://* ]] || deployment_url="https://${deployment_url}"
deployment_host="${deployment_url#https://}"

inspection=''
for attempt in 1 2 3; do
  inspection=$(timeout --kill-after=10s 3m "${vc[@]}" inspect "$deployment_url" --wait --timeout 2m \
    --json "${scope[@]}") && break
  if (( attempt < 3 )); then sleep $((attempt * 2)); fi
done
[[ "$(jq -r '.readyState // empty' <<<"$inspection")" == READY ]] || {
  echo '::error::The staged Vercel deployment did not become READY.' >&2
  exit 1
}

deployment_record() {
  curl --silent --show-error --fail-with-body --retry 2 --retry-all-errors \
    --connect-timeout 5 --max-time 15 \
    -H "Authorization: Bearer $VERCEL_TOKEN" \
    "https://api.vercel.com/v13/deployments/${deployment_host}?${scope_query}"
}

deployment=''
for _attempt in $(seq 1 6); do
  deployment=$(deployment_record || true)
  valid=$(jq -r --arg host "$deployment_host" --arg sha "$GITHUB_SHA" \
    --arg digest "$FACTORY_ARTIFACT_DIGEST" --arg target "$DEPLOY_ENVIRONMENT" \
    --arg project "$PROJECT" --arg operation "$release_operation" \
    '(.url == $host) and (.name == $project) and
      ((($target == "preview") and (.target == null)) or (.target == $target)) and
      ((.readyState // .state) == "READY") and
      (.meta.githubCommitSha == $sha) and (.meta.factoryArtifactDigest == $digest)
      and (.meta.factoryReleaseOperation == $operation)' \
    <<<"${deployment:-{}}")
  [[ "$valid" == true ]] && break
  deployment=''
  sleep 5
done
deployment_id=$(jq -r '.uid // .id // empty' <<<"$deployment")
[[ "$deployment_id" =~ ^dpl_[A-Za-z0-9]+$ ]] || {
  echo '::error::Vercel did not expose matching immutable deployment metadata.' >&2
  exit 1
}

vercel_curl=("${vc[@]}" curl)
vercel_target=(--deployment "$deployment_url" "${scope[@]}")
curl_flags=(--fail-with-body --retry 1 --retry-all-errors --connect-timeout 5 --max-time 30)
if [[ "$SURFACE" == hq ]]; then
  : "${HEALTH_CHECK_TOKEN:?HEALTH_CHECK_TOKEN is required for HQ canary verification}"
  canary=$(timeout --kill-after=10s 75s "${vercel_curl[@]}" '/api/health?deep=1' "${vercel_target[@]}" -- \
    "${curl_flags[@]}" --header "x-health-check-token: $HEALTH_CHECK_TOKEN")
  jq -e --arg tenant "$TENANT" --arg commit "$GITHUB_SHA" \
    '.version as $version | .ok == true and .tenant == $tenant
      and ($version | type) == "string" and ($version | length) >= 7
      and ($commit | startswith($version))' \
    <<<"$canary" >/dev/null || {
      echo '::error::The staged HQ canary did not match tenant and commit identity.' >&2
      exit 1
    }
else
  canary=$(timeout --kill-after=10s 75s "${vercel_curl[@]}" / "${vercel_target[@]}" -- "${curl_flags[@]}")
  meta_pattern='<meta[^>]*('
  meta_pattern+="name=[\"']platform-tenant[\"'][^>]*content=[\"']${TENANT}[\"']"
  meta_pattern+="|content=[\"']${TENANT}[\"'][^>]*name=[\"']platform-tenant[\"'])"
  grep -Eiq "$meta_pattern" <<<"$canary" || {
    echo '::error::The staged web canary did not match the selected tenant.' >&2
    exit 1
  }
fi

evidence=$(jq -cn --arg deploymentId "$deployment_id" --arg deploymentUrl "$deployment_url" \
  --arg commitSha "$GITHUB_SHA" --arg artifactDigest "$FACTORY_ARTIFACT_DIGEST" \
  --arg project "$PROJECT" --arg surface "$SURFACE" --arg tenant "$TENANT" \
  --arg deploymentTarget "$DEPLOY_ENVIRONMENT" --arg runId "$GITHUB_RUN_ID" \
  --arg runAttempt "$GITHUB_RUN_ATTEMPT" --arg releaseOperation "$release_operation" \
  '{schemaVersion:1,provider:"vercel",project:$project,surface:$surface,deploymentId:$deploymentId,
    deploymentUrl:$deploymentUrl,deploymentTarget:$deploymentTarget,tenant:$tenant,
    runId:$runId,runAttempt:$runAttempt,releaseOperation:$releaseOperation,
    commitSha:$commitSha,artifactDigest:$artifactDigest,
    status:"canary-passed"}')
{
  echo "url=$deployment_url"
  echo "deployment_id=$deployment_id"
  echo "deployment_url=$deployment_url"
  echo "provider_evidence=$evidence"
} >> "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"
printf '### %s Vercel evidence\n\n\140\140\140json\n%s\n\140\140\140\n' "$PROJECT" "$evidence" \
  >> "${GITHUB_STEP_SUMMARY:?GITHUB_STEP_SUMMARY is required}"
