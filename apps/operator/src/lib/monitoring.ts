/**
 * Crash reporting, three-way guarded: never without a DSN, never in Expo Go
 * (the native module is not embedded there and the demo must not crash),
 * and never allowed to take the app down itself.
 *
 * The DSN rides EXPO_PUBLIC_SENTRY_DSN -- public by design; a DSN only
 * lets clients *submit* events.
 */
import Constants from 'expo-constants';

export function initMonitoring(): void {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  if (Constants.appOwnership === 'expo') return; // Expo Go: no native module
  import('@sentry/react-native')
    .then((Sentry) => {
      Sentry.init({
        dsn,
        // Session/trace volume stays modest until someone tunes it on data.
        tracesSampleRate: 0.2,
        enableAutoSessionTracking: true,
      });
    })
    .catch((error: unknown) => {
      console.warn('Monitoring failed to start', error instanceof Error ? error.message : error);
    });
}
