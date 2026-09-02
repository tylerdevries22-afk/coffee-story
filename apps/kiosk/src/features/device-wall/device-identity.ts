import * as SecureStore from 'expo-secure-store';
import ReactNativeBiometrics from 'react-native-biometrics';

const PUBLIC_KEY = 'device-wall.kiosk-public-key';
const STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/** Returns only the public half; the private key stays in platform hardware storage. */
export async function getOrCreateDevicePublicKey(): Promise<string> {
  if (!await SecureStore.isAvailableAsync()) {
    throw new Error('Secure device identity storage is unavailable.');
  }
  const stored = await SecureStore.getItemAsync(PUBLIC_KEY, STORE_OPTIONS);
  if (stored) return stored;
  const biometrics = new ReactNativeBiometrics({ allowDeviceCredentials: true });
  const existing = await biometrics.biometricKeysExist();
  if (existing.keysExist) await biometrics.deleteKeys();
  const created = await biometrics.createKeys();
  const publicKey = JSON.stringify({
    kty: 'RSA', alg: 'RS256', use: 'sig', spki: created.publicKey,
  });
  await SecureStore.setItemAsync(PUBLIC_KEY, publicKey, STORE_OPTIONS);
  return publicKey;
}
