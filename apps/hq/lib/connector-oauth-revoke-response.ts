import type { OAuthConnectorKey } from './connector-oauth-config';
import { objectAt, stringAt } from './connector-oauth-exchange';
import {
  cancelConnectorResponse,
  readBoundedConnectorResponse,
} from './connector-oauth-response';

const MAX_RESPONSE_BYTES = 16_384;
class InvalidRevocationPayloadError extends Error {}

export type ConnectorRevocationResult = Readonly<{
  revoked: boolean;
  retryable: boolean;
  code: 'revoked' | 'already_gone' | 'configuration_unavailable'
    | 'credential_invalid' | 'provider_rejected' | 'transport';
}>;

function result(
  code: ConnectorRevocationResult['code'],
  revoked = false,
  retryable = false,
): ConnectorRevocationResult {
  return { revoked, retryable, code };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await readBoundedConnectorResponse(response, MAX_RESPONSE_BYTES, () =>
    new InvalidRevocationPayloadError());
  if (!text) return null;
  try { return JSON.parse(text) as unknown; } catch {
    throw new InvalidRevocationPayloadError();
  }
}

function safeProviderCode(payload: unknown): string | null {
  const nested = objectAt(payload, 'error');
  const raw = stringAt(payload, 'error') ?? stringAt(payload, 'error_code')
    ?? stringAt(nested, 'code') ?? Reflect.get(nested ?? {}, 'code');
  return (typeof raw === 'number' && Number.isSafeInteger(raw) ? String(raw) : raw)
    ?.trim().toLowerCase().replace(/[\s-]+/gu, '_') ?? null;
}

function rejectedResult(key: OAuthConnectorKey, payload: unknown): ConnectorRevocationResult {
  const code = safeProviderCode(payload) ?? '';
  const googleGone = (key === 'google-suite' || key === 'youtube') && code === 'invalid_token';
  const providerGone = (key === 'quickbooks-online'
      && ['already_revoked', 'already_disconnected'].includes(code))
    || (key === 'stripe' && [
      'account_invalid', 'account_not_found', 'already_deauthorized', 'resource_missing',
    ].includes(code));
  if (googleGone || providerGone
    || ['already_revoked', 'already_uninstalled', 'app_not_installed'].includes(code)) {
    return result('already_gone', true);
  }
  if (key === 'slack' && [
    'ratelimited', 'request_timeout', 'service_unavailable', 'internal_error', 'fatal_error',
  ].includes(code)) return result('provider_rejected', false, true);
  if ((key === 'slack' || key === 'tiktok') && [
    'invalid_auth', 'not_authed', 'token_expired', 'token_revoked',
    'access_token_invalid', 'invalid_token',
  ].includes(code)) {
    return result('credential_invalid', false, key === 'slack' && code === 'invalid_auth');
  }
  if (key === 'meta-business-suite' && code === '190') return result('credential_invalid');
  return result('provider_rejected');
}

export async function connectorRevocationResponse(
  key: OAuthConnectorKey,
  response: Response,
  expectedAccountId?: string,
): Promise<ConnectorRevocationResult> {
  if (key === 'google-suite' || key === 'youtube' || key === 'quickbooks-online') {
    if (response.status === 200) {
      await cancelConnectorResponse(response);
      return result('revoked', true);
    }
    try { return rejectedResult(key, await readJson(response)); } catch (error) {
      if (error instanceof InvalidRevocationPayloadError) {
        return response.ok ? result('transport', false, true) : result('provider_rejected');
      }
      throw error;
    }
  }
  let payload: unknown;
  try { payload = await readJson(response); } catch (error) {
    if (error instanceof InvalidRevocationPayloadError) {
      return response.ok ? result('transport', false, true) : result('provider_rejected');
    }
    throw error;
  }
  if (key === 'stripe') {
    const returnedAccountId = stringAt(payload, 'stripe_user_id');
    if (response.ok && expectedAccountId && returnedAccountId === expectedAccountId) {
      return result('revoked', true);
    }
    if (response.ok && !returnedAccountId) return result('transport', false, true);
    return rejectedResult(key, payload);
  }
  if (key === 'slack' && response.ok && payload && typeof payload === 'object'
    && Reflect.get(payload, 'ok') === true) {
    return result('revoked', true);
  }
  if (key === 'meta-business-suite' && response.ok && payload && typeof payload === 'object'
    && Reflect.get(payload, 'success') === true) return result('revoked', true);
  if (key === 'tiktok' && response.ok && payload === null) return result('revoked', true);
  if (response.ok && safeProviderCode(payload) === null) return result('transport', false, true);
  return rejectedResult(key, payload);
}
