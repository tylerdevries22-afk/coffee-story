import Constants from 'expo-constants';
import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';

import { getOrCreateDevicePublicKey } from './device-identity';
import { heartbeatKiosk, registerKiosk } from './presence-api';
import { useDevice } from '@/state/device';

const HEARTBEAT_MS = 30_000;

export function KioskDevicePresence() {
  const device = useDevice();
  const active = useRef(true);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      active.current = state === 'active';
    });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (device.status !== 'ready' || !device.accessToken
        || !device.deviceId || !device.locationId) return undefined;
    const token = device.accessToken;
    const installationId = device.deviceId;
    const locationId = device.locationId;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    void (async () => {
      try {
        const publicKey = await getOrCreateDevicePublicKey();
        await registerKiosk(token, {
          installationId, locationId,
          label: device.label ?? 'Kiosk', formFactor: 'tablet', appTarget: 'kiosk_pos',
          platform: Platform.OS === 'android' ? 'android' : 'ios',
          appVersion: Constants.expoConfig?.version ?? 'unknown',
          runtimeVersion: String(Constants.expoConfig?.runtimeVersion ?? 'exposdk-54.0.0'),
          capabilities: ['heartbeat', 'diagnostics'], publicKey,
        });
        if (cancelled) return;
        const heartbeat = () => {
          if (active.current) {
            void heartbeatKiosk(token, installationId, locationId).catch(() => undefined);
          }
        };
        heartbeat();
        timer = setInterval(heartbeat, HEARTBEAT_MS);
      } catch {
        // Device Wall cannot block checkout and never logs credentials or identity material.
      }
    })();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [device.accessToken, device.deviceId, device.label, device.locationId, device.status]);
  return null;
}
