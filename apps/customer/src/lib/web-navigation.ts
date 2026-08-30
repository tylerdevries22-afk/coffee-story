import { Linking } from 'react-native';

import { resolveWebsiteUrl } from '@platform/domain';
import { TENANT } from '@/tenant';

/** Opens a path on the brand's public website (tenant config). */
export async function openWebPath(path: string): Promise<void> {
  const url = resolveWebsiteUrl(path, TENANT.business.website);
  const supported = await Linking.canOpenURL(url);
  if (!supported) throw new Error('This page cannot be opened on this device.');
  await Linking.openURL(url);
}
