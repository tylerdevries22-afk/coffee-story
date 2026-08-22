import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * Deep link target: coffeestory://drops/<id> (and the web /drops/<id>).
 * Lands on the archive, which shows the drop it names -- the archive lists
 * every past and live drop, so a stale link still resolves to something true.
 */
export default function DropDeepLink() {
  useLocalSearchParams<{ id: string }>();
  return <Redirect href="/client/more/drops" />;
}
