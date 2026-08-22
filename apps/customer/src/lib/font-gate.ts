/**
 * Decides whether the root layout may stop holding the native splash screen.
 *
 * `useFonts` reports `[loaded, error]` and never flips `loaded` to `true` once
 * it has errored. Gating the splash on `loaded` alone therefore strands the app
 * on the held splash forever — no recovery, no diagnostic, no way for the user
 * to reach the app. A font load failure must degrade to system fonts instead:
 * a font swap is a far better outcome than an app that never opens.
 *
 * Kept as a pure helper (no native imports) so it stays unit-testable under
 * `node:test`, per mobile/AGENTS.md.
 */
export function fontGateReady(loaded: boolean, error: Error | null): boolean {
  return loaded || error != null;
}
