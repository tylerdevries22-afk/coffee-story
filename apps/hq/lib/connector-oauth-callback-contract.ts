import type { OAuthConnectorKey } from './connector-oauth-config';
import {
  ConnectorExchangeError,
  type ConnectorToken,
} from './connector-oauth-exchange';
import { ConnectorCompletionError } from './connector-oauth-completion';
import {
  connectorUtf8Bytes,
  isBoundedConnectorCleanupCredential,
  isBoundedConnectorCredential,
  isBoundedConnectorIdentity,
} from './connector-oauth-token-bounds';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MANAGED_EXPIRY = new Set<OAuthConnectorKey>([
  'google-suite', 'youtube', 'quickbooks-online', 'slack', 'tiktok',
]);

export type ConsumedConnectorState = Readonly<{
  state_id: string;
  brand_id: string;
  installation_id: string;
  redirect_uri: string;
  requested_scopes: readonly string[];
  consume_replayed: boolean;
  completion_outcome: 'connected' | 'cleanup_queued' | null;
  completed_reference_id: string | null;
  processing_lease_token: string | null;
  processing_acquired: boolean;
  exchange_started: boolean;
}>;

export class ConnectorScopeError extends Error {
  constructor() {
    super('Connector granted scopes could not be verified.');
    this.name = 'ConnectorScopeError';
  }
}

export class ConnectorAvailabilityError extends Error {
  constructor() {
    super('Connector provider configuration changed during authorization.');
    this.name = 'ConnectorAvailabilityError';
  }
}

export class ConnectorCompensationIntakeError extends Error {
  constructor() {
    super('Connector credential cleanup could not be confirmed.');
    this.name = 'ConnectorCompensationIntakeError';
  }
}

export function connectorTokenExpiryAt(
  provider: OAuthConnectorKey,
  token: Readonly<Record<string, unknown>>,
  now: Date,
): string | null {
  const seconds = Reflect.get(token, 'expires_in');
  const maximum = MANAGED_EXPIRY.has(provider) ? 30 * 24 * 60 * 60 : 90 * 24 * 60 * 60;
  const required = MANAGED_EXPIRY.has(provider) || provider === 'meta-business-suite';
  const valid = typeof seconds === 'number' && Number.isSafeInteger(seconds)
    && seconds > 0 && seconds <= maximum;
  if (!valid) {
    if (required) throw new ConnectorExchangeError('payload', 200, 'invalid token expiry');
    return null;
  }
  return new Date(now.getTime() + seconds * 1_000).toISOString();
}

