import { createDemoSyncClient, resolveDemoSyncRuntimeUrl } from '@platform/api-client';

const demoSyncUrl = resolveDemoSyncRuntimeUrl(process.env.EXPO_PUBLIC_DEMO_SYNC_URL);
export const demoSyncClient = createDemoSyncClient(demoSyncUrl, 'pos');
export const demoSyncPreview = process.env.EXPO_PUBLIC_PREVIEW_WALL === '1'
  && demoSyncClient !== null;

/** Broker state belongs only to the explicit local demo plane. */
export function demoSyncEnabled(
  isDemo: boolean,
  configured = demoSyncClient !== null,
): boolean {
  return isDemo && configured;
}
