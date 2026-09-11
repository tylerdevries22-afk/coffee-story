# shellcheck shell=bash
# shellcheck disable=SC2154 # This library reads validated state from its caller.

retry_json() {
  local destination="$1" duration="$2" attempt
  shift 2
  for attempt in 1 2 3; do
    if run_in_app "$duration" "$@" > "$destination"; then return 0; fi
    if (( attempt < 3 )); then sleep $((attempt * 2)); fi
  done
  return 1
}

view_channel() {
  retry_json "$1" 30s "${eas[@]}" channel:view production --limit 100 \
    --json --non-interactive
}

mapped_branch() {
  local source="$1" mapping branch_id
  mapping=$(jq -cer '.currentPage as $channel | ($channel.branchMapping | fromjson) as $map
    | select($channel.name == "production" and $channel.isPaused == false)
    | $map | select(.version == 0 and (.data | length) == 1
      and .data[0].branchMappingLogic == "true")' "$source") || return 1
  branch_id=$(jq -er '.data[0].branchId' <<<"$mapping")
  jq -r --arg id "$branch_id" '[.currentPage.updateBranches[] | select(.id == $id)] as $matches
    | if ($matches | length) > 1 then error("branch mapping is ambiguous")
      else [$id, ($matches[0].name // "")] | @tsv end' "$source"
}

branch_pointer_matches() {
  jq -e --arg name "$2" --arg id "$3" --arg group "$4" \
    '.name == $name and .id == $id and (.currentPage | type) == "array"
      and (.currentPage | length) == 1 and .currentPage[0].group == $group' \
    "$1" >/dev/null
}

verify_candidate() {
  local branch="$temporary_directory/branch.json" final_branch="$temporary_directory/branch-final.json"
  local updates="$temporary_directory/updates.json" normalized digest
  retry_json "$branch" 30s "${eas[@]}" branch:view "$candidate" \
    --limit 1 --json --non-interactive
  branch_pointer_matches "$branch" "$candidate" "$candidate_id" "$group" || return 1
  retry_json "$updates" 30s "${eas[@]}" update:view "$group" --json --non-interactive
  normalized=$(jq -ce --arg branch "$candidate" --arg group "$group" \
    --arg runtime "$runtime" --arg sha "$GITHUB_SHA" \
    'if type == "array" and length == 2
        and (map(.platform) | sort) == ["android", "ios"]
        and (map(.id) | unique | length) == 2 and (map(.group) | unique) == [$group]
        and all(.[]; .branch == $branch and .runtimeVersion == $runtime
          and .gitCommitHash == $sha
          and (.id | type == "string"
            and test("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"))
          and (.manifestPermalink | type == "string" and test("^https://[^[:space:]]+$")))
      then map({id,platform,manifestPermalink}) | sort_by(.id)
      else error("invalid EAS update set") end' "$updates") || return 1
  digest=$(printf '%s' "$normalized" | sha256sum | cut -d' ' -f1) || return 1
  [[ "$digest" == "$candidate_update_digest" ]] || return 1
  jq -e --argjson updates "$normalized" '.updates == $updates' "$evidence_path" >/dev/null || return 1
  retry_json "$final_branch" 30s "${eas[@]}" branch:view "$candidate" \
    --limit 1 --json --non-interactive || return 1
  branch_pointer_matches "$final_branch" "$candidate" "$candidate_id" "$group"
}

verify_project() {
  local config="$temporary_directory/config.json"
  retry_json "$config" 30s "${eas[@]}" config --platform ios --profile production \
    --json --non-interactive
  [[ "$(jq -r '.extra.eas.projectId // empty' "$config")" == "$project_id" ]]
}

branch_snapshot() {
  local branch_name="$1" branch_id="$2" branch="$temporary_directory/snapshot-branch.json"
  local final_branch="$temporary_directory/snapshot-branch-final.json"
  local updates="$temporary_directory/snapshot-updates.json" branch_group digest
  retry_json "$branch" 30s "${eas[@]}" branch:view "$branch_name" \
    --limit 1 --json --non-interactive || return 1
  branch_group=$(jq -er '.currentPage[0].group | select(type == "string" and length > 0)' \
    "$branch") || return 1
  branch_pointer_matches "$branch" "$branch_name" "$branch_id" "$branch_group" || return 1
  retry_json "$updates" 30s "${eas[@]}" update:view "$branch_group" \
    --json --non-interactive || return 1
  jq -e --arg group "$branch_group" --arg branch "$branch_name" \
    'type == "array" and length > 0
    and (map(.id) | unique | length) == length
    and all(.[]; (.id | type == "string"
        and test("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"))
      and (.group | type == "string" and length > 0)
      and (.group == $group) and (.platform == "android" or .platform == "ios")
      and (.branch == $branch)
      and (.runtimeVersion | type == "string" and length > 0)
      and (.gitCommitHash | type == "string" and test("^[0-9a-f]{40}$"))
      and (.manifestPermalink | type == "string" and test("^https://[^[:space:]]+$")))' \
    "$updates" >/dev/null || return 1
  digest=$(jq -cS 'map({id,group,platform,branch,runtimeVersion,gitCommitHash,
      manifestPermalink}) | sort_by(.id)' "$updates" \
    | sha256sum | cut -d' ' -f1) || return 1
  retry_json "$final_branch" 30s "${eas[@]}" branch:view "$branch_name" \
    --limit 1 --json --non-interactive || return 1
  branch_pointer_matches "$final_branch" "$branch_name" "$branch_id" "$branch_group" || return 1
  printf '%s\t%s\n' "$branch_group" "$digest"
}

verify_branch_snapshot() {
  local actual expected_group="$3" expected_digest="$4"
  actual=$(branch_snapshot "$1" "$2") || return 1
  [[ "$actual" == "$expected_group"$'\t'"$expected_digest" ]]
}

verify_move_target() {
  local target_id="$1"
  if [[ "$target_id" == "$candidate_id" ]]; then
    verify_candidate
  elif [[ "$target_id" == "$prior_id" ]]; then
    verify_branch_snapshot "$prior_name" "$prior_id" "$prior_group" "$prior_digest"
  else
    return 1
  fi
}

move_channel() {
  local expected_id="$1" expected_name="$2" target_id="$3" target_name="$4"
  local channel="$temporary_directory/channel-move.json" attempt current_id current_name
  for attempt in 1 2; do
    view_channel "$channel"
    IFS=$'\t' read -r current_id current_name < <(mapped_branch "$channel")
    if [[ "$current_id" == "$target_id" ]]; then
      if [[ -z "$current_name" || "$current_name" == "$target_name" ]]; then
        verify_move_target "$target_id" && return 0
      fi
      echo '::error::The EAS target branch ID resolved to an unexpected name.' >&2
      return 1
    fi
    [[ "$current_id" == "$expected_id" \
      && ( -z "$current_name" || "$current_name" == "$expected_name" ) ]] || {
      echo '::error::The EAS production channel changed concurrently.' >&2
      return 1
    }
    if [[ "$target_id" == "$candidate_id" ]]; then
      verify_move_target "$expected_id" || {
        echo '::error::The EAS rollback source changed before channel mutation.' >&2
        return 1
      }
    fi
    verify_move_target "$target_id" || {
      echo '::error::The EAS target branch changed before channel mutation.' >&2
      return 1
    }
    run_in_app 45s "${eas[@]}" channel:edit production --branch "$target_name" \
      --json --non-interactive > "$temporary_directory/edit-${attempt}.json" || true
    sleep $((attempt * 2))
  done
  view_channel "$channel"
  IFS=$'\t' read -r current_id current_name < <(mapped_branch "$channel")
  [[ "$current_id" == "$target_id" \
    && ( -z "$current_name" || "$current_name" == "$target_name" ) ]] \
    && verify_move_target "$target_id"
}
