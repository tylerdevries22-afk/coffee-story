import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const simulatorWorkflow = readFileSync('.github/workflows/simulators.yml', 'utf8');
const verifyWorkflow = readFileSync('.github/workflows/verify.yml', 'utf8');
const simulatorLauncher = readFileSync('scripts/launch-simulators.sh', 'utf8');
const simulatorLibrary = readFileSync('scripts/lib/launch-simulators-lib.sh', 'utf8');

function countMatches(value, pattern) {
  return [...value.matchAll(pattern)].length;
}

function runBash(source) {
  return execFileSync('/bin/bash', ['-c', source], { encoding: 'utf8' }).trim();
}

describe('local simulator launcher helpers', () => {
  it('keeps each handwritten shell module within the source limit', () => {
    assert.ok(simulatorLauncher.split('\n').length <= 201);
    assert.ok(simulatorLibrary.split('\n').length <= 201);
    assert.match(simulatorLauncher, /source "\$REPO\/scripts\/lib\/launch-simulators-lib\.sh"/);
  });

  it('matches simulator names without punctuation or case sensitivity', () => {
    const output = runBash(`
      source scripts/lib/launch-simulators-lib.sh
      xcrun() { printf '%s' '{"devices":{"runtime":[{"name":"Coffee Story Ops","udid":"ops-1","isAvailable":true}]}}'; }
      find_sim 'coffee-story-ops'
    `);
    assert.equal(output, 'ops-1');
  });

  it('skips occupied and reserved Metro ports', () => {
    const output = runBash(`
      source scripts/lib/launch-simulators-lib.sh
      fail() { exit 1; }
      lsof() { [ "$2" = 'tcp:8081' ]; }
      free_port 8081 8082
    `);
    assert.equal(output, '8083');
  });
});

describe('simulator workflow evidence', () => {
  it('preapproves Expo Go handoffs before booting fresh devices', () => {
    const approval = simulatorWorkflow.indexOf(
      'com.apple.CoreSimulator.CoreSimulatorBridge-->exp',
    );
    const boot = simulatorWorkflow.indexOf('xcrun simctl bootstatus');
    assert.ok(approval >= 0 && approval < boot);
    assert.match(simulatorWorkflow, /-->exp"] = "host\.exp\.Exponent"/);
  });

  it('requires both app handoffs and both device execution signals', () => {
    assert.match(simulatorWorkflow, /touch \/tmp\/open-customer\.ok/);
    assert.match(simulatorWorkflow, /touch \/tmp\/open-operator\.ok/);
    assert.match(
      simulatorWorkflow,
      /\[ "\$handoff_ok" = 1 \] && \[ "\$device_ok" = 1 \] && \[ "\$bundle_ok" = 1 \]/,
    );
    assert.doesNotMatch(simulatorWorkflow, /\[ "\$device_ok" = 1 \] \|\|/);
  });

  it('rejects HTTP error bodies as bundle proof', () => {
    assert.equal(countMatches(simulatorWorkflow, /curl --fail-with-body/g), 1);
    assert.match(simulatorWorkflow, /--output "\$body" --write-out '%\{size_download\}'/);
    assert.doesNotMatch(simulatorWorkflow, /size_download[^\n]+\|\| echo 0/);
  });

  it('keeps Safari diagnostic-only and asserts two nonblank app screens', () => {
    assert.match(
      simulatorWorkflow,
      /- name: Can a device reach the dev server at all\?[\s\S]*?if: failure\(\)/,
    );
    assert.match(simulatorWorkflow, /- name: Assert both apps rendered on their devices/);
    assert.match(simulatorWorkflow, /customer-coffee-story-cust\.bmp/);
    assert.match(simulatorWorkflow, /operator-coffee-story-ops\.bmp/);
    assert.match(simulatorWorkflow, /len\(tones\) < 4/);
  });
});

describe('verification workflow failure ownership', () => {
  it('retries only transient hosted migration pushes', () => {
    assert.equal(
      countMatches(verifyWorkflow, /^\s+retry_transient_supabase supabase/gm),
      1,
    );
    assert.match(verifyWorkflow, /retry_transient_supabase supabase db push/);
    assert.match(verifyWorkflow, /deterministic failure; not retrying/);
    assert.match(verifyWorkflow, /timeout 15m supabase db lint/);
    assert.equal(countMatches(verifyWorkflow, /timeout 15m supabase db advisors/g), 2);
    assert.doesNotMatch(verifyWorkflow, /retry_supabase/);
  });

  for (const [producer, artifact] of [
    ['workspace_verification', 'verification-coverage'],
    ['browser_tests', 'browser-coverage'],
    ['database_tests', 'integration-coverage'],
    ['merge_coverage', 'merged-coverage'],
  ]) {
    it(`makes ${artifact} strict only after ${producer} succeeds`, () => {
      assert.match(
        verifyWorkflow,
        new RegExp(
          `always\\(\\) && steps\\.${producer}\\.outcome == 'success'[\\s\\S]*?name: ${artifact}[\\s\\S]*?if-no-files-found: error`,
        ),
      );
      assert.match(
        verifyWorkflow,
        new RegExp(
          `always\\(\\) && steps\\.${producer}\\.outcome == 'failure'[\\s\\S]*?name: ${artifact}-partial[\\s\\S]*?if-no-files-found: ignore`,
        ),
      );
    });
  }
});
