import { type KioskMenu } from '@platform/domain';
import { createContext } from 'react';

import { demoMenu } from '@/data/menu-source';
import { TENANT_BRAND_CONFIG } from '@/tenant';

export type KioskMenuStatus = 'demo' | 'loading' | 'live' | 'paused' | 'unavailable';

export type KioskMenuValue = {
  menu: KioskMenu;
  status: KioskMenuStatus;
  /** The resolved tenant kiosk flow. Updated through a payload-free signal. */
  kioskConfig: unknown;
  /** Read again now — the retry affordance on the unavailable screen. */
  refresh: () => void;
};

export const DEMO_MENU = demoMenu();

export const MenuContext = createContext<KioskMenuValue>({
  menu: DEMO_MENU,
  status: 'demo',
  kioskConfig: TENANT_BRAND_CONFIG.kiosk,
  refresh: () => {},
});

/** Backoff between failed reads. A kiosk retries all day; it must not spin. */
export const RETRY_MS = [1_000, 4_000, 15_000, 60_000] as const;

export function kioskConfigOf(config: unknown): unknown {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) return null;
  const kiosk = (config as Record<string, unknown>).kiosk;
  return typeof kiosk === 'object' && kiosk !== null && !Array.isArray(kiosk) ? kiosk : null;
}
