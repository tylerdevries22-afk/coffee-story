import type { ReactNode } from 'react';

import './display.css';

/**
 * Storefront screens served by the console.
 *
 * Deliberately the only surface here on the warm light ground rather than the
 * executive dark: a pickup display hangs in the shop, beside the menu boards,
 * and reads as part of the room. It is the same design language -- serif
 * display voice, brass accents, the same semantic family -- expressed for a
 * different room, which is the rule docs/DESIGN.md already sets out for the
 * three app surfaces.
 *
 * No nav, no session chrome, nothing a guest could tap into.
 */
export default function DisplayLayout({ children }: { children: ReactNode }) {
  return <div className="display-root">{children}</div>;
}
