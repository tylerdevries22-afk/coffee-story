import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import {
  connectorCredentialEnvKeys,
  visibleCredentialEnvKeys,
  ConnectorExchangeError,
  connectorAuthorizationUrl,
  connectorProviderReady,
  exchangeConnectorCode,
  isOAuthConnectorKey,
  resolveGrantedScopes,
  verifyConnectorIdentity,
} from './connector-oauth-providers';

const ENV = [
  'META_APP_ID', 'META_APP_SECRET',
  'STRIPE_CONNECT_CLIENT_ID', 'STRIPE_SECRET_KEY',
  'SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET',
  'QUICKBOOKS_CLIENT_ID', 'QUICKBOOKS_CLIENT_SECRET',
  'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET',
  'YOUTUBE_OAUTH_CLIENT_ID', 'YOUTUBE_OAUTH_CLIENT_SECRET',
  'TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET',
] as const;
const ORIGINAL = Object.fromEntries(ENV.map((name) => [name, process.env[name]]));

function configure(): void {
  process.env.META_APP_ID = 'meta-app';
  process.env.META_APP_SECRET = 'meta-secret';
  process.env.YOUTUBE_OAUTH_CLIENT_ID = 'youtube-client';
  process.env.YOUTUBE_OAUTH_CLIENT_SECRET = 'youtube-secret';
  process.env.TIKTOK_CLIENT_KEY = 'tiktok-key';
  process.env.TIKTOK_CLIENT_SECRET = 'tiktok-secret';
}

afterEach(() => {
  mock.restoreAll();
  for (const name of ENV) {
    const original = ORIGINAL[name];
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  }
});

