/**
 * Sentry for the wall, DSN-gated: without SENTRY_DSN this is a no-op and the
 * build stays self-contained (same bargain apps/hq makes).
 *
 * A pickup display is the one surface in this product with no user to report a
 * fault. A guest who sees a blank screen assumes the shop is closed; staff have
 * their backs to it. Until this existed, a board that started failing its reads
 * -- and dutifully degrading, as it is built to -- told nobody at all, and the
 * first report would have been a customer complaint days later.
 */
export async function register() {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import('@sentry/nextjs');
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    // Lower than the console's 0.2: this app serves a handful of screens that
    // each poll every five seconds all day, so a high rate buys nothing but
    // volume. Errors are unsampled regardless.
    tracesSampleRate: 0.05,
  });
}
