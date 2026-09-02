import {
  parseDeviceStreamSignal, type DeviceSignalTransport, type DeviceStreamSignal,
} from './stream-protocol';

type BroadcastMessage = { readonly payload?: unknown };
type ChannelStatus = 'SUBSCRIBED' | 'TIMED_OUT' | 'CLOSED' | 'CHANNEL_ERROR' | string;

export type SupabaseSignalChannel = {
  on(type: 'broadcast', filter: { event: 'signal' }, listener: (message: BroadcastMessage) => void): SupabaseSignalChannel;
  subscribe(listener: (status: ChannelStatus) => void): SupabaseSignalChannel;
  send(message: { type: 'broadcast'; event: 'signal'; payload: DeviceStreamSignal }): Promise<string>;
  track(payload: { sessionId: string; connectedAt: string }): Promise<string>;
  untrack(): Promise<unknown>;
};

export type SupabaseSignalClient = {
  channel(name: string, options: {
    config: { private: true; broadcast: { ack: true; self: false }; presence: { key: string } };
  }): SupabaseSignalChannel;
  removeChannel(channel: SupabaseSignalChannel): Promise<unknown>;
};

export type SupabaseSignalTransport = DeviceSignalTransport & {
  readonly close: () => Promise<void>;
};

const CONNECT_TIMEOUT_MS = 10_000;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const SESSION_ID = new RegExp(`^${UUID}$`, 'i');
const CHANNEL = new RegExp(`^device-wall:${UUID}$`, 'i');

export async function createSupabaseSignalTransport(options: {
  readonly client: SupabaseSignalClient;
  readonly channelName: string;
  readonly participantKey: string;
  readonly sessionId: string;
}): Promise<SupabaseSignalTransport> {
  if (!SESSION_ID.test(options.sessionId) || !CHANNEL.test(options.channelName)
      || options.participantKey.length < 1 || options.participantKey.length > 128) {
    throw new Error('Private signaling scope is invalid.');
  }
  const listeners = new Set<(signal: DeviceStreamSignal) => void>();
  const channel = options.client.channel(options.channelName, {
    config: {
      private: true,
      broadcast: { ack: true, self: false },
      presence: { key: options.participantKey },
    },
  });
  channel.on('broadcast', { event: 'signal' }, (message) => {
    const signal = parseDeviceStreamSignal(message.payload);
    if (!signal || signal.sessionId !== options.sessionId) return;
    listeners.forEach((listener) => listener(signal));
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Private signaling timed out.')), CONNECT_TIMEOUT_MS);
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timer);
        resolve();
      } else if (status === 'TIMED_OUT' || status === 'CLOSED' || status === 'CHANNEL_ERROR') {
        clearTimeout(timer);
        reject(new Error('Private signaling is unavailable.'));
      }
    });
  }).catch(async (error: unknown) => {
    await options.client.removeChannel(channel);
    throw error;
  });
  const presence = await channel.track({
    sessionId: options.sessionId, connectedAt: new Date().toISOString(),
  });
  if (presence !== 'ok') {
    await options.client.removeChannel(channel);
    throw new Error('Private presence is unavailable.');
  }
  return {
    async send(signal) {
      if (signal.sessionId !== options.sessionId) throw new Error('Signal session mismatch.');
      if (await channel.send({ type: 'broadcast', event: 'signal', payload: signal }) !== 'ok') {
        throw new Error('Private signaling failed.');
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async close() {
      listeners.clear();
      await channel.untrack();
      await options.client.removeChannel(channel);
    },
  };
}
