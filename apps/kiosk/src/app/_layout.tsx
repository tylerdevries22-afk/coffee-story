import { Fraunces_700Bold } from '@expo-google-fonts/fraunces';
import { Inter_400Regular, Inter_600SemiBold, Inter_700Bold, useFonts } from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform, View } from 'react-native';
import * as ScreenOrientation from 'expo-screen-orientation';

import { ThemeProvider } from '@platform/ui';

import TENANT_BRAND_CONFIG from '@/tenant/brand.json';
import { KioskSessionProvider } from '@/state/session';

export default function KioskLayout() {
  const [loaded] = useFonts({
    Inter_400Regular, Inter_600SemiBold, Inter_700Bold, Fraunces_700Bold,
  });

  // A kiosk is bolted to a stand. Locking the orientation means a guest cannot
  // turn the layout into a phone-shaped one by leaning on it, and it is the
  // whole reason the bag can be a permanent rail rather than a screen.
  //
  // Native only. A desktop browser rejects screen.orientation.lock() from
  // inside the module, where a .catch() on the returned promise never sees it,
  // so every boot of the web export logged an unhandled rejection -- noise that
  // hides a real one. The web export is a review surface, not the target.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE)
      .catch(() => undefined);
  }, []);

  if (!loaded) return <View style={{ flex: 1, backgroundColor: '#FAF5EF' }} />;

  return (
    <ThemeProvider brandConfig={TENANT_BRAND_CONFIG}>
      <KioskSessionProvider>
        <StatusBar hidden />
        <Stack screenOptions={{ headerShown: false, animation: 'fade' }} />
      </KioskSessionProvider>
    </ThemeProvider>
  );
}
