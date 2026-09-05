import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const helper = readFileSync(join(ROOT, 'apps/hq/lib/connector-oauth-route.ts'), 'utf8');
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
    assert.match(route('authorize'), /await authorizeConnectorOAuth\(request\)/);
    assert.match(route('callback'), /await authorizeConnectorOAuth\(request, false\)/);
  });

  it('binds callbacks to signed state, a private cookie, and a one-time database state', () => {
    const callback = route('callback');
    assert.match(callback, /verifyConnectorState\(/);
    assert.match(callback, /parseConnectorCookie\(/);
    assert.match(callback, /consume_connector_oauth_state/);
    assert.match(callback, /mcpCookieBindingMatches\(/);
  });

  it('uses mutable Next.js redirect responses before setting private cookies', () => {
    for (const name of ['authorize', 'callback'] as const) {
      assert.match(route(name), /import \{ NextResponse \} from 'next\/server'/);
      assert.match(route(name), /NextResponse\.redirect\(/);
      assert.doesNotMatch(route(name), /(^|[^A-Za-z])Response\.redirect\(/);
    }
  });
});
