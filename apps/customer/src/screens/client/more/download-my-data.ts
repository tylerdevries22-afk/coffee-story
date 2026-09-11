import { Alert, Platform, Share } from 'react-native';

import { mobileApi } from '@/lib/mobile-api';
import { TENANT } from '@/tenant';

/** Guest portability download: web blob save, native share sheet. */
export async function downloadMyData(): Promise<void> {
  const payload = await mobileApi.exportProfile();
  const json = JSON.stringify(payload, null, 2);
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'my-data-export.json';
    anchor.click();
    URL.revokeObjectURL(url);
    Alert.alert('Download started', 'Your data export is downloading as my-data-export.json.');
    return;
  }
  await Share.share({
    message: json,
    title: `My ${TENANT.identity.name} data export`,
  });
}
