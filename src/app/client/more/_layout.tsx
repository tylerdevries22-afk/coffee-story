import { Stack } from 'expo-router';

/**
 * The More tab's own nested stack, so its eleven destinations get a real
 * native push: swipe-back, the standard iOS transition, and tapping the More
 * tab again pops it to the menu the same way it pops any other tab.
 *
 * `headerShown: false` throughout -- every screen here already draws its own
 * "Back to More" affordance (see `more/information-page.tsx`'s `Back`), a
 * carry-over from when these were swapped-in views rather than routes. That
 * stays rather than doubling up with a native header bar.
 */
export default function ClientMoreLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
