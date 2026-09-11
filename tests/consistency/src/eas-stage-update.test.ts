import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, type TestContext } from 'node:test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SCRIPT = join(ROOT, 'scripts', 'eas-stage-update.sh');
const STAGE_STATE = join(ROOT, 'scripts', 'eas-stage-state.sh');
const RELEASE_STATE = join(ROOT, 'scripts', 'eas-release-state.sh');

function git(directory: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
}

function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'eas-stage-repo-'));
  const tools = mkdtempSync(join(tmpdir(), 'eas-stage-tools-'));
  t.after(() => {
    rmSync(directory, { recursive: true, force: true });
    rmSync(tools, { recursive: true, force: true });
  });
  mkdirSync(join(directory, 'apps', 'customer'), { recursive: true });
  mkdirSync(join(directory, 'scripts'), { recursive: true });
  writeFileSync(join(directory, 'scripts', 'eas-stage-state.sh'), readFileSync(STAGE_STATE));
  writeFileSync(join(directory, 'tracked.txt'), 'clean\n');
  git(directory, 'init', '-q');
  git(directory, 'add', '.');
  git(directory, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
  const marker = join(tools, 'npx-called');
  const npx = join(tools, 'npx');
  writeFileSync(npx, '#!/bin/sh\nprintf called > "$NPX_MARKER"\nexit 99\n');
  chmodSync(npx, 0o700);
  const timeout = join(tools, 'timeout');
  writeFileSync(timeout, '#!/bin/sh\ncase "$1" in --kill-after=*) shift;; esac\nshift\nexec "$@"\n');
  chmodSync(timeout, 0o700);
  return { directory, tools, marker, sha: git(directory, 'rev-parse', 'HEAD') };
}

function invoke(values: ReturnType<typeof fixture>, extra: Record<string, string> = {}) {
  return spawnSync('bash', [SCRIPT], {
    cwd: values.directory,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${values.tools}:${process.env.PATH ?? ''}`,
      NPX_MARKER: values.marker,
      EXPO_TOKEN: 'test-token',
      SURFACE: 'customer',
      GITHUB_SHA: values.sha,
      GITHUB_RUN_ID: '100',
      GITHUB_RUN_ATTEMPT: '1',
      FACTORY_ARTIFACT_DIGEST: `sha256:${'0'.repeat(64)}`,
      GITHUB_STEP_SUMMARY: join(values.tools, 'summary.md'),
      ...extra,
    },
  });
}

function assertRejectedBeforeNpx(result: ReturnType<typeof spawnSync>, marker: string): void {
  assert.equal(result.status, 1, String(result.error ?? result.stderr));
  assert.equal(result.stdout, '');
  assert.match(String(result.stderr), /Exact-commit updates require a clean checkout/);
  assert.throws(() => readFileSync(marker), { code: 'ENOENT' });
}

describe('EAS exact-commit staging boundary', () => {
  it('rejects dirty tracked files before invoking EAS', (t) => {
    const values = fixture(t);
    writeFileSync(join(values.directory, 'tracked.txt'), 'dirty\n');
    assertRejectedBeforeNpx(invoke(values), values.marker);
  });

  it('rejects untracked files before invoking EAS', (t) => {
    const values = fixture(t);
    writeFileSync(join(values.directory, 'untracked.txt'), 'untracked\n');
    assertRejectedBeforeNpx(invoke(values), values.marker);
  });

  it('reconciles one ambiguous EAS update without publishing twice', (t) => {
    const values = fixture(t);
    const candidate = `release-${values.sha}-100-1`;
    const stub = String.raw`#!/bin/sh
case " $* " in
  *" config "*)
    printf '%s\n' '{"extra":{"eas":{"projectId":"11111111-1111-4111-8111-111111111111"}}}' ;;
  *" update --branch "*)
    printf 'called\n' >> "$NPX_MARKER"
    exit 1 ;;
  *" branch:view "*)
    jq -cn --arg name "$CANDIDATE" --arg group "$GROUP" \
      '{name:$name,id:"22222222-2222-4222-8222-222222222222",currentPage:[{group:$group}]}' ;;
  *" update:view "*)
    jq -cn --arg branch "$CANDIDATE" --arg group "$GROUP" --arg sha "$GITHUB_SHA" '
      ["android","ios"] | map({id:(if . == "android" then
        "33333333-3333-4333-8333-333333333333" else
        "44444444-4444-4444-8444-444444444444" end),platform:.,group:$group,
        branch:$branch,runtimeVersion:"exposdk:54.0.0",gitCommitHash:$sha,
        manifestPermalink:("https://expo.dev/updates/" + .)})' ;;
  *) exit 91 ;;
esac
`;
    writeFileSync(join(values.tools, 'npx'), stub);
    chmodSync(join(values.tools, 'npx'), 0o700);
    const result = invoke(values, { CANDIDATE: candidate, GROUP: 'group-1' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
    assert.equal(readFileSync(values.marker, 'utf8'), 'called\n');
    const evidence = JSON.parse(
      readFileSync(join(values.directory, 'eas-stage', 'customer.json'), 'utf8'),
    );
    assert.equal(evidence.updateGroup, 'group-1');
    assert.match(evidence.updateDigest, /^[0-9a-f]{64}$/);
    assert.equal(evidence.updates.length, 2);
  });

  it('stops ambiguous-update observation at its absolute deadline', (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'eas-deadline-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const marker = join(directory, 'called');
    const result = spawnSync('bash', ['-c', String.raw`
      set -euo pipefail
      source "$STAGE_STATE"
      recover_group_before_deadline() { printf called > "$MARKER"; }
      if reconcile_group_until "$SECONDS"; then exit 9; fi
      test ! -e "$MARKER"
    `], { encoding: 'utf8', env: { ...process.env, STAGE_STATE, MARKER: marker } });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
  });

  it('refuses to switch after the captured rollback branch drifts', (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'eas-source-drift-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const log = join(directory, 'calls');
    const result = spawnSync('bash', ['-c', String.raw`
      set -euo pipefail
      temporary_directory="$TEMP_DIR"; mkdir -p "$temporary_directory"
      candidate_id=22222222-2222-4222-8222-222222222222
      candidate=candidate; prior_id=11111111-1111-4111-8111-111111111111
      prior_name=prior; prior_group=old-group; prior_digest=$(printf 'a%.0s' {1..64})
      eas=(eas); GITHUB_SHA=$(printf 'b%.0s' {1..40}); runtime=exposdk:54.0.0
      source "$RELEASE_STATE"
      view_channel() { printf '{}' > "$1"; }
      mapped_branch() { printf '%s\t%s\n' "$prior_id" "$prior_name"; }
      verify_candidate() { printf 'candidate\n' >> "$CALL_LOG"; }
      verify_branch_snapshot() { printf 'prior\n' >> "$CALL_LOG"; return 1; }
      run_in_app() { printf 'mutation\n' >> "$CALL_LOG"; }
      if move_channel "$prior_id" "$prior_name" "$candidate_id" "$candidate"; then exit 9; fi
      grep -qx prior "$CALL_LOG"
      ! grep -q mutation "$CALL_LOG"
    `], {
      encoding: 'utf8',
      env: { ...process.env, RELEASE_STATE, TEMP_DIR: directory, CALL_LOG: log },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
  });
});
