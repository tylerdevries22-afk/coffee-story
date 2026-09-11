# shellcheck shell=bash
# shellcheck disable=SC2154 # Sourced after the release scripts validate these globals.

release_time_available() {
  [[ -z "${release_deadline:-}" ]] || (( SECONDS < release_deadline ))
}

vercel_api_get() {
  release_time_available || return 1
  curl --silent --show-error --fail-with-body --retry 2 --retry-all-errors \
    --connect-timeout 5 --max-time 15 -H "Authorization: Bearer $VERCEL_TOKEN" "$1"
}

vercel_api_record() {
  vercel_api_get "https://api.vercel.com/v13/deployments/${1}?${scope_query}"
}

project_alias_state() {
  vercel_api_get \
    "https://api.vercel.com/v9/projects/${project}?rollbackInfo=true&${scope_query}"
}

rolling_release_disabled() {
  local config
  config=$(vercel_api_get \
    "https://api.vercel.com/v1/projects/${project}/rolling-release/config?${scope_query}") \
    || return 1
  jq -e 'type == "object" and has("rollingRelease") and .rollingRelease == null' \
    <<<"$config" >/dev/null
}

read_production_aliases() {
  local aliases='[]' cursor='' page page_aliases page_url page_number
  for page_number in $(seq 1 10); do
    page_url="https://api.vercel.com/v9/projects/${project}/domains"
    page_url+="?production=true&verified=true&redirects=false&limit=100&${scope_query}"
    [[ -z "$cursor" ]] || page_url+="&until=${cursor}"
    page=$(vercel_api_get "$page_url") || return 1
    page_aliases=$(jq -ce '
      def domain: test("^(\\*\\.)?([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\\.)+[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$");
      if (.domains | type) == "array"
          and all(.domains[]; (.name | type == "string" and domain))
          and (.pagination | type) == "object"
          and (.pagination.count | type) == "number"
          and (.pagination.count | floor) == .pagination.count
          and .pagination.count >= 0
          and .pagination.count == (.domains | length)
          and ((.pagination.next == null)
            or ((.pagination.next | type) == "number"
              and (.pagination.next | floor) == .pagination.next and .pagination.next >= 0))
          and ((.pagination.prev == null)
            or ((.pagination.prev | type) == "number"
              and (.pagination.prev | floor) == .pagination.prev and .pagination.prev >= 0))
      then [.domains[].name] | sort | unique
      else error("invalid production domain response") end' <<<"$page") || return 1
    aliases=$(jq -cn --argjson existing "$aliases" --argjson next "$page_aliases" \
      '$existing + $next | sort | unique') || return 1
    if jq -e '.pagination.next == null' <<<"$page" >/dev/null; then break; fi
    cursor=$(jq -er '.pagination.next | tostring' <<<"$page") || return 1
    [[ "$cursor" =~ ^[0-9]+$ && "$page_number" -lt 10 ]] || return 1
  done
  jq -cn --argjson aliases "$aliases" --arg canonical "${project}.vercel.app" \
    '$aliases + [$canonical] | sort | unique'
}

read_alias_partition() {
  local alias authoritative deployment record
  candidate_aliases='[]'
  previous_aliases='[]'
  authoritative=$(read_production_aliases) || return 1
  [[ "$authoritative" == "$production_aliases" ]] || return 1
  while IFS= read -r alias; do
    record=$(vercel_api_record "$alias") || return 1
    deployment=$(jq -er '.uid // .id' <<<"$record") || return 1
    if [[ "$deployment" == "$candidate_deployment_id" ]]; then
      candidate_aliases=$(jq -cn --argjson aliases "$candidate_aliases" --arg alias "$alias" \
        '$aliases + [$alias] | sort | unique')
    elif [[ "$deployment" == "$previous_deployment_id" ]]; then
      previous_aliases=$(jq -cn --argjson aliases "$previous_aliases" --arg alias "$alias" \
        '$aliases + [$alias] | sort | unique')
    else
      return 1
    fi
  done < <(jq -r '.[]' <<<"$production_aliases")
  jq -ne --argjson candidate "$candidate_aliases" --argjson previous "$previous_aliases" \
    --argjson expected "$production_aliases" \
    '($candidate - $previous | length) == ($candidate | length)
      and ($candidate + $previous | sort | unique) == $expected' >/dev/null
}

read_release_state() {
  local state
  current_record=''
  current_deployment_id=''
  alias_job_status=none
  alias_job_type=''
  alias_job_target=''
  rolling_release_active=false
  state=$(project_alias_state) || return 1
  rolling_release_active=$(jq -r '.rollingRelease != null' <<<"$state") || return 1
  [[ "$rolling_release_active" == false ]] || return 0
  current_record=$(vercel_api_record "${project}.vercel.app") || return 1
  # shellcheck disable=SC2034 # Callers consume this state after the read succeeds.
  current_deployment_id=$(jq -er '.uid // .id' <<<"$current_record") || return 1
  read_alias_partition || return 1
  if jq -e '.lastAliasRequest == null' <<<"$state" >/dev/null; then return 0; fi
  IFS=$'\t' read -r alias_job_status alias_job_type alias_job_target < <(jq -er '
    .lastAliasRequest
    | select((.jobStatus == "pending" or .jobStatus == "in-progress"
        or .jobStatus == "succeeded" or .jobStatus == "failed" or .jobStatus == "skipped")
      and (.type == "promote" or .type == "rollback")
      and (.toDeploymentId | type == "string"))
    | [.jobStatus,.type,.toDeploymentId] | @tsv' <<<"$state") || return 1
}

alias_job_matches() { [[ "$alias_job_type" == "$1" && "$alias_job_target" == "$2" ]]; }
alias_job_pending() { [[ "$alias_job_status" == pending || "$alias_job_status" == in-progress ]]; }
alias_job_successful() { [[ "$alias_job_status" == succeeded || "$alias_job_status" == skipped ]]; }
candidate_aliases_complete() {
  [[ "$candidate_aliases" == "$production_aliases" && "$previous_aliases" == '[]' ]]
}
previous_aliases_complete() {
  [[ "$previous_aliases" == "$production_aliases" && "$candidate_aliases" == '[]' ]]
}
