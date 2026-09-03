import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  activeModuleKeys, capabilityDrift, flagModuleKeys,
  type CapabilityDriftRecord, type ModuleInstallationRow,
} from './drift';
import { LEGACY_FLAG_MODULE_MAP } from './registry';

const row = (moduleKey: string, state: string): ModuleInstallationRow => ({
  module_key: moduleKey, version: '1.0.0', state, config_revision: 1,
});

const FLAG_STATES = ['active', 'suspended', 'disabled', null] as const;

/** The expected drift for one mapped flag at one installation state, if any. */
function expected(
  moduleKey: string,
  flagOn: boolean,
  state: string | null,
): CapabilityDriftRecord[] {
  if (flagOn === (state === 'active')) return [];
  return [{
    moduleKey,
    flag: flagOn,
    installationState: state,
    direction: flagOn ? 'flag-only' : 'module-only',
  }];
}

describe('activeModuleKeys', () => {
  it('keeps only active installations the registry knows, sorted', () => {
    assert.deepEqual(activeModuleKeys([
      row('workforce-operations', 'active'),
      row('growth-drops', 'suspended'),
      row('commerce-catering', 'active'),
      row('not-a-module', 'active'),
      row('growth-drops', 'active'),
    ]), ['commerce-catering', 'growth-drops', 'workforce-operations']);
    assert.deepEqual(activeModuleKeys([]), []);
  });
});

describe('flagModuleKeys', () => {
  it('maps true flags in flag-map order and ignores the rest', () => {
    assert.deepEqual(flagModuleKeys({
      operations: true, drops: true, stored_value: false,
      sms: true, multi_location: true,
    }), ['growth-drops', 'workforce-operations']);
    assert.deepEqual(flagModuleKeys({}), []);
  });
});

describe('capabilityDrift', () => {
  it('reports the full flag-by-installation matrix for every mapped flag', () => {
    for (const [flag, moduleKey] of Object.entries(LEGACY_FLAG_MODULE_MAP)) {
      for (const flagOn of [true, false]) {
        for (const state of FLAG_STATES) {
          const drift = capabilityDrift(
            state === null ? [] : [row(moduleKey, state)],
            { [flag]: flagOn },
          );
          assert.deepEqual(drift, expected(moduleKey, flagOn, state),
            `${flag}=${flagOn} installation=${state ?? 'absent'}`);
        }
      }
    }
  });

  it('reports nothing for unmapped flags, however they are set', () => {
    for (const value of [true, false, undefined]) {
      assert.deepEqual(capabilityDrift([], { multi_location: value, sms: value }), []);
    }
  });

  it('reports unknown installation keys without throwing, in input order', () => {
    assert.deepEqual(capabilityDrift(
      [row('growth-holograms', 'active'), row('zz-retired', 'disabled')],
      {},
    ), [
      { moduleKey: 'growth-holograms', flag: null, installationState: 'active', direction: 'unknown-module' },
      { moduleKey: 'zz-retired', flag: null, installationState: 'disabled', direction: 'unknown-module' },
    ]);
  });

  it('reports an active unmapped module as module-only with a null flag', () => {
    assert.deepEqual(capabilityDrift([row('local-printing', 'active')], {}), [
      { moduleKey: 'local-printing', flag: null, installationState: 'active', direction: 'module-only' },
    ]);
    assert.deepEqual(capabilityDrift([row('local-printing', 'draft')], {}), []);
  });

  it('reports nothing when both surfaces are empty or in agreement', () => {
    assert.deepEqual(capabilityDrift([], {}), []);
    const flags = Object.fromEntries(
      Object.keys(LEGACY_FLAG_MODULE_MAP).map((flag) => [flag, true]),
    );
    const installations = Object.values(LEGACY_FLAG_MODULE_MAP)
      .map((moduleKey) => row(moduleKey, 'active'));
    assert.deepEqual(capabilityDrift(installations, flags), []);
  });
});
