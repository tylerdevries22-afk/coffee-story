import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './display.css';

export const metadata: Metadata = {
  title: 'Pickup',
  description: 'Order status for the counter',
};

/**
 * The whole app is one screen.
 *
 * No nav, no session, nothing a guest could tap into -- this hangs on a wall
 * where anyone can reach it. It is the one surface on the warm light ground
 * that is not an app someone holds: docs/DESIGN.md's rule is one language per
 * room, and this room is the shop floor.
 */
export default function DisplayLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="display-root">{children}</div>
      </body>
    </html>
  );
}
