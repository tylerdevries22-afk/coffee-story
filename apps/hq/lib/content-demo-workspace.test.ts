import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { demoContentWorkspace } from './content-demo-workspace';

describe('demoContentWorkspace', () => {
  it('keeps the rich catalog on the default launch demo', () => {
    const workspace = demoContentWorkspace();
    assert.ok(workspace.items.length > 0);
    assert.equal(workspace.trainingProfile.businessName, 'Coffee Story');
  });

  it('gives another tenant an empty tenant-owned starting point', () => {
    const workspace = demoContentWorkspace({
      businessName: 'Base App', industry: 'General', locale: 'en-US', products: [],
    });
    assert.equal(workspace.menu.name, 'Base App catalog');
    assert.deepEqual(workspace.items, []);
    assert.equal(workspace.trainingProfile.businessName, 'Base App');
    assert.equal(workspace.training.manifest.tenant.businessName, 'Base App');
  });
});