export function parseConsumedConnectorState(
  value: unknown,
  bindingHash: string,
  operationKey: string,
): ConsumedConnectorState | null {
  if (!value || typeof value !== 'object') return null;
  const stateId = Reflect.get(value, 'state_id');
  const brandId = Reflect.get(value, 'brand_id');
  const installationId = Reflect.get(value, 'installation_id');
  const returnedBinding = Reflect.get(value, 'cookie_binding_hash');
  const returnedKey = Reflect.get(value, 'consume_key');
  const redirectUri = Reflect.get(value, 'redirect_uri');
  const requestedScopes = Reflect.get(value, 'requested_scopes');
  const replayed = Reflect.get(value, 'consume_replayed');
  const outcome = Reflect.get(value, 'completion_outcome');
  const referenceId = Reflect.get(value, 'completed_reference_id');
  const leaseToken = Reflect.get(value, 'processing_lease_token');
  const leaseExpiry = Reflect.get(value, 'processing_lease_expires_at');
  const generation = Reflect.get(value, 'processing_generation');
  const processingAcquired = Reflect.get(value, 'processing_acquired');
  const exchangeStarted = Reflect.get(value, 'exchange_started');
  const scopesValid = Array.isArray(requestedScopes) && requestedScopes.length <= 32
    && requestedScopes.every((scope) => typeof scope === 'string' && scope
      && scope.trim() === scope && connectorUtf8Bytes(scope) <= 512);
  const fresh = replayed === false && outcome === null && referenceId === null;
  const terminalReplay = replayed === true
    && (outcome === 'connected' || outcome === 'cleanup_queued')
    && typeof referenceId === 'string' && UUID.test(referenceId);
  const activeReplay = replayed === true && outcome === null && referenceId === null;
  const terminalProcessing = terminalReplay && leaseToken === null && leaseExpiry === null
    && processingAcquired === false && exchangeStarted === false;
  const activeProcessing = (fresh || activeReplay)
    && typeof leaseToken === 'string' && UUID.test(leaseToken)
    && typeof leaseExpiry === 'string' && Number.isFinite(Date.parse(leaseExpiry))
    && ((typeof generation === 'number' && Number.isSafeInteger(generation) && generation >= 1)
      || (typeof generation === 'string' && /^[1-9][0-9]{0,18}$/u.test(generation)))
    && ((processingAcquired === true && exchangeStarted === false)
      || (activeReplay && processingAcquired === false && exchangeStarted === true));
  return typeof stateId === 'string' && UUID.test(stateId)
    && typeof brandId === 'string' && UUID.test(brandId)
    && typeof installationId === 'string' && UUID.test(installationId)
    && returnedBinding === bindingHash && returnedKey === operationKey
    && typeof redirectUri === 'string' && scopesValid
    && ((terminalReplay && terminalProcessing)
      || ((fresh || activeReplay) && activeProcessing))
    ? {
      state_id: stateId, brand_id: brandId, installation_id: installationId,
      redirect_uri: redirectUri, requested_scopes: requestedScopes as string[],
      consume_replayed: replayed,
      completion_outcome: outcome as 'connected' | 'cleanup_queued' | null,
      completed_reference_id: referenceId as string | null,
      processing_lease_token: leaseToken as string | null,
      processing_acquired: processingAcquired as boolean,
      exchange_started: exchangeStarted as boolean,
    }
    : null;
}

export function boundedConnectorScopes(value: readonly string[] | null): readonly string[] {
  const unique = value ? [...new Set(value)] : null;
  if (!unique || unique.length > 32 || unique.some((scope) =>
    typeof scope !== 'string' || !scope || scope.trim() !== scope
      || connectorUtf8Bytes(scope) > 512)) throw new ConnectorScopeError();
  return unique;
}

export function callbackCredential(
  token: ConnectorToken,
  externalAccountId: string,
  now: Date,
): ConnectorToken {
  if (!isBoundedConnectorIdentity(externalAccountId)) throw new ConnectorScopeError();
  const credential = {
    ...token, external_account_id: externalAccountId, acquired_at: now.toISOString(),
  };
  if (!isBoundedConnectorCredential(credential)) {
    throw new ConnectorExchangeError('payload', 200, 'invalid stored credential contract');
  }
  return credential;
}

export function compensationCredential(
  token: ConnectorToken,
  externalAccountId: string | null,
  now: Date,
): ConnectorToken | null {
  const acquired = { ...token, acquired_at: now.toISOString() };
  const identified = isBoundedConnectorIdentity(externalAccountId)
    ? { ...acquired, external_account_id: externalAccountId }
    : acquired;
  if (isBoundedConnectorCleanupCredential(identified)) return identified;
  return externalAccountId === null && isBoundedConnectorCredential(acquired) ? acquired : null;
}

export function compensationTokenExpiryAt(
  provider: OAuthConnectorKey,
  token: ConnectorToken,
  now: Date,
): string | null {
  try { return connectorTokenExpiryAt(provider, token, now); } catch { return null; }
}

export function connectorCompensationReason(error: unknown): string {
  if (error instanceof ConnectorCompletionError) return error.compensationReason;
  if (error instanceof ConnectorScopeError) return 'scope_verification_failed';
  if (error instanceof ConnectorAvailabilityError) return 'provider_unavailable';
  if (error instanceof ConnectorExchangeError) return `exchange_${error.stage}_failed`;
  return 'callback_verification_failed';
}
