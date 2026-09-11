# shellcheck shell=bash
# shellcheck disable=SC2154 # Sourced after the staging script validates these globals.

list_project_deployments() {
  curl --silent --show-error --fail-with-body --retry 2 --retry-all-errors \
    --connect-timeout 5 --max-time 15 -H "Authorization: Bearer $VERCEL_TOKEN" \
    "https://api.vercel.com/v6/deployments?projectId=${PROJECT}&limit=100&${scope_query}"
}

recover_staged_deployment() {
  local deployments host matches observation
  for observation in $(seq 1 12); do
    deployments=$(list_project_deployments || true)
    matches=$(jq -ce --arg project "$PROJECT" --arg sha "$GITHUB_SHA" \
      --arg digest "$FACTORY_ARTIFACT_DIGEST" --arg operation "$release_operation" \
      --arg target "$DEPLOY_ENVIRONMENT" '
      [.deployments[]? | select(.name == $project
        and .meta.githubCommitSha == $sha
        and .meta.factoryArtifactDigest == $digest
        and .meta.factoryReleaseOperation == $operation
        and ((($target == "preview") and (.target == null)) or .target == $target)
        and ((.uid // .id) | test("^dpl_[A-Za-z0-9]+$"))
        and (.url | test("^[A-Za-z0-9-]+\\.vercel\\.app$")))]' \
      <<<"${deployments:-{}}" 2>/dev/null || true)
    if [[ "$(jq -r 'length' <<<"${matches:-[]}")" == 1 ]]; then
      host=$(jq -er '.[0].url' <<<"$matches") || return 1
      printf 'https://%s' "$host"
      return 0
    fi
    [[ "$(jq -r 'length' <<<"${matches:-[]}")" == 0 ]] || return 1
    (( observation < 12 )) && sleep 5
  done
  return 1
}
