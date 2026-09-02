import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  canTransition, evaluateActivation, parseActivationState, transitionActivation,
} from './activation';
import { ACTIVATION_STATES } from './types';

describe('transitionActivation', () => {
  it('walks the documented lifecycle', () => {
    for (const [from, to] of [
      ['draft', 'validating'], ['validating', 'active'], ['active', 'suspended'],
      ['suspended', 'active'], ['active', 'disabled'],
    ] as const) {
      const result = transitionActivation(from, to);
      assert.equal(result.kind, 'ok', `${from} -> ${to}`);
      if (result.kind === 'ok') assert.equal(result.state, to);
    }
  });

  it('allows an errored module to retry validation', () => {
    assert.equal(transitionActivation('error', 'validating').kind, 'ok');
    assert.equal(transitionActivation('validating', 'error').kind, 'ok');
  });

  it('rejects jumps that skip human-visible states', () => {
    for (const [from, to] of [
      ['draft', 'active'], ['suspended', 'validating'], ['disabled', 'active'],
    ] as const) {
      assert.equal(transitionActivation(from, to).kind, 'illegal', `${from} -> ${to}`);
    }
  });

  it('rejects self-transitions with a reason', () => {
    const result = transitionActivation('active', 'active');
    assert.equal(result.kind, 'illegal');
    if (result.kind === 'illegal') assert.match(result.reason, /own state/);
  });

  it('lets any state be disabled', () => {
    for (const state of ACTIVATION_STATES) {
      if (state === 'disabled') continue;
      assert.equal(canTransition(state, 'disabled'), true, state);
    }
  });
});

describe('evaluateActivation', () => {
  const pass = { passed: true } as const;

  it('is ready only when all six checks pass', () => {
    const all = { dependencies: pass, configuration: pass, migrations: pass, credentials: pass, surfaces: pass, hardware: pass };
    const result = evaluateActivation(all);
    assert.equal(result.ready, true);
    assert.equal(result.checks.length, 6);
  });

  it('treats a missing fact as failed, never as skipped', () => {
    const result = evaluateActivation({
      dependencies: pass, configuration: pass, migrations: pass,
      credentials: pass, surfaces: pass,
      // hardware absent: the caller did not probe it
    } as Parameters<typeof evaluateActivation>[0]);
    assert.equal(result.ready, false);
    const hardware = result.checks.find((check) => check.id === 'hardware');
    assert.equal(hardware?.passed, false);
  });

  it('keeps failure detail for the operator', () => {
    const result = evaluateActivation({
      dependencies: pass, configuration: { passed: false, detail: 'tax rate missing' },
      migrations: pass, credentials: pass, surfaces: pass, hardware: pass,
    });
    assert.equal(result.ready, false);
    const configuration = result.checks.find((check) => check.id === 'configuration');
    assert.equal(configuration?.detail, 'tax rate missing');
  });
});

describe('parseActivationState', () => {
  it('round-trips known states and rejects everything else', () => {
    for (const state of ACTIVATION_STATES) assert.equal(parseActivationState(state), state);
    assert.equal(parseActivationState('ACTIVE'), null);
    assert.equal(parseActivationState(42), null);
    assert.equal(parseActivationState(null), null);
  });
});
