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

[[ "$PROJECT" =~ ^[a-z0-9]+([a-z0-9-]*[a-z0-9])?$ ]] || {
  echo '::error::Vercel project name is invalid.'
  exit 1
}
[[ "$VERCEL_SCOPE" =~ ^(team_[A-Za-z0-9]+|[a-z0-9]+(-[a-z0-9]+)*)$ ]] || {
  echo '::error::Vercel scope is invalid.'
  exit 1
}
[[ "$SURFACE" =~ ^(hq|customer|operator|kiosk|display)$ ]] || {
  echo '::error::Hosted surface is invalid.'
  exit 1
}
[[ "$TENANT" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || {
  echo '::error::Tenant slug is invalid.'
  exit 1
}
[[ "$GITHUB_SHA" =~ ^[0-9a-f]{40}$ ]] || {
  echo '::error::A full immutable Git commit SHA is required.'
  exit 1
}
[[ "$FACTORY_ARTIFACT_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || {
  echo '::error::A canonical factory artifact digest is required.'
  exit 1
}

vc=(pnpm exec vercel)
scope=(--scope "$VERCEL_SCOPE" --token "$VERCEL_TOKEN")

[[ "$(git rev-parse HEAD)" == "$GITHUB_SHA" ]] || {
  echo '::error::The checked-out source does not match the requested deployment commit.'
  exit 1
}
[[ -z "$(git status --porcelain=v1 --untracked-files=all)" ]] || {
  echo '::error::Exact-commit deployment requires a clean checkout.'
  exit 1
}
timeout 2m "${vc[@]}" link --yes --project "$PROJECT" "${scope[@]}" >/dev/null

deploy=(deploy --force --no-wait --no-color
  --meta "githubCommitSha=$GITHUB_SHA"
  --meta "factoryArtifactDigest=$FACTORY_ARTIFACT_DIGEST")
if [[ "$DEPLOY_ENVIRONMENT" == production ]]; then
  deploy+=(--prod --skip-domain)
elif [[ "$DEPLOY_ENVIRONMENT" == preview ]]; then
  deploy+=(--target preview)
else
  echo "::error::Unsupported Vercel deployment environment: $DEPLOY_ENVIRONMENT"
  exit 1
fi

deployment_url=$(timeout 10m "${vc[@]}" "${deploy[@]}" "${scope[@]}" | tail -1)
[[ "$deployment_url" == https://*.vercel.app || "$deployment_url" == *.vercel.app ]] || {
  echo '::error::Vercel did not return a deployment URL.'
  exit 1
}
[[ "$deployment_url" == https://* ]] || deployment_url="https://${deployment_url}"
deployment_host="${deployment_url#https://}"

inspection=$(timeout 9m "${vc[@]}" inspect "$deployment_url" --wait --timeout 8m \
  --json "${scope[@]}")
[[ "$(jq -r '.readyState // empty' <<<"$inspection")" == READY ]] || {
  echo '::error::The staged Vercel deployment did not become READY.'
  exit 1
}

if [[ "$VERCEL_SCOPE" == team_* ]]; then
  scope_query="teamId=$VERCEL_SCOPE"
else
  scope_query="slug=$VERCEL_SCOPE"
fi

deployment_record() {
  curl --silent --show-error --fail-with-body --retry 2 --retry-all-errors \
    --connect-timeout 10 --max-time 45 \
    -H "Authorization: Bearer $VERCEL_TOKEN" \
    "https://api.vercel.com/v13/deployments/${deployment_host}?${scope_query}"
}

deployment=''
for _attempt in $(seq 1 6); do
  deployment=$(deployment_record || true)
  valid=$(jq -r --arg host "$deployment_host" --arg sha "$GITHUB_SHA" \
    --arg digest "$FACTORY_ARTIFACT_DIGEST" --arg target "$DEPLOY_ENVIRONMENT" \
    '(.url == $host) and
      ((($target == "preview") and (.target == null)) or (.target == $target)) and
      ((.readyState // .state) == "READY") and
      (.meta.githubCommitSha == $sha) and (.meta.factoryArtifactDigest == $digest)' \
    <<<"${deployment:-{}}")
  [[ "$valid" == true ]] && break
  deployment=''
  sleep 5
done
deployment_id=$(jq -r '.uid // .id // empty' <<<"$deployment")
[[ "$deployment_id" == dpl_* ]] || {
  echo '::error::Vercel did not expose matching immutable deployment metadata.'
  exit 1
}

curl_args=(--deployment "$deployment_url" --fail-with-body --retry 2 --retry-all-errors
  --connect-timeout 10 --max-time 45 "${scope[@]}")
if [[ "$SURFACE" == hq ]]; then
  : "${HEALTH_CHECK_TOKEN:?HEALTH_CHECK_TOKEN is required for HQ canary verification}"
  canary=$("${vc[@]}" curl '/api/health?deep=1' -H \
    "x-health-check-token: $HEALTH_CHECK_TOKEN" "${curl_args[@]}")
  jq -e --arg tenant "$TENANT" --arg commit "$GITHUB_SHA" \
    '.version as $version | .ok == true and .tenant == $tenant
      and ($version | type) == "string" and ($commit | startswith($version))' \
    <<<"$canary" >/dev/null || {
      echo '::error::The staged HQ canary did not match tenant and commit identity.'
      exit 1
    }
else
  canary=$("${vc[@]}" curl / "${curl_args[@]}")
  meta_pattern='<meta[^>]*('
  meta_pattern+="name=[\"']platform-tenant[\"'][^>]*content=[\"']${TENANT}[\"']"
  meta_pattern+="|content=[\"']${TENANT}[\"'][^>]*name=[\"']platform-tenant[\"'])"
  grep -Eiq "$meta_pattern" <<<"$canary" || {
    echo '::error::The staged web canary did not match the selected tenant.'
    exit 1
  }
fi

status=canary-passed
public_url="$deployment_url"
if [[ "$DEPLOY_ENVIRONMENT" == production ]]; then
  timeout 6m "${vc[@]}" promote "$deployment_url" --yes --timeout 5m "${scope[@]}"
  promoted=''
  for _attempt in $(seq 1 6); do
    deployment=$(deployment_record || true)
    if [[ "$(jq -r '.readySubstate // empty' <<<"$deployment")" == PROMOTED \
      && "$(jq -r '.target // empty' <<<"$deployment")" == production ]]; then
      promoted=1
      break
    fi
    sleep 5
  done
  [[ -n "$promoted" ]] || {
    echo '::error::Vercel did not confirm production promotion for the attested deployment.'
    exit 1
  }
  status=promoted
  public_url="https://${PROJECT}.vercel.app"
fi

evidence=$(jq -cn --arg deploymentId "$deployment_id" --arg deploymentUrl "$deployment_url" \
  --arg commitSha "$GITHUB_SHA" --arg artifactDigest "$FACTORY_ARTIFACT_DIGEST" \
  --arg status "$status" '{provider:"vercel",deploymentId:$deploymentId,
    deploymentUrl:$deploymentUrl,commitSha:$commitSha,artifactDigest:$artifactDigest,status:$status}')
{
  echo "url=$public_url"
  echo "deployment_id=$deployment_id"
  echo "deployment_url=$deployment_url"
  echo "provider_evidence=$evidence"
} >> "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"
printf '### %s Vercel evidence\n\n```json\n%s\n```\n' "$PROJECT" "$evidence" \
  >> "${GITHUB_STEP_SUMMARY:?GITHUB_STEP_SUMMARY is required}"
