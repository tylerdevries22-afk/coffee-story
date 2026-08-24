/**
 * Sentry for the console, DSN-gated: without SENTRY_DSN this is a no-op and
 * the build stays self-contained.
 */
export async function register() {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import('@sentry/nextjs');
  Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0.2 });
}

export { captureRequestError as onRequestError } from '@sentry/nextjs';
