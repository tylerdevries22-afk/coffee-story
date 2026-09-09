import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const helper = readFileSync(join(ROOT, 'apps/hq/lib/connector-oauth-route.ts'), 'utf8');
const callbackDependencies = readFileSync(
  join(ROOT, 'apps/hq/lib/connector-oauth-callback-dependencies.ts'), 'utf8',
);
const authorizeDependencies = readFileSync(
  join(ROOT, 'apps/hq/lib/connector-oauth-authorize-dependencies.ts'), 'utf8',
);
const route = (name: 'authorize' | 'callback'): string => readFileSync(
  join(ROOT, `apps/hq/app/api/connectors/[provider]/${name}/route.ts`), 'utf8',
);

describe('connector OAuth route authorization', () => {
  it('authenticates, authorizes an owner, and throttles in one shared boundary', () => {
    assert.match(helper, /rateLimited\(/);
    assert.match(helper, /await currentSession\(\)/);
    assert.match(helper, /hasRole\(session, 'brand_owner'\)/);
  });

  it('requires the shared boundary on authorization and callback routes', () => {
    assert.match(route('authorize'), /await dependencies\.authorize\(request\)/);
    assert.match(route('callback'), /await dependencies\.authorize\(request, false\)/);
    assert.match(callbackDependencies, /authorize: authorizeConnectorOAuth/);
  });

  it('binds callbacks to signed state, a private cookie, and a one-time database state', () => {
    const callback = route('callback');
    assert.match(callback, /dependencies\.verifyState\(/);
    assert.match(callback, /dependencies\.parseCookie\(/);
    assert.match(callback, /dependencies\.consumeState\(/);
    assert.match(callback, /p_cookie_binding_hash: bindingHash/);
    assert.match(callback, /p_consume_key: cookie\.operationKey/);
    assert.match(callback, /dependencies\.startExchange\(/);
    assert.match(callback, /p_processing_lease_token: state\.processing_lease_token/);
    assert.match(callback, /p_exchange_attempt_key: exchangeAttemptKey/);
    assert.match(callback, /completionKey: cookie\.operationKey/);
    assert.match(callbackDependencies, /verifyState: verifyConnectorState/);
    assert.match(callbackDependencies, /parseCookie: parseConnectorCookie/);
    assert.match(callbackDependencies, /'consume_connector_oauth_state'/);
    assert.match(callbackDependencies, /'start_connector_oauth_code_exchange'/);
    assert.match(callbackDependencies, /'cancel_connector_oauth_code_exchange'/);
    assert.doesNotMatch(callbackDependencies, /bindingMatches/);
  });

  it('redirects only for a ready begin result and isolates cookies by nonce', () => {
    const authorize = route('authorize');
    assert.match(authorizeDependencies, /authorize: authorizeConnectorOAuth/);
    assert.match(authorizeDependencies, /'begin_connector_oauth_state'/);
    assert.match(authorize, /outcome === 'revocation_pending'/);
    assert.match(authorize, /outcome !== 'authorization_ready'/);
    assert.match(authorize, /dependencies\.cookieName\(provider, material\.nonce\)/);
    assert.match(authorize, /operationKey: dependencies\.randomUuid\(\)/);
  });

  it('uses mutable Next.js redirect responses before setting private cookies', () => {
    for (const name of ['authorize', 'callback'] as const) {
      assert.match(route(name), /import \{ NextResponse \} from 'next\/server'/);
      assert.match(route(name), /NextResponse\.redirect\(/);
      assert.doesNotMatch(route(name), /(^|[^A-Za-z])Response\.redirect\(/);
    }
  });
});
