import { createDemoSyncClient } from '@platform/api-client';
export const demoSyncClient = createDemoSyncClient(process.env.EXPO_PUBLIC_DEMO_SYNC_URL, 'kiosk');
export const demoSyncConfigured = demoSyncClient !== null;
export const demoSyncPreview = process.env.EXPO_PUBLIC_PREVIEW_WALL === '1'
  && demoSyncConfigured;
