import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type McpOAuthMaterial = {
  readonly nonce: string;
  readonly nonceSha256: string;
  readonly cookieBinding: string;
  readonly cookieBindingSha256: string;
  readonly codeVerifier: string;
  readonly codeChallenge: string;
  readonly state: string;
};

export type McpOAuthState = {
  readonly provider: string;
  readonly nonce: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
};

const PROVIDER = /^[a-z][a-z0-9_-]{1,62}$/;
const TOKEN = /^[A-Za-z0-9_-]{32,100}$/;

export function mcpSha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function mcpOAuthCookieName(provider: string, prefix = 'mcp_oauth'): string {
  if (!PROVIDER.test(provider)) throw new Error('Invalid connector provider key.');
  return `${prefix}_${provider}`;
}

export function createMcpOAuthMaterial(
  provider: string,
  secret: string,
  nowMs = Date.now(),
  ttlMs = 10 * 60_000,
): McpOAuthMaterial {
  if (!PROVIDER.test(provider)) throw new Error('Invalid connector provider key.');
  if (secret.length < 32) throw new Error('Connector OAuth state secret is not configured.');
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 60_000 || ttlMs > 30 * 60_000) {
    throw new Error('Connector OAuth state lifetime is invalid.');
  }
  const nonce = randomBytes(32).toString('base64url');
  const cookieBinding = randomBytes(32).toString('base64url');
  const codeVerifier = randomBytes(48).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  const payload = Buffer.from(JSON.stringify({
    provider, nonce, issuedAt: nowMs, expiresAt: nowMs + ttlMs,
  })).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return {
    nonce, nonceSha256: mcpSha256(nonce), cookieBinding,
    cookieBindingSha256: mcpSha256(cookieBinding), codeVerifier,
    codeChallenge, state: `${payload}.${signature}`,
  };
}

function stateOf(value: unknown): McpOAuthState | null {
  if (!value || typeof value !== 'object') return null;
  const provider = Reflect.get(value, 'provider');
  const nonce = Reflect.get(value, 'nonce');
  const issuedAt = Reflect.get(value, 'issuedAt');
  const expiresAt = Reflect.get(value, 'expiresAt');
  if (typeof provider !== 'string' || !PROVIDER.test(provider)
    || typeof nonce !== 'string' || !TOKEN.test(nonce)
    || typeof issuedAt !== 'number' || !Number.isSafeInteger(issuedAt)
    || typeof expiresAt !== 'number' || !Number.isSafeInteger(expiresAt)) return null;
  return { provider, nonce, issuedAt, expiresAt };
}

export function verifyMcpOAuthState(
  state: string,
  expectedProvider: string,
  secret: string,
  nowMs = Date.now(),
): McpOAuthState | null {
  const [payload, signature, extra] = state.split('.');
  if (!payload || !signature || extra || secret.length < 32) return null;
  const expected = createHmac('sha256', secret).update(payload).digest();
  let supplied: Buffer;
  try { supplied = Buffer.from(signature, 'base64url'); } catch { return null; }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    const parsed = stateOf(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
    if (!parsed || parsed.provider !== expectedProvider || parsed.issuedAt > nowMs
      || parsed.expiresAt <= nowMs) return null;
    return parsed;
  } catch { return null; }
}

export function mcpCookieBindingMatches(value: string, expectedSha256: string): boolean {
  const actual = Buffer.from(mcpSha256(value));
  const expected = Buffer.from(expectedSha256);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
