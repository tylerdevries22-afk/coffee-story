import { Linking } from 'react-native';

import { currentBusiness } from '@/data/business';
import { resolveWebsiteUrl } from '@platform/domain';

/**
 * Opens a path on the signed-in brand's public website.
 *
 * This used to read the bundled `BUSINESS.website`, so a manager at any other
 * tenant tapping Privacy or Terms in the staff app was sent to Coffee Story's
 * site. One listing serves every tenant (rule 7), so the host has to come from
 * whoever signed in; `currentBusiness()` is what AuthProvider publishes.
 *
 * A brand that has posted no website has nowhere to send them — say so rather
 * than falling back to somebody else's.
 */
export async function openWebPath(path: string): Promise<void> {
  const { website } = currentBusiness();
  if (!website) throw new Error('This shop has not published a website yet.');
  const url = resolveWebsiteUrl(path, website);
  const supported = await Linking.canOpenURL(url);
  if (!supported) throw new Error('This page cannot be opened on this device.');
  await Linking.openURL(url);
}
