import { stringAt, type ConnectorToken } from './connector-oauth-exchange';

export function connectorCredentialExpiresWithin(
  credential: ConnectorToken,
  explicitExpiry: string | null,
  now: Date,
  marginMs: number,
): boolean {
  if (explicitExpiry && Number.isFinite(Date.parse(explicitExpiry))) {
    return Date.parse(explicitExpiry) <= now.getTime() + marginMs;
  }
  const acquired = stringAt(credential, 'acquired_at');
  const seconds = Reflect.get(credential, 'expires_in');
  return Boolean(acquired && Number.isFinite(Date.parse(acquired))
    && typeof seconds === 'number' && Number.isSafeInteger(seconds) && seconds > 0
    && Date.parse(acquired) + seconds * 1_000 <= now.getTime() + marginMs);
}
