import { AppsPreviewWall } from '@/components/apps-preview';
import { appPreviewsFor } from '@/lib/app-previews';
import { loadDeviceWall } from '@/lib/device-wall-data';

export const dynamic = 'force-dynamic';

export default async function AppsWallPage() {
  const deviceWall = await loadDeviceWall();
  return <AppsPreviewWall deviceWall={deviceWall} previews={appPreviewsFor()} />;
}
