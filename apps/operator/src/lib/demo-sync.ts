import { createDemoSyncClient } from '@platform/api-client';

export const demoSyncClient = createDemoSyncClient(process.env.EXPO_PUBLIC_DEMO_SYNC_URL, 'pos');
export const demoSyncPreview = process.env.EXPO_PUBLIC_PREVIEW_WALL === '1'
  && demoSyncClient !== null;

/** Broker state belongs only to the explicit local demo plane. */
export function demoSyncEnabled(
  isDemo: boolean,
  configured = demoSyncClient !== null,
): boolean {
  return isDemo && configured;
}
