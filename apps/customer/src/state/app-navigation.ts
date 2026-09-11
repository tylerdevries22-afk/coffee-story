import * as Haptics from 'expo-haptics';
import { router, type Href } from 'expo-router';

export function selectionFeedback() {
  void Haptics.selectionAsync().catch(() => undefined);
}
/**
 * `typedRoutes` narrows `Href` to a union of the literal paths in `src/app`.
 * These hrefs are assembled at runtime from tab keys and admin paths, so they
 * cannot be proven members of that union at compile time. `navigation-state`
 * is the only place that builds them and its tests pin every value it emits,
 * so the assertion is checked there rather than by the compiler.
 */
export function go(href: string, mode: 'navigate' | 'push' | 'replace' | 'dismissTo' = 'navigate') {
  router[mode](href as Href);
}
