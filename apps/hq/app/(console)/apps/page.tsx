import { AppsPreviewWall } from '@/components/apps-preview';
import { appPreviewsFor } from '@/lib/app-previews';

export const dynamic = 'force-dynamic';

export default function AppsWallPage() {
  return <AppsPreviewWall previews={appPreviewsFor()} />;
}
