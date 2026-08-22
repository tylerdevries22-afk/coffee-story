import { Linking } from 'react-native';

import { resolvePortalUrl } from '@/lib/portal-url';

export async function openWebPath(path: string): Promise<void> {
  const url = resolvePortalUrl(path);
  const supported = await Linking.canOpenURL(url);
  if (!supported) throw new Error('This page cannot be opened on this device.');
  await Linking.openURL(url);
}
