import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describe, it, type TestContext } from 'node:test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const HELPER = join(ROOT, 'scripts', 'hosted-release-rollback.sh');

const HARNESS = `#!/usr/bin/env bash
set -uo pipefail
source "$ROLLBACK_HELPER"
event() { printf '%s\n' "$1" >> "$CALL_LOG"; }
surface() { jq -r '.surface' "$1"; }
tac() { awk '{ line[NR]=$0 } END { for (i=NR; i>0; i--) print line[i] }' "$1"; }
restore_package_publication() {
  event package:restore
  [[ "$MODE" != compensation-fail ]] || return 1
  package_compensation_status=compensated
}
restore_eas_surface() {
  local value; value=$(surface "$1"); event "restore:eas:$value"
  if [[ "$MODE" == signal-fail && "$value" == operator ]]; then
    kill -HUP "$$"; kill -INT "$$"; kill -TERM "$$"; return 1
  fi
  [[ "$MODE" != provider-fail || "$value" != operator ]] || return 1
  jq -cn --arg surface "$value" \
    '{schemaVersion:1,provider:"eas-update",surface:$surface,status:"restored"}'
}
restore_vercel_surface() {
  local value; value=$(surface "$1"); event "restore:vercel:$value"
  jq -cn --arg surface "$value" \
    '{schemaVersion:1,provider:"vercel",surface:$surface,status:"restored"}'
}
verify_restored_eas_surface() {
  local value; value=$(surface "$1"); event "verify:eas:$value"
  jq -cn --arg surface "$value" \
    '{schemaVersion:1,provider:"eas-update",surface:$surface,status:"restoration-verified"}'
}
verify_restored_vercel_surface() {
  local value; value=$(surface "$1"); event "verify:vercel:$value"
  [[ "$MODE" != provider-fail || "$value" != hq ]] || return 1
  jq -cn --arg surface "$value" \
    '{schemaVersion:1,provider:"vercel",surface:$surface,status:"restoration-verified"}'
}
confirm_package_compensation() {
  event package:confirm
  jq -cn '{schemaVersion:1,provider:"tenant-package",surface:"publication",status:"restoration-confirmed"}'
}
if [[ "$MODE" == signal-fail ]]; then
  install_release_rollback_traps
  kill -"$TRIGGER" "$$"
  exit 9
fi
restore_attempted_release_set
exit $?
`;

function json(path: string, surface: string): void {
  writeFileSync(path, JSON.stringify({ surface }));
}

function run(t: TestContext, mode: string, trigger = 'HUP') {
  const directory = mkdtempSync(join(tmpdir(), 'hosted-rollback-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, 'eas'));
  mkdirSync(join(directory, 'vercel'));
  for (const surface of ['customer', 'operator']) {
    json(join(directory, 'eas', `${surface}.json`), surface);
    writeFileSync(join(directory, 'eas', `${surface}-state.json`), '{}');
  }
  for (const surface of ['hq', 'customer']) {
    json(join(directory, 'vercel', `${surface}.json`), surface);
  }
  writeFileSync(join(directory, 'attempted-package-rollback.txt'), 'package-rollback.json\n');
  writeFileSync(join(directory, 'attempted-eas-rollbacks.txt'),
    'eas/customer.json\teas/customer-state.json\neas/operator.json\teas/operator-state.json\n');
  writeFileSync(join(directory, 'attempted-rollbacks.txt'),
    'vercel/hq.json\nvercel/customer.json\n');
  const harness = join(directory, 'harness.sh');
  const log = join(directory, 'calls.log');
  const results = join(directory, 'rollback-results.jsonl');
  writeFileSync(harness, HARNESS, { mode: 0o700 });
  const result = spawnSync('bash', [harness], {
    cwd: directory,
    encoding: 'utf8',
    env: { ...process.env, ROLLBACK_HELPER: HELPER, ROLLBACK_RESULTS_PATH: results,
      CALL_LOG: log, MODE: mode, TRIGGER: trigger },
  });
  const calls = readFileSync(log, 'utf8').trim().split('\n');
  const records = readFileSync(results, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  return { result, calls, records };
}

describe('hosted release rollback transaction', () => {
  it('restores package, providers in reverse, verifies the whole set, then confirms', (t) => {
    const { result, calls, records } = run(t, 'success');
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(calls, [
      'package:restore',
      'restore:eas:operator', 'restore:eas:customer',
      'restore:vercel:customer', 'restore:vercel:hq',
      'verify:eas:customer', 'verify:eas:operator',
      'verify:vercel:hq', 'verify:vercel:customer',
      'package:confirm',
    ]);
    assert.equal(records.length, 10);
    assert.equal(records.at(-1).status, 'restoration-confirmed');
  });

  it('continues all restores and verification after failures and blocks confirmation', (t) => {
    const { result, calls, records } = run(t, 'provider-fail');
    assert.equal(result.status, 1);
    assert.deepEqual(calls.slice(0, 5), [
      'package:restore', 'restore:eas:operator', 'restore:eas:customer',
      'restore:vercel:customer', 'restore:vercel:hq',
    ]);
    assert.deepEqual(calls.slice(5), [
      'verify:eas:customer', 'verify:eas:operator',
      'verify:vercel:hq', 'verify:vercel:customer',
    ]);
    assert.equal(calls.includes('package:confirm'), false);
    assert.deepEqual(records.filter((record) => record.status === 'restore-failed')
      .map((record) => record.reason), ['provider-rejected', 'final-state-mismatch']);
  });

  it('stops before provider restoration when package compensation is ambiguous', (t) => {
    const { result, calls, records } = run(t, 'compensation-fail');
    assert.equal(result.status, 1);
    assert.deepEqual(calls, ['package:restore']);
    assert.equal(records.length, 1);
    assert.equal(records[0].reason, 'compensation-ambiguous');
  });

  it('handles every termination signal once and blocks confirmation after provider failure', (t) => {
    for (const trigger of ['HUP', 'INT', 'TERM']) {
      const { result, calls } = run(t, 'signal-fail', trigger);
      assert.equal(result.status, 1, `${trigger}: ${result.stderr}`);
      assert.equal(calls.filter((call) => call === 'package:restore').length, 1);
      assert.equal(calls.includes('package:confirm'), false);
    }
  });
});
