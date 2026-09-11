import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { afterEach, before, describe, it } from 'node:test';

import { createMcpOAuthMaterial } from 'franchise-mcp-store-ui/oauth';

type RouteModule = typeof import('./connector-oauth-route');
let route: RouteModule;
const ORIGINAL_SECRET = process.env.CONNECTOR_OAUTH_STATE_SECRET;

before(async () => {
  registerHooks({ resolve(specifier, context, nextResolve) {
    return specifier === 'server-only'
      ? nextResolve(specifier, { ...context, conditions: [...context.conditions, 'react-server'] })
      : nextResolve(specifier, context);
  } });
  route = await import('./connector-oauth-route');
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.CONNECTOR_OAUTH_STATE_SECRET;
  else process.env.CONNECTOR_OAUTH_STATE_SECRET = ORIGINAL_SECRET;
});

describe('connector OAuth signed state and cookie contract', { concurrency: false }, () => {
  it('round-trips a signed nonce through its matching private cookie', () => {
    const secret = 'state-secret-that-is-at-least-thirty-two-bytes';
    process.env.CONNECTOR_OAUTH_STATE_SECRET = secret;
    const material = createMcpOAuthMaterial('slack', secret);
    const operationKey = '11111111-1111-4111-8111-111111111111';
    const name = route.connectorCookieName('slack', material.nonce);
    const encoded = Buffer.from(JSON.stringify({
      binding: material.cookieBinding,
      operationKey,
      verifier: material.codeVerifier,
    })).toString('base64url');
    const request = new Request('https://hq.example.test/callback', {
      headers: { cookie: `${name}=${encodeURIComponent(encoded)}` },
    });
    assert.equal(route.verifyConnectorState(material.state, 'slack')?.nonce, material.nonce);
    assert.deepEqual(route.parseConnectorCookie(request, 'slack', material.nonce), {
      binding: material.cookieBinding, operationKey, verifier: material.codeVerifier,
    });
    assert.equal(route.parseConnectorCookie(request, 'slack', 'newer-nonce'), null);
    assert.equal(route.verifyConnectorState(material.state, 'youtube'), null);
  });
});
