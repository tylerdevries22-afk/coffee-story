import { AppSurfacePreview } from '@/components/apps-preview';
import { appPreviewFor } from '@/lib/app-previews';

export const dynamic = 'force-dynamic';

export default function KioskAppPage() {
  return <AppSurfacePreview preview={appPreviewFor('kiosk')} />;
}
