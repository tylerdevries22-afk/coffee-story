'use client';

import * as Sentry from '@sentry/nextjs';
import type { CSSProperties } from 'react';
import { useEffect } from 'react';

import { hqTheme } from '@/lib/theme';

export default function HqGlobalError({ error, reset }: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={hqTheme(null) as CSSProperties}>
        <main className="main">
          <section className="card">
            <h1>HQ needs a moment</h1>
            <p className="subtitle">Your changes are safe. Retry when you are ready.</p>
            <button className="button" type="button" onClick={reset}>Try again</button>
          </section>
        </main>
      </body>
    </html>
  );
}
