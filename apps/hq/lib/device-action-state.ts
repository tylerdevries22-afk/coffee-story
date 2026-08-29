/**
 * What the console shows after a device action.
 *
 * A pairing code and a refresh secret are each returned exactly once -- only
 * their HMAC is stored -- so they come back through the action's return value
 * and are rendered by the client component that called it. Deliberately NOT a
 * redirect with a query string: a secret in a URL lands in browser history, in
 * the referrer of every subsequent request, and in any proxy log in between.
 *
 * Separate from actions.ts because a `'use server'` file may export only async
 * functions, and `IDLE` is a value the client component holds.
 */
export type DeviceActionState =
  | { kind: 'idle' }
  | { kind: 'error'; message: string }
  | { kind: 'paired'; deviceId: string; code: string; expiresAt: string }
  | { kind: 'secret'; deviceId: string; secret: string; previousExpiresAt: string | null }
  | { kind: 'revoked'; deviceId: string };

export const IDLE: DeviceActionState = { kind: 'idle' };
