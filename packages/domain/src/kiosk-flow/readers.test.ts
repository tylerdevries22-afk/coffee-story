import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveKioskFlow } from '../kiosk-flow';
import { CONTEXT } from './menu.fixture';

describe('resolveKioskFlow identify', () => {
  it('turns identify off when no method is offered, rather than opening a dead end', () => {
    const flow = resolveKioskFlow({ identify: { mode: 'optional', methods: [] } }, CONTEXT);
    assert.deepEqual(flow.identify, { mode: 'off', methods: [] });
  });

  it('keeps the methods a tenant listed, de-duplicated', () => {
    const flow = resolveKioskFlow(
      { identify: { mode: 'optional', methods: ['phone', 'scan', 'phone'] } },
      CONTEXT,
    );
    assert.deepEqual(flow.identify, { mode: 'optional', methods: ['phone', 'scan'] });
  });
});

describe('resolveKioskFlow tip', () => {
  it('drops float dollars and negatives, keeping only integer cents', () => {
    const flow = resolveKioskFlow(
      { tip: { enabled: true, presetsCents: [200, 3.5, -100, 300, 200] } },
      CONTEXT,
    );
    assert.deepEqual(flow.tip, { enabled: true, presetsCents: [200, 300] });
  });

  it('turns tipping off when enabled but every preset is junk', () => {
    const flow = resolveKioskFlow({ tip: { enabled: true, presetsCents: ['two dollars'] } }, CONTEXT);
    assert.deepEqual(flow.tip, { enabled: false, presetsCents: [] });
  });
});

describe('resolveKioskFlow survey', () => {
  it('drops a group with no usable options and disables an empty survey', () => {
    const flow = resolveKioskFlow({
      survey: { enabled: true, groups: [{ id: 'social', label: 'Social', options: [] }] },
    }, CONTEXT);
    assert.deepEqual(flow.survey, { enabled: false, prompt: '', groups: [] });
  });

  it('keeps a well-formed group and supplies a prompt when the tenant omits one', () => {
    const flow = resolveKioskFlow({
      survey: {
        enabled: true,
        groups: [{
          id: 'social', label: 'Social', options: [
            { id: 'instagram', label: 'Instagram' },
            { id: 'blank' },
            { id: 'friend', label: 'A friend' },
          ],
        }],
      },
    }, CONTEXT);
    assert.equal(flow.survey.enabled, true);
    assert.ok(flow.survey.prompt.length > 0);
    assert.deepEqual(flow.survey.groups[0]?.options.map((option) => option.id), ['instagram', 'friend']);
  });
});

describe('resolveKioskFlow idle', () => {
  it('defaults to warning at 60s and resetting at 90s', () => {
    assert.deepEqual(resolveKioskFlow({}, CONTEXT).idle, { warnMs: 60_000, resetMs: 90_000 });
  });

  it('pushes the reset out when a config would warn after it, or at the same moment', () => {
    const inverted = resolveKioskFlow({ idle: { warnMs: 90_000, resetMs: 30_000 } }, CONTEXT);
    assert.equal(inverted.idle.warnMs, 90_000);
    assert.ok(inverted.idle.resetMs > inverted.idle.warnMs);
  });

  it('keeps a readable gap between the warning and the reset', () => {
    const tight = resolveKioskFlow({ idle: { warnMs: 60_000, resetMs: 61_000 } }, CONTEXT);
    assert.equal(tight.idle.resetMs - tight.idle.warnMs, 10_000);
  });

  it('clamps a timing that would blank the screen constantly or never at all', () => {
    const fast = resolveKioskFlow({ idle: { warnMs: 200, resetMs: 400 } }, CONTEXT);
    assert.equal(fast.idle.warnMs, 15_000);
    const slow = resolveKioskFlow({ idle: { warnMs: 5_000_000, resetMs: 9_000_000 } }, CONTEXT);
    assert.equal(slow.idle.resetMs, 600_000);
  });
});
