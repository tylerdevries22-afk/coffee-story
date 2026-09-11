'use client';

import { useEffect, useState } from 'react';

/** Bottom inset from the visual viewport (mobile keyboard). */
export function useVisualViewportBottom(): number {
  const [bottom, setBottom] = useState(0);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const sync = () => {
      const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      setBottom(inset);
    };
    sync();
    viewport.addEventListener('resize', sync);
    viewport.addEventListener('scroll', sync);
    return () => {
      viewport.removeEventListener('resize', sync);
      viewport.removeEventListener('scroll', sync);
    };
  }, []);
  return bottom;
}
