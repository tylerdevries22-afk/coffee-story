/**
 * What HQ writes back, and what it shows while writing it. Both functions live
 * in resolve.ts; they sit in their own file only so neither suite grows past
 * being readable in one screen.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULT_KIOSK_FLOW, inspectKioskFlow, normalizeForSave, resolveKioskFlow } from '../kiosk-flow';
import { CONTEXT, MENU } from './menu.fixture';

describe('normalizeForSave', () => {
  it('does not freeze a derived tile list into stored config', () => {
    // Saving the derived list would stop the kiosk following the menu from
    // that moment on, silently.
    const saved = normalizeForSave(resolveKioskFlow({}, CONTEXT));
    assert.deepEqual(saved.entry, { prompt: DEFAULT_KIOSK_FLOW.entry.prompt });
    assert.equal('entryDerived' in saved, false);
  });

  it('keeps a list the tenant actually configured', () => {
    const flow = resolveKioskFlow({
      entry: { prompt: 'Pick one', nodes: [{ id: 'a', label: 'Boba', target: { kind: 'category', categoryId: 'boba' } }] },
    }, CONTEXT);
    const saved = normalizeForSave(flow) as { entry: { nodes: unknown[] } };
    assert.equal(saved.entry.nodes.length, 1);
  });

  it('round-trips: what HQ writes reads back as the same flow', () => {
    const flow = resolveKioskFlow({
      family: 'pack',
      entry: { prompt: 'How many?', nodes: [{ id: 'six', label: '6-Pack', emphasis: 'hero', target: { kind: 'item', itemSlug: 'six-pack' } }] },
      tenders: ['card', 'cash'],
      guestName: { mode: 'required' },
    }, CONTEXT);
    assert.deepEqual(resolveKioskFlow(normalizeForSave(flow), CONTEXT), flow);
  });
});

describe('inspectKioskFlow', () => {
  it('says nothing about a clean config', () => {
    assert.deepEqual(inspectKioskFlow({
      entry: { nodes: [{ id: 'a', label: 'Boba', target: { kind: 'category', categoryId: 'boba' } }] },
    }, CONTEXT), []);
  });

  it('names the dropped field by its path so the editor can point at it', () => {
    const notes = inspectKioskFlow({
      entry: {
        nodes: [
          { id: 'a', label: 'Boba', target: { kind: 'category', categoryId: 'boba' } },
          { id: 'b', label: 'Gone', target: { kind: 'category', categoryId: 'pastries' } },
        ],
      },
    }, CONTEXT);
    assert.deepEqual(notes.map((entry) => entry.path), ['kiosk.entry.nodes[1].target']);
    assert.match(notes[0]?.message ?? '', /dead button/);
  });

  it('explains a tender withheld by the brand feature flag', () => {
    const notes = inspectKioskFlow(
      { tenders: ['card', 'stored_value'] },
      { menu: MENU, features: { stored_value: false } },
    );
    assert.deepEqual(notes.map((entry) => entry.path), ['kiosk.tenders']);
  });

  /** Resolving must never do anything inspecting does not report. */
  it('agrees with resolve: no notes means nothing was dropped from the tiles', () => {
    const config = {
      entry: { nodes: [
        { id: 'a', label: 'Boba', target: { kind: 'category', categoryId: 'boba' } },
        { id: 'b', label: 'Coffee', target: { kind: 'category', categoryId: 'coffee' } },
      ] },
    };
    assert.equal(inspectKioskFlow(config, CONTEXT).length, 0);
    assert.equal(resolveKioskFlow(config, CONTEXT).entry.nodes.length, 2);
  });
});
