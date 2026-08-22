/**
 * Keep custom-scheme intent URLs inside the app shell. Expo Router otherwise
 * interprets `coffeestory://book` as a route host and renders its unmatched
 * route before AppStateProvider's Linking listener can select the destination.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return path.startsWith('coffeestory://') ? '/' : path;
}
