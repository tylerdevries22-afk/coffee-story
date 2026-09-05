import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { presetMap, validWallData } from './wall-model.mjs';

function fixture() {
  return {
    schemaVersion: 2,
    context: { tenantKey: 'example-co', organizationName: 'Example Co' },
    devicePresets: [
      { id: 'desktop', label: 'Desktop', device: 'Desktop', width: 1440, height: 900, frame: 'desktop' },
      { id: 'tablet', label: 'Tablet', device: 'Tablet landscape', width: 1180, height: 820, frame: 'tablet' },
      { id: 'mobile', label: 'Mobile', device: 'Mobile portrait', width: 390, height: 844, frame: 'phone' },
    ],
    surfaces: [{
      launch: 'operator-web', name: 'Operator', port: 4191, path: '/', span: 2,
      devices: ['desktop', 'tablet', 'mobile'], defaultDevice: 'tablet', activeDevice: 'mobile',
    }],
  };
}

describe('published preview wall model', () => {
  it('accepts the canonical three-device contract', () => {
    const data = fixture();
    assert.equal(validWallData(data), true);
    assert.equal(presetMap(data).get('mobile').frame, 'phone');
  });

  it('rejects duplicate presets and device lists', () => {
    const duplicatePreset = fixture();
    duplicatePreset.devicePresets[2] = { ...duplicatePreset.devicePresets[1] };
    assert.equal(validWallData(duplicatePreset), false);
    const duplicateDevice = fixture();
    duplicateDevice.surfaces[0].devices = ['desktop', 'tablet', 'tablet'];
    assert.equal(validWallData(duplicateDevice), false);
  });

  it('rejects unknown active devices and unsafe paths', () => {
    const unknown = fixture();
    unknown.surfaces[0].activeDevice = 'watch';
    assert.equal(validWallData(unknown), false);
    const unsafe = fixture();
    unsafe.surfaces[0].path = '//attacker.example';
    assert.equal(validWallData(unsafe), false);
    const unsupportedSpan = fixture();
    unsupportedSpan.surfaces[0].span = 4;
    assert.equal(validWallData(unsupportedSpan), false);
  });
});
