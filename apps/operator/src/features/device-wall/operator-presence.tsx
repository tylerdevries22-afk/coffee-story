import Constants from 'expo-constants';
import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';

import { getOrCreateDeviceIdentity } from './device-identity';
import { registerOperatorInstallation, sendOperatorHeartbeat } from './device-wall-api';
import { useAuth } from '@/state/auth-context';

const HEARTBEAT_MS = 30_000;

function platform(): 'ios' | 'android' | 'web' {
  return Platform.OS === 'android' ? 'android' : Platform.OS === 'web' ? 'web' : 'ios';
}

export function OperatorDevicePresence() {
  const { isDemo, liveLocations, session } = useAuth();
  const active = useRef(true);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      active.current = state === 'active';
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const location = liveLocations[0];
    if (isDemo || !session || !location) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    void (async () => {
      try {
        const identity = await getOrCreateDeviceIdentity();
        if (cancelled) return;
        const appVersion = Constants.expoConfig?.version ?? 'unknown';
        const runtimeVersion = String(Constants.expoConfig?.runtimeVersion ?? 'exposdk-54.0.0');
        await registerOperatorInstallation(session.access_token, {
          installationId: identity.installationId,
          locationId: location.id,
          label: `${location.name} Operator`,
          formFactor: Platform.OS === 'ios' && Platform.isPad ? 'tablet' : 'phone',
          appTarget: 'operator',
          platform: platform(),
          appVersion,
          runtimeVersion,
          capabilities: ['heartbeat', 'diagnostics'],
          publicKey: identity.publicKey,
        });
        if (cancelled) return;
        const heartbeat = () => {
          if (active.current) {
            void sendOperatorHeartbeat(
              session.access_token, identity.installationId, location.id,
            ).catch(() => undefined);
          }
        };
        heartbeat();
        timer = setInterval(heartbeat, HEARTBEAT_MS);
      } catch {
        // Presence is non-blocking and never exposes identity or session details in logs.
      }
    })();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [isDemo, liveLocations, session]);

  return null;
}
