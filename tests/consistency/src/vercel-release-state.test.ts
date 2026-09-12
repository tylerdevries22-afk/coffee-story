import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const ROOT = join(process.cwd(), '..', '..');
const stageState = join(ROOT, 'scripts', 'vercel-stage-state.sh');
const releaseState = join(ROOT, 'scripts', 'vercel-release-state.sh');
const SHA = 'a'.repeat(40);
const DIGEST = `sha256:${'b'.repeat(64)}`;

function bash(body: string, extra: Record<string, string> = {}) {
  return spawnSync('bash', ['-c', body], {
    encoding: 'utf8',
    env: {
      ...process.env, SHA, DIGEST, DUPLICATE: 'false', WILDCARD_TARGET: 'dpl_candidate',
      STAGE_STATE: stageState, RELEASE_STATE: releaseState, ...extra,
    },
  });
}

const stageHarness = String.raw`
set -euo pipefail
PROJECT=tenant-hq
GITHUB_SHA=$SHA
FACTORY_ARTIFACT_DIGEST=$DIGEST
release_operation=123:1:hq:production
DEPLOY_ENVIRONMENT=production
scope_query=teamId=team_test
VERCEL_TOKEN=test
sleep() { :; }
source "$STAGE_STATE"
list_project_deployments() {
  jq -cn --arg sha "$SHA" --arg digest "$DIGEST" --argjson duplicate "$DUPLICATE" '
    {deployments: ([{uid:"dpl_candidate",url:"candidate.vercel.app",name:"tenant-hq",
      target:"production",meta:{githubCommitSha:$sha,factoryArtifactDigest:$digest,
      factoryReleaseOperation:"123:1:hq:production"}}]
      + (if $duplicate then [{uid:"dpl_other",url:"other.vercel.app",name:"tenant-hq",
        target:"production",meta:{githubCommitSha:$sha,factoryArtifactDigest:$digest,
        factoryReleaseOperation:"123:1:hq:production"}}] else [] end))}'
}
recover_staged_deployment
`;

const partitionHarness = String.raw`
set -euo pipefail
project=tenant-hq
scope_query=teamId=team_test
VERCEL_TOKEN=test
candidate_deployment_id=dpl_candidate
previous_deployment_id=dpl_prior
production_aliases='["*.example.com","tenant-hq.vercel.app"]'
source "$RELEASE_STATE"
read_production_aliases() { printf '%s\n' "$production_aliases"; }
project_alias_state() {
  printf '%s\n' '{"rollingRelease":null,"lastAliasRequest":{"jobStatus":"pending","type":"promote","toDeploymentId":"dpl_candidate"}}'
}
vercel_api_record() {
  case "$1" in
    '*.example.com') printf '{"uid":"%s"}\n' "$WILDCARD_TARGET" ;;
    *) printf '%s\n' '{"uid":"dpl_prior"}' ;;
  esac
}
read_release_state
jq -cn --argjson candidate "$candidate_aliases" --argjson previous "$previous_aliases" \
  --arg status "$alias_job_status" '{candidate:$candidate,previous:$previous,status:$status}'
`;

describe('Vercel provider state reconciliation', () => {
  it('recovers one exact staged deployment after an ambiguous mutation response', () => {
    const result = bash(stageHarness, { DUPLICATE: 'false' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'https://candidate.vercel.app');
  });

  it('rejects ambiguous duplicate staging matches without another mutation', () => {
    const result = bash(stageHarness, { DUPLICATE: 'true' });
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
  });

  it('represents a partial promotion as a candidate/prior alias partition', () => {
    const result = bash(partitionHarness);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      candidate: ['*.example.com'], previous: ['tenant-hq.vercel.app'], status: 'pending',
    });
  });

  it('fails closed when any authoritative alias drifts outside the release set', () => {
    const result = bash(partitionHarness, { WILDCARD_TARGET: 'dpl_foreign' });
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
  });

  it('accepts wildcard domains and rejects malformed domain API pages', () => {
    const body = String.raw`
      set -euo pipefail
      project=tenant-hq; scope_query=teamId=team_test; VERCEL_TOKEN=test
      source "$RELEASE_STATE"
      vercel_api_get() { printf '%s\n' "$PAGE"; }
      read_production_aliases
    `;
    const valid = bash(body, {
      PAGE: '{"domains":[{"name":"*.example.com"}],"pagination":{"count":1,"next":null,"prev":null}}',
    });
    assert.equal(valid.status, 0, valid.stderr);
    assert.deepEqual(JSON.parse(valid.stdout), ['*.example.com', 'tenant-hq.vercel.app']);
    for (const page of [
      '{"domains":[{"name":"example.com"}]}',
      '{"domains":[{"name":"example.com"}],"pagination":[]}',
    ]) {
      const malformed = bash(body, { PAGE: page });
      assert.notEqual(malformed.status, 0);
      assert.equal(malformed.stdout, '');
    }
  });

  it('blocks promotion before mutation when rolling releases are configured', () => {
    const body = String.raw`
      set -euo pipefail
      project=tenant-hq; scope_query=teamId=team_test; VERCEL_TOKEN=test
      source "$RELEASE_STATE"
      vercel_api_get() { printf '%s\n' "$CONFIG"; }
      mutation=0
      if rolling_release_disabled; then mutation=1; fi
      printf '%s\n' "$mutation"
    `;
    const disabled = bash(body, { CONFIG: '{"rollingRelease":null}' });
    assert.equal(disabled.status, 0, disabled.stderr);
    assert.equal(disabled.stdout.trim(), '1');
    for (const config of ['{"rollingRelease":{"target":"production"}}', '{}']) {
      const configured = bash(body, { CONFIG: config });
      assert.equal(configured.status, 0, configured.stderr);
      assert.equal(configured.stdout.trim(), '0');
    }
  });

  it('stops a paginated alias scan when the absolute release budget expires', () => {
    const result = bash(String.raw`
      set -euo pipefail
      project=tenant-hq; scope_query=teamId=team_test; VERCEL_TOKEN=test
      source "$RELEASE_STATE"
      calls=$(mktemp); trap 'rm -f "$calls"' EXIT
      curl() {
        printf 'call\n' >> "$calls"
        sleep 3
        printf '%s\n' '{"domains":[{"name":"one.example.com"}],"pagination":{"count":1,"next":123,"prev":null}}'
      }
      # Two seconds, not one. Bash derives SECONDS from whole-second time_t, so
      # setting it to 0 reads back as 1 the moment the wall clock crosses the
      # next integer second -- microseconds later if the assignment lands late
      # in a second. With a one-second budget the seq fork between here and the
      # first release_time_available check was enough to expire it on a loaded
      # runner, so the scan made zero calls instead of one and this test failed
      # intermittently in CI. Production budgets are 420s and 180s, where that
      # granularity is irrelevant; the margin only has to outlast process setup.
      SECONDS=0; release_deadline=$((SECONDS + 2))
      if read_production_aliases >/dev/null; then exit 9; fi
      wc -l < "$calls"
    `);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '1',
      'the scan should stop after exactly one page once the budget expires');
  });
});
