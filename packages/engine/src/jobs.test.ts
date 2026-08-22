import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { dueCampaigns, dueDropTransitions } from './jobs';

const NOW = new Date('2026-08-22T15:00:00Z');

describe('dueDropTransitions', () => {
  it('goes live at start and ends at end', () => {
    const transitions = dueDropTransitions([
      { id: 'starts', status: 'scheduled', startsAt: '2026-08-22T14:00:00Z', endsAt: '2026-08-29T14:00:00Z' },
      { id: 'not-yet', status: 'scheduled', startsAt: '2026-08-23T14:00:00Z', endsAt: '2026-08-29T14:00:00Z' },
      { id: 'over', status: 'live', startsAt: '2026-08-15T14:00:00Z', endsAt: '2026-08-22T14:00:00Z' },
      { id: 'running', status: 'live', startsAt: '2026-08-20T14:00:00Z', endsAt: '2026-08-25T14:00:00Z' },
    ], NOW);
    assert.deepEqual(transitions, [{ id: 'starts', to: 'live' }, { id: 'over', to: 'ended' }]);
  });

  it('sends a scheduled drop whose whole window passed straight to ended', () => {
    // The tick was down across the window; going live now would be a lie.
    const transitions = dueDropTransitions([
      { id: 'missed', status: 'scheduled', startsAt: '2026-08-20T14:00:00Z', endsAt: '2026-08-21T14:00:00Z' },
    ], NOW);
    assert.deepEqual(transitions, [{ id: 'missed', to: 'ended' }]);
  });

  it('never touches drafts or cancelled drops', () => {
    assert.deepEqual(dueDropTransitions([
      { id: 'd', status: 'draft', startsAt: '2026-08-20T14:00:00Z', endsAt: '2026-08-25T14:00:00Z' },
      { id: 'c', status: 'cancelled', startsAt: '2026-08-20T14:00:00Z', endsAt: '2026-08-25T14:00:00Z' },
    ], NOW), []);
  });
});

describe('dueCampaigns', () => {
  it('selects only scheduled campaigns whose time has come', () => {
    assert.deepEqual(dueCampaigns([
      { id: 'go', status: 'scheduled', scheduledAt: '2026-08-22T14:59:00Z' },
      { id: 'wait', status: 'scheduled', scheduledAt: '2026-08-22T15:01:00Z' },
      { id: 'draft', status: 'draft', scheduledAt: '2026-08-22T14:00:00Z' },
      { id: 'working', status: 'sending', scheduledAt: '2026-08-22T14:00:00Z' },
    ], NOW), ['go']);
  });
});
