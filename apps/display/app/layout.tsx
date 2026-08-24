import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import './display.css';

export const metadata: Metadata = {
  title: 'Pickup',
  description: 'Order status for the counter',
  // A wall screen must never end up in a search index: the board carries
  // guest names, meant for the room they are standing in.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The board is sized to its screen and there is nothing to pinch into.
  maximumScale: 1,
  themeColor: '#000000',
};

/**
 * The whole app is one screen.
 *
 * No nav, no session, nothing a guest could tap into -- this hangs on a wall
 * where anyone can reach it. It is the one surface on the warm light ground
 * that is not an app someone holds: docs/DESIGN.md's rule is one language per
 * room, and this room is the shop floor.
 *
 * The ground itself is painted per page rather than here, because the palette
 * belongs to whichever brand owns the location on the URL (rule 4) and the
 * layout does not know which that is.
 */
export default function DisplayLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
