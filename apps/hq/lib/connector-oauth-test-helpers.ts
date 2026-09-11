export const OAUTH_ENV = [
  'META_APP_ID', 'META_APP_SECRET',
  'STRIPE_CONNECT_CLIENT_ID', 'STRIPE_SECRET_KEY',
  'SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET', 'SLACK_TOKEN_ROTATION_ENABLED',
  'QUICKBOOKS_CLIENT_ID', 'QUICKBOOKS_CLIENT_SECRET', 'QUICKBOOKS_ENV',
  'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET',
  'GOOGLE_OAUTH_PROJECT_NUMBER',
  'YOUTUBE_OAUTH_CLIENT_ID', 'YOUTUBE_OAUTH_CLIENT_SECRET',
  'TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET',
] as const;

const ORIGINAL = Object.fromEntries(OAUTH_ENV.map((name) => [name, process.env[name]]));

export function configureOauthTestEnv(): void {
  process.env.META_APP_ID = 'meta-app';
  process.env.META_APP_SECRET = 'meta-secret';
  process.env.YOUTUBE_OAUTH_CLIENT_ID = '123456789-youtube.apps.googleusercontent.com';
  process.env.YOUTUBE_OAUTH_CLIENT_SECRET = 'youtube-secret';
  process.env.TIKTOK_CLIENT_KEY = 'tiktok-key';
  process.env.TIKTOK_CLIENT_SECRET = 'tiktok-secret';
  process.env.GOOGLE_OAUTH_CLIENT_ID = '123456789-google.apps.googleusercontent.com';
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'google-secret';
  process.env.GOOGLE_OAUTH_PROJECT_NUMBER = '123456789';
  process.env.SLACK_CLIENT_ID = 'slack-client';
  process.env.SLACK_CLIENT_SECRET = 'slack-secret';
  process.env.SLACK_TOKEN_ROTATION_ENABLED = 'true';
  process.env.QUICKBOOKS_CLIENT_ID = 'quickbooks-client';
  process.env.QUICKBOOKS_CLIENT_SECRET = 'quickbooks-secret';
  process.env.QUICKBOOKS_ENV = 'sandbox';
  process.env.STRIPE_CONNECT_CLIENT_ID = 'stripe-client';
  process.env.STRIPE_SECRET_KEY = 'stripe-secret';
}

export function restoreOauthTestEnv(): void {
  for (const name of OAUTH_ENV) {
    const original = ORIGINAL[name];
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  }
}

export function stalledJsonResponse(signal?: AbortSignal | null): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"partial":'));
      const fail = () => controller.error(new DOMException('aborted', 'AbortError'));
      if (signal?.aborted) fail();
      else signal?.addEventListener('abort', fail, { once: true });
    },
  });
  return new Response(body, { headers: { 'content-type': 'application/json' } });
}

export function oversizedJsonResponse(): Response {
  return new Response('{"ok":true}', {
    headers: { 'content-length': '262145', 'content-type': 'application/json' },
  });
}
