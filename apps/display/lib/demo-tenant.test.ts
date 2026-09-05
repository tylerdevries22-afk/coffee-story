import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveActivityBoardConfig } from '@platform/domain';
import { fixtureBoardSnapshot } from './board-snapshot';
import {
  demoActivityItems, selectedDemoBrandConfig, selectedDemoDisplayPresentation,
  selectedDemoLocationName, selectedDemoTenantKind,
} from './demo-tenant';

describe('Stillpoint display tenant', () => {
  it('switches the visitor queue to an activity board from the tenant folder', () => {
    const config = resolveActivityBoardConfig(selectedDemoBrandConfig('stillpoint-builders'));
    assert.equal(config.enabled, true);
    assert.equal(config.title, 'Activity Board');
    assert.deepEqual(selectedDemoDisplayPresentation('stillpoint-builders'), {
      activityConfig: config,
      tenantName: 'Stillpoint Builders',
    });
    assert.equal(selectedDemoLocationName('demo', 'stillpoint-builders'), 'Denver Regional Office');
  });

  it('keeps the default tenant in pickup mode', () => {
    assert.equal(selectedDemoDisplayPresentation('coffee-story').activityConfig.enabled, false);
  });

  it('gives an unknown explicit tenant a neutral Base App preview', () => {
    const presentation = selectedDemoDisplayPresentation('new-neutral-tenant');
    assert.equal(presentation.tenantName, 'Base App');
    assert.equal(presentation.activityConfig.enabled, false);
    assert.equal(selectedDemoLocationName('demo', 'new-neutral-tenant'), 'Main');
    assert.equal(selectedDemoTenantKind('new-neutral-tenant'), 'neutral');
  });

  it('keeps launch and industry fixtures out of a neutral board payload', () => {
    const previous = process.env.TENANT;
    process.env.TENANT = 'new-neutral-tenant';
    try {
      const snapshot = fixtureBoardSnapshot('demo', false, false);
      assert.deepEqual(snapshot.tickets, []);
      assert.deepEqual(snapshot.activityItems, []);
      assert.equal(snapshot.locationName, 'Main');
      assert.equal(snapshot.unpaired, true);
    } finally {
      if (previous === undefined) delete process.env.TENANT;
      else process.env.TENANT = previous;
    }
  });

  it('projects every role without private operation fields', () => {
    const items = demoActivityItems(0, 'demo');
    assert.deepEqual([...new Set(items.flatMap((item) => item.audience_labels))].sort(), [
      'Admin', 'Contractor', 'General Contractor',
    ]);
    for (const item of items) {
      assert.ok(!('completion_note' in item));
      assert.ok(!('template_snapshot' in item));
      assert.ok(!('claimed_by' in item));
    }
  });
});