describe('publishing and social OAuth providers', { concurrency: false }, () => {
  it('shows deployment secret names only to an organization owner', () => {
    // These names are operator reconnaissance, so the gate is asserted here rather
    // than left inline in a server component where inverting it is a green build.
    assert.deepEqual(
      visibleCredentialEnvKeys('meta-business-suite', { isOrganizationOwner: true }),
      ['META_APP_ID', 'META_APP_SECRET'],
    );
    for (const viewer of [null, { isOrganizationOwner: false }]) {
      assert.deepEqual(
        visibleCredentialEnvKeys('meta-business-suite', viewer), [],
        'a non-owner sees nothing',
      );
    }
  });

  it('lists env names only for providers whose adapter reads them', () => {
    for (const key of ['meta-business-suite', 'youtube', 'tiktok', 'square']) {
      assert.ok(
        connectorCredentialEnvKeys(key).length > 0, `${key} is wired and needs secrets`,
      );
    }
    for (const key of ['transistor', 'beehiiv', 'supabase', 'vercel', 'sentry',
      'kindle-direct-publishing', 'acx-audiobooks', 'github']) {
      assert.deepEqual(
        connectorCredentialEnvKeys(key), [],
        `${key} has no adapter reading an environment variable`,
      );
    }
  });

  it('registers the three new providers as OAuth connector keys', () => {
    for (const key of ['meta-business-suite', 'youtube', 'tiktok']) {
      assert.ok(isOAuthConnectorKey(key), `${key} should be an OAuth key`);
    }
  });

  it('reports every new provider unconfigured until both secrets are present', () => {
    for (const key of ['meta-business-suite', 'youtube', 'tiktok'] as const) {
      assert.equal(connectorProviderReady(key), false, `${key} must fail closed`);
    }
    configure();
    for (const key of ['meta-business-suite', 'youtube', 'tiktok'] as const) {
      assert.equal(connectorProviderReady(key), true);
    }
  });

  it('names TikTok client_key, not client_id, and comma-separates its scopes', () => {
    configure();
    const url = connectorAuthorizationUrl(
      'tiktok', 'signed-state', 'challenge',
      'https://hq.example.com/api/connectors/tiktok/callback',
    );

    assert.equal(url?.origin, 'https://www.tiktok.com');
    assert.equal(url?.pathname, '/v2/auth/authorize/');
    assert.equal(url?.searchParams.get('client_key'), 'tiktok-key');
    assert.equal(url?.searchParams.get('client_id'), null);
    assert.equal(url?.searchParams.get('code_challenge_method'), 'S256');
    assert.match(url?.searchParams.get('scope') ?? '', /^user\.info\.basic,/);
  });

  it('builds a versioned Meta dialog without PKCE parameters it ignores', () => {
    configure();
    const url = connectorAuthorizationUrl(
      'meta-business-suite', 'signed-state', 'challenge',
      'https://hq.example.com/api/connectors/meta-business-suite/callback',
    );

    assert.equal(url?.origin, 'https://www.facebook.com');
    assert.equal(url?.pathname, '/v25.0/dialog/oauth');
    assert.equal(url?.searchParams.get('client_id'), 'meta-app');
    assert.equal(url?.searchParams.get('code_challenge'), null);
    assert.match(url?.searchParams.get('scope') ?? '', /business_management/);
  });

  it('asks Google for offline YouTube scopes so refresh tokens arrive', () => {
    configure();
    const url = connectorAuthorizationUrl(
      'youtube', 'signed-state', 'challenge',
      'https://hq.example.com/api/connectors/youtube/callback',
    );

    assert.equal(url?.origin, 'https://accounts.google.com');
    assert.equal(url?.searchParams.get('access_type'), 'offline');
    assert.match(url?.searchParams.get('scope') ?? '', /youtube\.upload/);
    assert.match(url?.searchParams.get('scope') ?? '', /yt-analytics\.readonly/);
  });

  it('exchanges the Meta code over GET, the only method its endpoint documents', async () => {
    configure();
    const fetchMock = mock.method(globalThis, 'fetch', async () =>
      Response.json({ access_token: 'meta-token', expires_in: 5_184_000 }));

    const token = await exchangeConnectorCode(
      'meta-business-suite', 'one-time-code', 'v'.repeat(43),
      'https://hq.example.com/api/connectors/meta-business-suite/callback',
    );

    assert.equal(token.access_token, 'meta-token');
    const [target, init] = fetchMock.mock.calls[0]?.arguments ?? [];
    assert.equal((init as RequestInit | undefined)?.method, undefined);
    assert.match(String(target), /^https:\/\/graph\.facebook\.com\/v25\.0\/oauth\/access_token\?/);
    assert.match(String(target), /client_secret=meta-secret/);
  });

  it('never replays a single-use authorization code, whatever the method', async () => {
    configure();
    // Meta's endpoint is a GET, which a retry-aware fetch would treat as safe.
    // A replay burns the code and forces the owner back through consent.
    for (const key of ['meta-business-suite', 'tiktok'] as const) {
      mock.restoreAll();
      const fetchMock = mock.method(globalThis, 'fetch', async () =>
        new Response('{}', { status: 502 }));
      await assert.rejects(
        exchangeConnectorCode(key, 'one-time-code', 'v'.repeat(43), 'https://hq.example.com/cb'),
        ConnectorExchangeError,
      );
      assert.equal(fetchMock.mock.callCount(), 1, `${key} must be attempted exactly once`);
    }
  });

  it('names the failing stage without leaking the code or the secret', async () => {
    configure();
    mock.method(globalThis, 'fetch', async () => new Response('<html>throttled</html>', {
      status: 429, headers: { 'content-type': 'text/html' },
    }));
    await assert.rejects(
      exchangeConnectorCode('tiktok', 'one-time-code', 'v'.repeat(43), 'https://hq.example.com/cb'),
      (error: unknown) => {
        assert.ok(error instanceof ConnectorExchangeError);
        assert.equal(error.stage, 'payload');
        assert.equal(error.status, 429);
        assert.ok(!error.message.includes('one-time-code'));
        assert.ok(!error.message.includes('tiktok-secret'));
        return true;
      },
    );
  });

  it('reports the provider error text on a rejected exchange', async () => {
    configure();
    mock.method(globalThis, 'fetch', async () => Response.json(
      { error: 'invalid_client', error_description: 'client secret mismatch' }, { status: 400 },
    ));
    await assert.rejects(
      exchangeConnectorCode('youtube', 'one-time-code', 'v'.repeat(43), 'https://hq.example.com/cb'),
      (error: unknown) => {
        assert.ok(error instanceof ConnectorExchangeError);
        assert.equal(error.stage, 'provider');
        assert.match(error.message, /client secret mismatch/u);
        return true;
      },
    );
  });

  it('asks Meta which permissions were actually granted, not which were requested', async () => {
    configure();
    // Meta sends no `scope` field and lets a user decline individual permissions,
    // so the requested list would record consent that never happened.
    mock.method(globalThis, 'fetch', async () => Response.json({ data: [
      { permission: 'pages_show_list', status: 'granted' },
      { permission: 'ads_read', status: 'declined' },
      { permission: 'read_insights', status: 'granted' },
    ] }));

    const granted = await resolveGrantedScopes('meta-business-suite', { access_token: 'meta-token' });
    assert.ok(granted, 'the permissions call answered, so this is a known grant');
    assert.deepEqual([...granted].sort(), ['pages_show_list', 'read_insights']);
    assert.ok(!granted.includes('ads_read'), 'a declined permission must not be recorded');
  });

  it('reports an unknown grant, not an empty one, when Meta cannot be asked', async () => {
    configure();
    mock.method(globalThis, 'fetch', async () => new Response('nope', { status: 500 }));
    // null and [] must stay distinct: one is "we could not tell", the other is a
    // real answer. The callback refuses to store an installation on null.
    assert.equal(await resolveGrantedScopes('meta-business-suite', { access_token: 't' }), null);
  });

  it('distinguishes a genuinely empty Meta grant from an unreachable one', async () => {
    configure();
    mock.method(globalThis, 'fetch', async () => Response.json({ data: [] }));
    assert.deepEqual(await resolveGrantedScopes('meta-business-suite', { access_token: 't' }), []);
  });

  it('never assumes the requested list for a provider that normally reports scope', async () => {
    configure();
    const fetchMock = mock.method(globalThis, 'fetch', async () => Response.json({}));
    // These providers return `scope` and let a user decline part of it, so an
    // absent field is anomalous. Assuming the request would record declined
    // consent for TikTok and Slack exactly as it would for Meta.
    for (const key of ['tiktok', 'slack', 'youtube', 'stripe', 'google-suite'] as const) {
      assert.equal(
        await resolveGrantedScopes(key, { access_token: 't' }), null,
        `${key} must not assume its requested scopes were granted`,
      );
    }
    assert.equal(fetchMock.mock.callCount(), 0, 'and must not call out to find out');
  });

  it('accepts the requested list for a provider that omits scope by design', async () => {
    process.env.QUICKBOOKS_CLIENT_ID = 'qb-client';
    process.env.QUICKBOOKS_CLIENT_SECRET = 'qb-secret';
    const fetchMock = mock.method(globalThis, 'fetch', async () => Response.json({}));
    // Intuit's token response carries no `scope`, and RFC 6749 section 5.1 defines
    // that as "identical to the scope requested". Treating it as unknown would make
    // QuickBooks impossible to connect at all.
    assert.deepEqual(
      await resolveGrantedScopes('quickbooks-online', { access_token: 'qb-token' }),
      ['com.intuit.quickbooks.accounting'],
    );
    assert.equal(fetchMock.mock.callCount(), 0, 'no verification call is needed');
  });

  it('still prefers a reported scope over the requested list', async () => {
    process.env.QUICKBOOKS_CLIENT_ID = 'qb-client';
    process.env.QUICKBOOKS_CLIENT_SECRET = 'qb-secret';
    assert.deepEqual(
      await resolveGrantedScopes('quickbooks-online',
        { access_token: 't', scope: 'com.intuit.quickbooks.accounting' }),
      ['com.intuit.quickbooks.accounting'],
    );
  });

  it('trusts a reported scope string when the provider sends one', async () => {
    configure();
    const fetchMock = mock.method(globalThis, 'fetch', async () => Response.json({ data: [] }));
    assert.deepEqual(
      await resolveGrantedScopes('meta-business-suite',
        { access_token: 't', scope: 'pages_show_list,ads_read' }),
      ['pages_show_list', 'ads_read'],
    );
    assert.equal(fetchMock.mock.callCount(), 0, 'no extra call when the token reports scopes');
  });

  it('bounds a provider-supplied account label before it reaches storage', async () => {
    mock.method(globalThis, 'fetch', async () => Response.json({
      id: '10000000000', name: `  ${'n'.repeat(4_000)}  `,
    }));
    const identity = await verifyConnectorIdentity(
      'meta-business-suite', { access_token: 'access-token' }, null,
    );
    assert.equal(identity.accountLabel.length, 160, 'the label is capped to its column width');
    assert.equal(identity.accountLabel.trim(), identity.accountLabel, 'and trimmed');
  });

  it('collapses whitespace a provider used to pad an account label', async () => {
    mock.method(globalThis, 'fetch', async () => Response.json({
      id: 'acct_1', display_name: '\n\n  Coffee   Story \t',
    }));
    assert.deepEqual(
      await verifyConnectorIdentity('stripe', { access_token: 'access-token' }, null),
      { accountId: 'acct_1', accountLabel: 'Coffee Story' },
    );
  });

  it('accepts the TikTok token whether it is nested under data or not', async () => {
    configure();
    mock.method(globalThis, 'fetch', async () =>
      Response.json({ data: { access_token: 'tiktok-token', open_id: 'creator-1' } }));

    const token = await exchangeConnectorCode(
      'tiktok', 'one-time-code', 'v'.repeat(43),
      'https://hq.example.com/api/connectors/tiktok/callback',
    );
    assert.equal(token.access_token, 'tiktok-token');
  });

  it('identifies the YouTube channel rather than the signed-in person', async () => {
    mock.method(globalThis, 'fetch', async () => Response.json({
      items: [{ id: 'UC_channel', snippet: { title: 'Coffee Story' } }],
    }));
    assert.deepEqual(
      await verifyConnectorIdentity('youtube', { access_token: 'access-token' }, null),
      { accountId: 'UC_channel', accountLabel: 'Coffee Story' },
    );
  });

  it('identifies a TikTok creator from the nested user payload', async () => {
    mock.method(globalThis, 'fetch', async () => Response.json({
      data: { user: { open_id: 'creator-1', display_name: 'Coffee Story' } },
    }));
    assert.deepEqual(
      await verifyConnectorIdentity('tiktok', { access_token: 'access-token' }, null),
      { accountId: 'creator-1', accountLabel: 'Coffee Story' },
    );
  });

  it('identifies the Meta business user behind the grant', async () => {
    mock.method(globalThis, 'fetch', async () =>
      Response.json({ id: '10000000000', name: 'Coffee Story HQ' }));
    assert.deepEqual(
      await verifyConnectorIdentity('meta-business-suite', { access_token: 'access-token' }, null),
      { accountId: '10000000000', accountLabel: 'Coffee Story HQ' },
    );
  });

  it('names a Stripe account by display name, falling back to its id', async () => {
    mock.method(globalThis, 'fetch', async () =>
      Response.json({ id: 'acct_1', display_name: 'Coffee Story' }));
    assert.deepEqual(
      await verifyConnectorIdentity('stripe', { access_token: 'access-token' }, null),
      { accountId: 'acct_1', accountLabel: 'Coffee Story' },
    );

    mock.restoreAll();
    mock.method(globalThis, 'fetch', async () => Response.json({ id: 'acct_2' }));
    assert.deepEqual(
      await verifyConnectorIdentity('stripe', { access_token: 'access-token' }, null),
      { accountId: 'acct_2', accountLabel: 'acct_2' },
    );
  });

  it('trusts a Slack identity only when the payload reports ok', async () => {
    mock.method(globalThis, 'fetch', async () =>
      Response.json({ ok: true, team_id: 'T1', team: 'Coffee Story' }));
    assert.deepEqual(
      await verifyConnectorIdentity('slack', { access_token: 'access-token' }, null),
      { accountId: 'T1', accountLabel: 'Coffee Story' },
    );

    mock.restoreAll();
    mock.method(globalThis, 'fetch', async () =>
      Response.json({ ok: false, team_id: 'T1', team: 'Coffee Story' }));
    await assert.rejects(
      verifyConnectorIdentity('slack', { access_token: 'access-token' }, null),
      /identity verification failed/i,
    );
  });

  it('rejects a QuickBooks realm id that is not a plain numeric string', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', async () => Response.json({}));
    await assert.rejects(
      verifyConnectorIdentity('quickbooks-online', { access_token: 'access-token' }, '9341; drop'),
      /identity verification failed/i,
    );
    assert.equal(fetchMock.mock.callCount(), 0, 'a bad realm id must never be dialled');
  });

  it('signs the Stripe token exchange with Basic auth, never a form secret', async () => {
    process.env.STRIPE_CONNECT_CLIENT_ID = 'ca_client';
    process.env.STRIPE_SECRET_KEY = 'sk_secret';
    const fetchMock = mock.method(globalThis, 'fetch', async () =>
      Response.json({ access_token: 'stripe-token' }));

    await exchangeConnectorCode(
      'stripe', 'one-time-code', 'v'.repeat(43),
      'https://hq.example.com/api/connectors/stripe/callback',
    );

    const [, init] = fetchMock.mock.calls[0]?.arguments ?? [];
    const headers = (init as RequestInit | undefined)?.headers as Record<string, string>;
    assert.equal(headers.Authorization, `Basic ${Buffer.from('sk_secret:').toString('base64')}`);
    const body = String((init as RequestInit | undefined)?.body);
    assert.ok(!body.includes('client_secret'), 'the secret must not also travel in the body');
  });

  it('rejects a grant whose identity call returns no usable account', async () => {
    mock.method(globalThis, 'fetch', async () => Response.json({ items: [] }));
    await assert.rejects(
      verifyConnectorIdentity('youtube', { access_token: 'access-token' }, null),
      /identity verification failed/i,
    );
  });
});
