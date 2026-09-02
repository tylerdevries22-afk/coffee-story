import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createSupabaseSignalTransport, type SupabaseSignalChannel, type SupabaseSignalClient,
} from './supabase-transport';
import type { DeviceStreamSignal } from './stream-protocol';

const SESSION = '123e4567-e89b-42d3-a456-426614174000';
const INSTALLATION = '123e4567-e89b-42d3-a456-426614174001';

class Channel implements SupabaseSignalChannel {
  listener: ((message: { payload?: unknown }) => void) | null = null;
  sent: DeviceStreamSignal[] = [];
  on(_type: 'broadcast', _filter: { event: 'signal' }, listener: (message: { payload?: unknown }) => void) {
    this.listener = listener;
    return this;
  }
  subscribe(listener: (status: string) => void) { listener('SUBSCRIBED'); return this; }
  async send(message: { payload: DeviceStreamSignal }) { this.sent.push(message.payload); return 'ok'; }
  async track() { return 'ok'; }
  async untrack() { return 'ok'; }
}

class Client implements SupabaseSignalClient {
  readonly channelInstance = new Channel();
  removed = false;
  channel() { return this.channelInstance; }
  async removeChannel() { this.removed = true; return 'ok'; }
}

describe('private Supabase signal transport', () => {
  it('accepts only its authorized session and closes presence cleanly', async () => {
    const client = new Client();
    const transport = await createSupabaseSignalTransport({
      client, channelName: `device-wall:${INSTALLATION}`,
      participantKey: 'viewer', sessionId: SESSION,
    });
    const received: DeviceStreamSignal[] = [];
    transport.subscribe((signal) => received.push(signal));
    client.channelInstance.listener?.({ payload: { sessionId: 'wrong', kind: 'stop' } });
    client.channelInstance.listener?.({ payload: { sessionId: SESSION, kind: 'stop' } });
    assert.deepEqual(received, [{ sessionId: SESSION, kind: 'stop' }]);
    await transport.send({ sessionId: SESSION, kind: 'denied' });
    assert.equal(client.channelInstance.sent.length, 1);
    await transport.close();
    assert.equal(client.removed, true);
  });

  it('rejects malformed channels before connecting', async () => {
    await assert.rejects(() => createSupabaseSignalTransport({
      client: new Client(), channelName: 'public:anything',
      participantKey: 'viewer', sessionId: SESSION,
    }), /scope is invalid/);
  });
});
