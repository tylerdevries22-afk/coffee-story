'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function ConsoleError({ error, reset }: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <section className="card">
      <h1>HQ could not load this page</h1>
      <p className="subtitle">Your data is safe. Retry the page, or sign in again if your session has expired.</p>
      <button type="button" className="button" onClick={reset}>Retry</button>
      <a className="button secondary" href="/login">Sign in again</a>
    </section>
  );
}
