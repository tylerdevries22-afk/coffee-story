/**
 * Sentry for the console, DSN-gated: without SENTRY_DSN this is a no-op and
 * the build stays self-contained.
 */
import { scrubBreadcrumb, scrubEvent } from './lib/sentry-scrub';

export async function register() {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import('@sentry/nextjs');
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0.2,
    // A provider that only documents a GET token endpoint carries its client
    // secret in the query string, and the default undici instrumentation copies
    // the full URL onto every span and breadcrumb. Scrub all three egress paths.
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
    beforeSend: (event) => scrubEvent(event),
    beforeSendTransaction: (event) => scrubEvent(event),
  });
}

export { captureRequestError as onRequestError } from '@sentry/nextjs';
