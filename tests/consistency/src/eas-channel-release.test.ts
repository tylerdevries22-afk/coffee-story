import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const ROOT = join(process.cwd(), '..', '..');
const RELEASE_STATE = join(ROOT, 'scripts', 'eas-release-state.sh');

function bash(body: string) {
  return spawnSync('bash', ['-c', body], {
    encoding: 'utf8', env: { ...process.env, RELEASE_STATE },
  });
}

const moveHarness = String.raw`
set -euo pipefail
temporary_directory=$(mktemp -d); trap 'rm -rf "$temporary_directory"' EXIT
candidate_id=22222222-2222-4222-8222-222222222222; candidate=candidate
prior_id=11111111-1111-4111-8111-111111111111; prior_name=prior
prior_group=old-group; prior_digest=$(printf 'a%.0s' {1..64})
eas=(eas); GITHUB_SHA=$(printf 'b%.0s' {1..40}); runtime=exposdk:54.0.0
source "$RELEASE_STATE"
views=0; verifications=0; mutations="$temporary_directory/mutations"
view_channel() { views=$((views + 1)); printf '{}\n' > "$1"; }
mapped_branch() {
  if (( views == 1 )); then printf '%s\t%s\n' "$prior_id" "$prior_name"
  else printf '%s\t%s\n' "$candidate_id" "$candidate"; fi
}
verify_move_target() {
  verifications=$((verifications + 1))
  [[ "$DRIFT" != true || "$verifications" -lt 3 ]]
}
run_in_app() { printf '%s\n' "$*" >> "$mutations"; return 1; }
sleep() { :; }
if [[ "$DRIFT" == true ]]; then
  if move_channel "$prior_id" "$prior_name" "$candidate_id" "$candidate"; then exit 9; fi
else
  move_channel "$prior_id" "$prior_name" "$candidate_id" "$candidate"
fi
wc -l < "$mutations"
`;

describe('EAS channel release reconciliation', () => {
  it('reconciles a lost edit response without another semantic mutation', () => {
    const result = bash(`DRIFT=false\n${moveHarness}`);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '1');
  });

  it('refuses success when the target branch drifts after the edit', () => {
    const result = bash(`DRIFT=true\n${moveHarness}`);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '1');
  });

  it('rejects a branch pointer that advances during snapshot verification', () => {
    const result = bash(String.raw`
      set -euo pipefail
      temporary_directory=$(mktemp -d); trap 'rm -rf "$temporary_directory"' EXIT
      candidate=candidate; candidate_id=22222222-2222-4222-8222-222222222222
      group=group-one; GITHUB_SHA=$(printf 'b%.0s' {1..40}); runtime=exposdk:54.0.0
      eas=(eas); evidence_path="$temporary_directory/evidence.json"; branch_reads=0
      updates=$(jq -cn --arg branch "$candidate" --arg group "$group" --arg sha "$GITHUB_SHA" '
        ["android","ios"] | map({id:(if . == "android" then
          "33333333-3333-4333-8333-333333333333" else
          "44444444-4444-4444-8444-444444444444" end),platform:.,group:$group,
          branch:$branch,runtimeVersion:"exposdk:54.0.0",gitCommitHash:$sha,
          manifestPermalink:("https://expo.dev/updates/" + .)})')
      normalized=$(jq -c 'map({id,platform,manifestPermalink}) | sort_by(.id)' <<<"$updates")
      candidate_update_digest=$(printf '%s' "$normalized" | sha256sum | cut -d' ' -f1)
      jq -cn --argjson updates "$normalized" '{updates:$updates}' > "$evidence_path"
      source "$RELEASE_STATE"
      retry_json() {
        local destination="$1"; shift 2
        if [[ " $* " == *" branch:view "* ]]; then
          branch_reads=$((branch_reads + 1)); local current_group="$group"
          (( branch_reads == 1 )) || current_group=group-two
          jq -cn --arg name "$candidate" --arg id "$candidate_id" --arg group "$current_group" \
            '{name:$name,id:$id,currentPage:[{group:$group}]}' > "$destination"
        else printf '%s\n' "$updates" > "$destination"; fi
      }
      if verify_candidate; then exit 9; fi
    `);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
  });
});
