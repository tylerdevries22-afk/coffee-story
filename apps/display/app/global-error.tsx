'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function DisplayGlobalError({ error, reset }: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main className="display-root display-signpost">
          <h1 className="board-title">The pickup board is reconnecting</h1>
          <p className="board-empty">Orders are still safe. Ask a team member while this screen catches up.</p>
          <button type="button" onClick={reset}>Try again</button>
        </main>
      </body>
    </html>
  );
}
