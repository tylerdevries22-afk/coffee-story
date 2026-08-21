import { Redirect } from 'expo-router';

/**
 * `/client` itself matches no screen -- `NativeTabs`/`Tabs` need a real leaf
 * route selected, they don't default to the first trigger for the bare group
 * path. `app/index.tsx` redirects here after the auth gate; this immediately
 * redirects on into the first tab.
 */
export default function ClientIndexRoute() {
  return <Redirect href="/client/home" />;
}
