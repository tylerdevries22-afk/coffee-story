import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: 'HQ',
  description: 'Multi-tenant ordering platform console',
};

/**
 * The document only. Every surface this app serves shares html/body and the
 * token sheet; what wraps the content is the route group's business, because
 * the console and the pickup display are not the same kind of screen.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
