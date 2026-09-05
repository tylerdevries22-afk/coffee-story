import { AppsPreviewWall } from '@/components/apps-preview';
import { appPreviewsFor } from '@/lib/app-previews';
import { activeModuleKeys } from '@/lib/capabilities';
import { loadDeviceWall } from '@/lib/device-wall-data';

export const dynamic = 'force-dynamic';

export default async function AppsWallPage() {
  const deviceWall = await loadDeviceWall();
  const modules = await activeModuleKeys(deviceWall.brandId);
  return <AppsPreviewWall constructionOperator={modules.has('construction-projects')} deviceWall={deviceWall} previews={appPreviewsFor()} />;
}
