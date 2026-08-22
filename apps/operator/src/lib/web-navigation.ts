import { Linking } from 'react-native';

import { BUSINESS } from '@/data/business';
import { resolveWebsiteUrl } from '@/lib/website-url';

/** Opens a path on the brand's public website. */
export async function openWebPath(path: string): Promise<void> {
  const url = resolveWebsiteUrl(path, BUSINESS.website);
  const supported = await Linking.canOpenURL(url);
  if (!supported) throw new Error('This page cannot be opened on this device.');
  await Linking.openURL(url);
}
