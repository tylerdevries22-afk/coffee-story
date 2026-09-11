#!/usr/bin/env bash
# shellcheck disable=SC2154 # The workflow owns package_compensation_status.

# This file is sourced by the hosted release finalizer. Keeping the provider
# rollback loop here lets the same code run under deterministic command stubs.

restore_eas_surface() {
  bash scripts/eas-channel-release.sh restore "$1" "$2"
}

restore_vercel_surface() {
  bash scripts/vercel-restore-deployment.sh "$1"
}

verify_restored_eas_surface() {
  bash scripts/eas-channel-release.sh verify-restored "$1" "$2"
}

verify_restored_vercel_surface() {
  bash scripts/vercel-restore-deployment.sh "$1" verify-current
}

append_rollback_result() {
  local result="$1"
  result=$(jq -ce 'select(type == "object" and (.provider | type == "string")
    and (.status | type == "string"))' <<<"$result") || return 1
  printf '%s\n' "$result" >> "${ROLLBACK_RESULTS_PATH:?ROLLBACK_RESULTS_PATH is required}"
}

failed_rollback_result() {
  local provider="$1" surface="$2" reason="$3"
  jq -cn --arg provider "$provider" --arg surface "$surface" --arg reason "$reason" \
    '{schemaVersion:1,provider:$provider,surface:$surface,
      status:"restore-failed",reason:$reason}'
}

restore_attempted_release_set() {
  local rollback_failed=0 output surface native_evidence state_file rollback_file
  : > "${ROLLBACK_RESULTS_PATH:?ROLLBACK_RESULTS_PATH is required}"

  if [[ -s attempted-package-rollback.txt ]]; then
    if restore_package_publication; then
      output=$(jq -cn --arg status "$package_compensation_status" \
        '{schemaVersion:1,provider:"tenant-package",surface:"publication",status:$status}')
      append_rollback_result "$output" || rollback_failed=1
    else
      append_rollback_result "$(failed_rollback_result tenant-package publication compensation-ambiguous)"
      return 1
    fi
  fi

  while IFS=$'\t' read -r native_evidence state_file; do
    [[ -n "$state_file" ]] || continue
    surface=$(jq -r '.surface // "unknown"' "$native_evidence" 2>/dev/null || echo unknown)
    if output=$(restore_eas_surface "$native_evidence" "$state_file"); then
      append_rollback_result "$output" || rollback_failed=1
    else
      append_rollback_result "$(failed_rollback_result eas-update "$surface" provider-rejected)"
      rollback_failed=1
    fi
  done < <(tac attempted-eas-rollbacks.txt)

  while IFS= read -r rollback_file; do
    [[ -n "$rollback_file" ]] || continue
    surface=$(jq -r '.surface // "unknown"' "$rollback_file" 2>/dev/null || echo unknown)
    if output=$(restore_vercel_surface "$rollback_file"); then
      append_rollback_result "$output" || rollback_failed=1
    else
      append_rollback_result "$(failed_rollback_result vercel "$surface" provider-rejected)"
      rollback_failed=1
    fi
  done < <(tac attempted-rollbacks.txt)

  while IFS=$'\t' read -r native_evidence state_file; do
    [[ -n "$state_file" ]] || continue
    surface=$(jq -r '.surface // "unknown"' "$native_evidence" 2>/dev/null || echo unknown)
    if output=$(verify_restored_eas_surface "$native_evidence" "$state_file"); then
      append_rollback_result "$output" || rollback_failed=1
    else
      append_rollback_result \
        "$(failed_rollback_result eas-update "$surface" final-state-mismatch)"
      rollback_failed=1
    fi
  done < attempted-eas-rollbacks.txt
  while IFS= read -r rollback_file; do
    [[ -n "$rollback_file" ]] || continue
    surface=$(jq -r '.surface // "unknown"' "$rollback_file" 2>/dev/null || echo unknown)
    if output=$(verify_restored_vercel_surface "$rollback_file"); then
      append_rollback_result "$output" || rollback_failed=1
    else
      append_rollback_result \
        "$(failed_rollback_result vercel "$surface" final-state-mismatch)"
      rollback_failed=1
    fi
  done < attempted-rollbacks.txt

  if (( rollback_failed == 0 )) && [[ "$package_compensation_status" == compensated ]]; then
    if output=$(confirm_package_compensation); then
      append_rollback_result "$output" || rollback_failed=1
    else
      append_rollback_result \
        "$(failed_rollback_result tenant-package publication confirmation-ambiguous)"
      rollback_failed=1
    fi
  fi
  return "$rollback_failed"
}

release_rollback_started=0
release_signal_seen=0

rollback_on_failure() {
  local status="$?"
  trap - EXIT
  trap '' HUP INT TERM
  (( status != 0 )) || return 0
  (( release_rollback_started == 0 )) || exit 1
  release_rollback_started=1
  set +e
  echo '::error::Release-set promotion failed; restoring every attempted production surface.'
  if ! restore_attempted_release_set; then
    echo '::error::At least one production surface could not be restored automatically.'
  fi
  exit 1
}

abort_release_on_signal() {
  (( release_signal_seen == 0 )) || return 0
  release_signal_seen=1
  trap '' HUP INT TERM
  exit 1
}

install_release_rollback_traps() {
  trap rollback_on_failure EXIT
  trap abort_release_on_signal HUP INT TERM
}

disarm_release_rollback_traps() { trap - EXIT HUP INT TERM; }
