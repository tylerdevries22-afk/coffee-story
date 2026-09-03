import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_KIOSK_FLOW,
  EMPTY_MENU_FACTS,
  entryNodesFromCategories,
  resolveKioskFlow,
  type KioskEntryNode,
} from '../kiosk-flow';
import { CATEGORIES, CONTEXT, MENU } from './menu.fixture';

const FALLBACK: readonly KioskEntryNode[] = entryNodesFromCategories(CATEGORIES);

describe('resolveKioskFlow', () => {
  it('gives a tenant that has configured nothing a working screen from its own menu', () => {
    const flow = resolveKioskFlow(undefined, CONTEXT);
    assert.deepEqual(flow.entry.nodes, FALLBACK);
    assert.equal(flow.entry.prompt, DEFAULT_KIOSK_FLOW.entry.prompt);
    assert.equal(flow.family, 'item');
  });

  it('falls back to the menu when every configured node is malformed', () => {
    const flow = resolveKioskFlow(
      { entry: { nodes: [{ label: 'No id' }, { id: 'no-target' }, 'nonsense'] } },
      CONTEXT,
    );
    assert.deepEqual(flow.entry.nodes, FALLBACK);
  });

  it('drops one malformed node while its siblings survive', () => {
    const flow = resolveKioskFlow({
      entry: {
        prompt: 'What are we having?',
        nodes: [
          { id: 'a', label: 'Drinks', emphasis: 'hero', target: { kind: 'category', categoryId: 'coffee' } },
          { id: 'b', label: 'Broken', target: { kind: 'category' } },
          { id: 'c', label: 'Gift Cards', emphasis: 'minor', target: { kind: 'utility', utility: 'giftBalance' } },
        ],
      },
    }, CONTEXT);
    assert.deepEqual(flow.entry.nodes.map((node) => node.id), ['a', 'c']);
    assert.equal(flow.entry.prompt, 'What are we having?');
  });

  it('keeps the first of two nodes sharing an id', () => {
    const flow = resolveKioskFlow({
      entry: {
        nodes: [
          { id: 'dup', label: 'First', target: { kind: 'category', categoryId: 'coffee' } },
          { id: 'dup', label: 'Second', target: { kind: 'category', categoryId: 'boba' } },
        ],
      },
    }, CONTEXT);
    assert.deepEqual(flow.entry.nodes.map((node) => node.label), ['First']);
  });

  it('allows catalog groups through the five-level hierarchy limit', () => {
    const flow = resolveKioskFlow({
      entry: {
        nodes: [{
          id: 'large', label: 'Large', target: {
            kind: 'group',
            nodes: [
              { id: 'six', label: '6-Pack', target: { kind: 'item', itemSlug: 'six-pack' } },
              { id: 'deeper', label: 'Deeper', target: { kind: 'group', nodes: [
                { id: 'x', label: 'X', target: { kind: 'item', itemSlug: 'x' } },
              ] } },
            ],
          },
        }],
      },
    }, CONTEXT);
    const group = flow.entry.nodes[0]?.target;
    assert.equal(group?.kind, 'group');
    assert.deepEqual(
      group?.kind === 'group' ? group.nodes.map((node) => node.id) : null,
      ['six', 'deeper'],
    );
  });

  it('falls back on an unknown enum instead of carrying it through', () => {
    const flow = resolveKioskFlow({
      family: 'buffet',
      motion: 'sideways',
      guestName: { mode: 'shouted' },
      entry: { nodes: [{ id: 'a', label: 'A', emphasis: 'gigantic', target: { kind: 'category', categoryId: 'coffee' } }] },
    }, CONTEXT);
    assert.equal(flow.family, 'item');
    assert.equal(flow.motion, 'full');
    assert.equal(flow.guestName.mode, 'optional');
    assert.equal(flow.entry.nodes[0]?.emphasis, 'standard');
  });

  it('reads the pack family and the utility chrome a container tenant asks for', () => {
    const flow = resolveKioskFlow({
      family: 'pack',
      utilities: ['allergens', 'rewards', 'allergens', 'nonsense'],
    }, CONTEXT);
    assert.equal(flow.family, 'pack');
    assert.deepEqual(flow.utilities, ['allergens', 'rewards']);
  });

  /**
   * HQ stores the *resolved* flow, so the console's save is a round trip
   * through this function. If resolving a resolved flow changed anything, a
   * brand owner opening the tab and pressing Save would silently edit their
   * own kiosk.
   */
  it('is idempotent on its own output, which is what makes the HQ round trip safe', () => {
    const once = resolveKioskFlow({
      family: 'pack',
      attract: { headline: 'Freshly pulled', invite: 'Tap to begin', showLogo: false },
      entry: { prompt: 'Pick a size', nodes: [
        { id: 'large', label: 'Large', emphasis: 'hero', imageSlug: 'latte', caption: 'Six or twelve', target: { kind: 'group', nodes: [
          { id: 'six', label: '6-Pack', target: { kind: 'item', itemSlug: 'six-pack' } },
        ] } },
      ] },
      utilities: ['rewards'],
      identify: { mode: 'optional', methods: ['phone'] },
      tenders: ['card', 'stored_value'],
      tip: { enabled: true, presetsCents: [200, 300] },
      guestName: { mode: 'required' },
      survey: { enabled: true, prompt: 'How did you find us?', groups: [
        { id: 'social', label: 'Social', options: [{ id: 'instagram', label: 'Instagram' }] },
      ] },
      idle: { warnMs: 45_000, resetMs: 75_000 },
      motion: 'reduced',
    }, { menu: MENU, features: { stored_value: true } });
    const twice = resolveKioskFlow(once, { menu: MENU, features: { stored_value: true } });
    assert.deepEqual(twice, once);
  });
});

describe('resolveKioskFlow against the menu', () => {
  it('drops a tile pointing at a category that is no longer on the menu', () => {
    const flow = resolveKioskFlow({
      entry: {
        nodes: [
          { id: 'live', label: 'Boba', target: { kind: 'category', categoryId: 'boba' } },
          { id: 'dead', label: 'Pastries', target: { kind: 'category', categoryId: 'pastries' } },
        ],
      },
    }, CONTEXT);
    assert.deepEqual(flow.entry.nodes.map((node) => node.id), ['live']);
  });

  it('keeps every tile when the menu is unknown, rather than blanking the screen', () => {
    // HQ before the rows load, or any caller with no facts. Unverifiable is not
    // the same as invalid.
    const config = {
      entry: { nodes: [{ id: 'dead', label: 'Pastries', target: { kind: 'category', categoryId: 'pastries' } }] },
    };
    assert.equal(resolveKioskFlow(config, {}).entry.nodes.length, 1);
    assert.equal(resolveKioskFlow(config, { menu: EMPTY_MENU_FACTS }).entry.nodes.length, 1);
  });

  it('flags the entry list as derived only when nothing usable was configured', () => {
    assert.equal(resolveKioskFlow({}, CONTEXT).entryDerived, true);
    assert.equal(resolveKioskFlow({ entry: { nodes: [] } }, CONTEXT).entryDerived, true);
    const configured = resolveKioskFlow({
      entry: { nodes: [{ id: 'a', label: 'Boba', target: { kind: 'category', categoryId: 'boba' } }] },
    }, CONTEXT);
    assert.equal(configured.entryDerived, false);
  });
});
