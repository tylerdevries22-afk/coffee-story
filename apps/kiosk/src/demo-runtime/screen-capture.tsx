/**
 * Anonymous screen views for the prospect-facing demo runtime
 * (EXPO_PUBLIC_DEMO_RUNTIME=1 -- see index.js and boot.ts). Never the tenant
 * pipeline in components/kiosk-telemetry.tsx, which needs a real brand, a
 * device and a tenant privacy policy this runtime has none of: a demo
 * visitor is anonymous by design, and POST /d/events identifies the site
 * server-side, from the same httpOnly cookie /d/pack.json already reads.
 *
 * A normal tenant build never sets EXPO_PUBLIC_DEMO_RUNTIME, so the guard
 * below is always false there and this never calls out to /d/events -- the
 * same runtime gate index.js and boot.ts already use for this exact variable.
 */
import { createDemoScreenReporter, screenKeyFor, sendDemoScreenView } from '@platform/analytics';
import { usePathname } from 'expo-router';
import { useEffect, useMemo } from 'react';

import { SCREENS } from '@/components/kiosk-telemetry';

export function DemoScreenCapture() {
  const pathname = usePathname();
  const reporter = useMemo(() => createDemoScreenReporter((screen) => sendDemoScreenView(screen)), []);

  useEffect(() => {
    if (process.env.EXPO_PUBLIC_DEMO_RUNTIME !== '1') return;
    reporter.report(screenKeyFor(pathname, SCREENS));
  }, [pathname, reporter]);

  return null;
}
