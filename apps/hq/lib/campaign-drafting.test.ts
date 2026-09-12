import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import { saveCampaignDraft, type SaveCampaignDraftContext } from './campaign-drafting';
import type { CampaignInput } from './campaign-input';
import type { SessionInfo } from './demo-data';

const BRAND = '11111111-1111-4111-8111-111111111111';
const owner: SessionInfo = { userId: 'u1', email: 'owner@example.test', role: 'brand_owner', brandId: BRAND, brandName: 'Harbor' };
const staff: SessionInfo = { ...owner, role: 'staff' };
const GOOD_INPUT: CampaignInput = {
  name: 'Weekend drop reminder', channel: 'push', audience: 'all', message: 'It\'s back Friday.',
};

type Query = { data: { id: string } | null; error: { message: string } | null };

/** Thrown if the insert is reached, so a test can prove validation ran first. */
class ReachedInsert extends Error {}

function fakeClient(options: {
  readonly insert?: Query;
  readonly insertedRow?: Record<string, unknown>;
  readonly refuseInsert?: boolean;
}): SupabaseClient {
  const result = options.insert ?? { data: { id: 'campaign-1' }, error: null };
  const campaigns = {
    insert: (row: Record<string, unknown>) => {
      if (options.refuseInsert) throw new ReachedInsert();
      if (options.insertedRow) Object.assign(options.insertedRow, row);
      return campaigns;
    },
    select: () => campaigns,
    maybeSingle: async () => result,
  };
  return { from: () => campaigns } as unknown as SupabaseClient;
}

const context = (overrides: Partial<SaveCampaignDraftContext> = {}): SaveCampaignDraftContext => ({
  session: owner, brandId: BRAND, campaignsEnabled: true, client: fakeClient({}), ...overrides,
});

describe('saveCampaignDraft', () => {
  it('refuses when nobody is signed in', async () => {
    const state = await saveCampaignDraft(context({ session: null }), GOOD_INPUT);
    assert.equal(state.kind, 'error');
    assert.match(state.message, /brand owner/);
  });

  it('refuses staff below brand_owner', async () => {
    const state = await saveCampaignDraft(context({ session: staff }), GOOD_INPUT);
    assert.equal(state.kind, 'error');
    assert.match(state.message, /brand owner/);
  });

  it('surfaces the parser error for invalid input instead of reaching the client', async () => {
    const state = await saveCampaignDraft(
      context({ client: fakeClient({ refuseInsert: true }) }),
      { ...GOOD_INPUT, name: '' },
    );
    assert.equal(state.kind, 'error');
    assert.match(state.message, /campaign name/);
  });

  it('refuses when no growth module is active for the brand', async () => {
    const state = await saveCampaignDraft(context({ campaignsEnabled: false }), GOOD_INPUT);
    assert.equal(state.kind, 'error');
    assert.match(state.message, /not enabled/);
  });

  it('refuses when the deployment has no Supabase client', async () => {
    const state = await saveCampaignDraft(context({ client: null }), GOOD_INPUT);
    assert.equal(state.kind, 'error');
    assert.match(state.message, /not connected to Supabase/);
  });

  it('reports a failed insert as a save failure', async () => {
    const state = await saveCampaignDraft(
      context({ client: fakeClient({ insert: { data: null, error: { message: 'db down' } } }) }),
      GOOD_INPUT,
    );
    assert.equal(state.kind, 'error');
    assert.match(state.message, /could not be saved/);
  });

  it('inserts a draft row scoped to the brand and reports success, never enqueuing a send', async () => {
    const insertedRow: Record<string, unknown> = {};
    const state = await saveCampaignDraft(context({ client: fakeClient({ insertedRow }) }), GOOD_INPUT);
    assert.equal(state.kind, 'success');
    assert.equal(insertedRow.brand_id, BRAND);
    assert.equal(insertedRow.status, 'draft');
    assert.equal(insertedRow.channel, 'push');
    assert.deepEqual(insertedRow.audience, { kind: 'all' });
  });
});
