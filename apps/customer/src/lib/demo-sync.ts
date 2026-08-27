import { createDemoSyncClient, resolveDemoSyncRuntimeUrl } from '@platform/api-client';

const demoSyncUrl = resolveDemoSyncRuntimeUrl(process.env.EXPO_PUBLIC_DEMO_SYNC_URL);
export const demoSyncClient = createDemoSyncClient(demoSyncUrl, 'app');
export const demoSyncPreview = process.env.EXPO_PUBLIC_PREVIEW_WALL === '1'
  && demoSyncClient !== null;
