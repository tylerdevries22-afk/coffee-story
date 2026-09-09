# shellcheck shell=bash
# shellcheck disable=SC2154 # Sourced after the staging script validates these globals.

recover_group_before_deadline() {
  local deadline="$1" branch_json="$temporary_directory/branch.json" group remaining
  remaining=$((deadline - SECONDS))
  (( remaining > 0 )) || return 1
  run_in_app "${remaining}s" "${eas[@]}" branch:view "$candidate_branch" \
    --limit 1 --json --non-interactive > "$branch_json" || return 1
  group=$(jq -er '.name as $name | .currentPage[0].group
    | select($name != "" and . != "")' "$branch_json") || return 1
  [[ "$group" =~ ^[A-Za-z0-9._:-]+$ && "$group" != -* ]] || return 1
  remaining=$((deadline - SECONDS))
  (( remaining > 0 )) || return 1
  run_in_app "${remaining}s" "${eas[@]}" update:view "$group" \
    --json --non-interactive > "$temporary_directory/group.json" || return 1
  validate_group "$temporary_directory/group.json" "$group" || return 1
  printf '%s' "$group"
}

reconcile_group_until() {
  local deadline="$1" observation group='' remaining sleep_seconds
  for observation in {1..18}; do
    (( SECONDS < deadline )) || break
    group=$(recover_group_before_deadline "$deadline" || true)
    [[ -z "$group" ]] || { printf '%s' "$group"; return 0; }
    remaining=$((deadline - SECONDS))
    (( remaining > 0 && observation < 18 )) || break
    sleep_seconds=$((remaining < 10 ? remaining : 10))
    sleep "$sleep_seconds"
  done
  return 1
}
