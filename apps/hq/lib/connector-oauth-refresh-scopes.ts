import type { ConnectorToken } from './connector-oauth-exchange';
import type { OAuthConnectorKey } from './connector-oauth-config';
import { ConnectorRefreshError } from './connector-oauth-refresh';
import { connectorUtf8Bytes } from './connector-oauth-token-bounds';

const ROTATING = new Set<OAuthConnectorKey>(['quickbooks-online', 'slack', 'tiktok']);

function invalidScopes(key: OAuthConnectorKey): readonly string[] {
  if (ROTATING.has(key)) return [];
  throw new ConnectorRefreshError('payload', 200, 'payload', true);
}

/** A refresh may narrow an existing grant but can never expand it. */
export function connectorRefreshGrantedScopes(
  key: OAuthConnectorKey,
  token: ConnectorToken,
  previous: readonly string[],
): readonly string[] {
  const raw = Reflect.get(token, 'scope');
  if (raw === undefined || raw === null) return [...previous];
  if (typeof raw !== 'string' || connectorUtf8Bytes(raw) > 16_416) return invalidScopes(key);
  const reported = [...new Set(raw.split(/[\s,]+/u).filter(Boolean))];
  if (reported.length > 32
    || reported.some((scope) => connectorUtf8Bytes(scope) > 512)) return invalidScopes(key);
  const prior = new Set(previous);
  return reported.filter((scope) => prior.has(scope));
}
