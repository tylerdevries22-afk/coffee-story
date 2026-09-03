import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveKioskFlow, settlementFor, wireTendersFor } from '../kiosk-flow';
import { CONTEXT, MENU } from './menu.fixture';

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
