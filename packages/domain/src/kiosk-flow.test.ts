import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_KIOSK_FLOW,
  EMPTY_MENU_FACTS,
  MAX_ENTRY_NODES,
  entryNodesFromCategories,
  inspectKioskFlow,
  normalizeForSave,
  resolveKioskFlow,
  settlementFor,
  wireTendersFor,
  type KioskEntryNode,
} from './kiosk-flow';

const CATEGORIES = [
  { id: 'coffee', title: 'Coffee & Espresso' },
  { id: 'signature', title: 'Signature Lattes' },
  { id: 'boba', title: 'Boba' },
];

const MENU = { categories: CATEGORIES, itemSlugs: ['six-pack', 'x', 'cortado'] };
const FALLBACK: readonly KioskEntryNode[] = entryNodesFromCategories(CATEGORIES);
const CONTEXT = { menu: MENU };

describe('entryNodesFromCategories', () => {
  it('anchors the constellation by giving the first category the hero slot', () => {
    assert.deepEqual(FALLBACK.map((node) => node.emphasis), ['hero', 'standard', 'standard']);
    assert.deepEqual(FALLBACK[0]?.target, { kind: 'category', categoryId: 'coffee' });
  });

  it('skips a category missing an id or a title rather than emitting a blank circle', () => {
    const nodes = entryNodesFromCategories([
      { id: '', title: 'Nameless' },
      { id: 'tea', title: '   ' },
      { id: 'sweets', title: 'Sweets' },
    ]);
    assert.deepEqual(nodes.map((node) => node.id), ['sweets']);
  });

  it('caps the first screen so a long menu cannot make it unreadable', () => {
    const many = Array.from({ length: 30 }, (_, index) => ({ id: `c${index}`, title: `C${index}` }));
    assert.equal(entryNodesFromCategories(many).length, MAX_ENTRY_NODES);
  });
});

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

  it('allows one level of grouping and refuses a second', () => {
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
      ['six'],
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

describe('resolveKioskFlow tenders', () => {
  it('withholds stored value from a brand whose feature column is off', () => {
    const flow = resolveKioskFlow(
      { tenders: ['card', 'stored_value', 'gift_card'] },
      { menu: MENU, features: { stored_value: false } },
    );
    assert.deepEqual(flow.tenders, ['card']);
  });

  it('grants stored value once the brand actually has the feature', () => {
    const flow = resolveKioskFlow(
      { tenders: ['card', 'stored_value', 'gift_card'] },
      { menu: MENU, features: { stored_value: true } },
    );
    assert.deepEqual(flow.tenders, ['card', 'stored_value', 'gift_card']);
  });

  it('never leaves the payment screen with no buttons', () => {
    const flow = resolveKioskFlow({ tenders: ['bitcoin', 'iou'] }, CONTEXT);
    assert.deepEqual(flow.tenders, ['card']);
  });
});

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

describe('tender settlement', () => {
  /**
   * The two enums had zero overlapping values before this existed: not one
   * value the kiosk could emit was accepted by the DB CHECK on
   * `orders.tender_type`.
   */
  it('maps every kiosk tender, and only to values the orders CHECK accepts', () => {
    const postable = ['pay_at_pickup', 'external', 'square_link', 'square_card'];
    for (const tender of ['card', 'cash', 'stored_value', 'gift_card'] as const) {
      const settlement = settlementFor(tender);
      assert.ok(settlement, `${tender} has no settlement`);
      if (settlement.kind === 'wire') {
        assert.ok(postable.includes(settlement.tender), `${tender} -> ${settlement.tender} is not postable`);
      }
    }
  });

  it('treats a balance as reducing what is due, not as settling the order', () => {
    // stored_value and gift_card ride alongside a wire tender via
    // orders.stored_value_applied_cents; posting one as tender_type is wrong.
    assert.deepEqual(settlementFor('stored_value'), { kind: 'balance' });
    assert.deepEqual(settlementFor('gift_card'), { kind: 'balance' });
  });

  it('gives a card-and-balance flow exactly one wire tender to post', () => {
    const flow = resolveKioskFlow(
      { tenders: ['card', 'stored_value'] },
      { menu: MENU, features: { stored_value: true } },
    );
    assert.deepEqual(wireTendersFor(flow), ['square_card']);
  });

  it('never leaves a flow with no way to settle', () => {
    for (const config of [{}, { tenders: [] }, { tenders: ['stored_value'] }]) {
      const flow = resolveKioskFlow(config, { menu: MENU, features: { stored_value: true } });
      assert.ok(wireTendersFor(flow).length > 0, JSON.stringify(config));
    }
  });
});
