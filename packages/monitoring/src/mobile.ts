export function mobileMonitoringEnabled(dsn: string | undefined, appOwnership: string | null): boolean {
  return Boolean(dsn) && appOwnership !== 'expo';
}

/** Initializes native crash reporting without making Expo Go depend on an absent native module. */
export async function initMobileMonitoring(): Promise<void> {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  try {
    const { default: Constants } = await import('expo-constants');
    if (!mobileMonitoringEnabled(dsn, Constants.appOwnership)) return;
    const Sentry = await import('@sentry/react-native');
    Sentry.init({
      dsn,
      tracesSampleRate: 0.2,
      enableAutoSessionTracking: true,
    });
  } catch {
    // Monitoring must never become the reason a guest-facing surface fails to boot.
  }
}
