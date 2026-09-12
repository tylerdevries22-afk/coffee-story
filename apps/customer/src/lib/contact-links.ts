import { Linking } from 'react-native';

/**
 * Opens a `tel:`/`mailto:` URL, matching `openWebPath`'s honesty: throws
 * instead of failing silently, so the caller can tell the guest it didn't
 * work rather than showing a dead tap.
 */
export async function openContactLink(url: string): Promise<void> {
  const supported = await Linking.canOpenURL(url);
  if (!supported) throw new Error('This device cannot open that link.');
  await Linking.openURL(url);
}
