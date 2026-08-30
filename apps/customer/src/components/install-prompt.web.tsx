import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon } from '@/components/icon';
import { useBusiness } from '@/state/business';
import { useTokens as useBrandTokens, type BrandTokens } from '@platform/ui';

/**
 * Offers to install the web demo to the home screen, so it launches without
 * browser chrome and behaves like the native app.
 *
 * The two platforms need completely different treatment:
 *
 * - Chrome/Android fires `beforeinstallprompt`, which can be captured and
 *   replayed later against a real user gesture. That opens the OS install
 *   dialog and produces a genuine home-screen app.
 * - iOS Safari has no programmatic install at all. The only route is the user
 *   choosing Share -> Add to Home Screen, so the best we can do is say so
 *   clearly at the moment they are looking for it.
 *
 * Once installed, `display-mode: standalone` matches and this disappears.
 */

/** The slice of `BeforeInstallPromptEvent` we use; it is not in lib.dom yet. */
type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const DISMISSED_KEY = 'platform.customer.install-prompt-dismissed.v1';

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  // `navigator.standalone` is the iOS-only signal; the media query covers the rest.
  const iosStandalone = (window.navigator as { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia('(display-mode: standalone)').matches;
}

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  // iPadOS 13+ reports as a Mac, so the touch-point check catches it too.
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (/mac/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  );
}

function wasDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    // Private browsing refuses localStorage; showing the banner is the safe default.
    return false;
  }
}

export function InstallPrompt() {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const business = useBusiness();
  const insets = useSafeAreaInsets();
  // Starts empty so the first render matches the statically rendered HTML; the
  // effect below fills it in afterwards. `'ios'` means "no programmatic install
  // exists, show the manual route".
  const [offer, setOffer] = useState<'ios' | InstallEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web' || isStandalone() || wasDismissed()) return undefined;

    if (isIos()) {
      // Deferred by a tick rather than set inline: the React Compiler forbids a
      // synchronous setState in an effect body, and this also keeps the banner
      // out of the hydration pass.
      const timer = setTimeout(() => setOffer('ios'), 0);
      return () => clearTimeout(timer);
    }

    const onBeforeInstall = (event: Event) => {
      // Suppressing the default keeps Chrome's own mini-infobar from firing, so
      // the offer appears in the app's own styling and at a moment we choose.
      event.preventDefault();
      setOffer(event as InstallEvent);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);

    // Installing from anywhere (including the browser menu) retires the banner.
    const onInstalled = () => setOffer(null);
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const installEvent = offer && offer !== 'ios' ? offer : null;
  const showIosHint = offer === 'ios';

  function dismiss() {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // Not remembering the dismissal is a far smaller problem than crashing.
    }
  }

  async function install() {
    if (!installEvent) return;
    await installEvent.prompt();
    await installEvent.userChoice;
    // The event is single-use whatever the outcome.
    setOffer(null);
  }

  if (dismissed || (!installEvent && !showIosHint)) return null;

  return (
    <View style={[styles.bar, { paddingTop: insets.top + tokens.spacing.md }]}>
      <View style={styles.mark}>
        <AppIcon name="arrow.down.to.line" size={18} tintColor={tokens.surfaceElevated} />
      </View>
      <View style={styles.copy}>
        <Text style={styles.title}>Add {business.name} to your home screen</Text>
        <Text style={styles.body}>
          {showIosHint
            ? 'Tap Share, then “Add to Home Screen”.'
            : 'Installs like an app — opens full screen, no browser.'}
        </Text>
      </View>
      {installEvent ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Install the app"
          onPress={install}
          style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
        >
          <Text style={styles.ctaText}>Install</Text>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        hitSlop={10}
        onPress={dismiss}
        style={({ pressed }) => [styles.close, pressed && styles.pressed]}
      >
        <AppIcon name="xmark" size={15} tintColor={tokens.surface} />
      </Pressable>
    </View>
  );
}

const createStyles = (tokens: BrandTokens) => StyleSheet.create({
  bar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 50,
    backgroundColor: tokens.primary,
    paddingHorizontal: tokens.spacing.lg,
    paddingBottom: tokens.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.spacing.md,
  },
  mark: {
    width: 34,
    height: 34,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1, gap: 1 },
  title: { color: tokens.surfaceElevated, fontFamily: tokens.fontBody, fontSize: 14 },
  body: { color: tokens.surface, fontFamily: tokens.fontBody, fontSize: 12, lineHeight: 16 },
  cta: {
    minHeight: 34,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.surfaceElevated,
    paddingHorizontal: tokens.spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: { color: tokens.primary, fontFamily: tokens.fontBody, fontSize: 14 },
  close: { padding: 4 },
  pressed: { opacity: 0.85 },
});
