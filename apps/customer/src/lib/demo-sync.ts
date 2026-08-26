import { createDemoSyncClient } from '@platform/api-client';

export const demoSyncClient = createDemoSyncClient(process.env.EXPO_PUBLIC_DEMO_SYNC_URL, 'app');
export const demoSyncPreview = process.env.EXPO_PUBLIC_PREVIEW_WALL === '1'
  && demoSyncClient !== null;
