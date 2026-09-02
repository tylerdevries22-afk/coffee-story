import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import ReactNativeBiometrics from 'react-native-biometrics';

export type DeviceIdentity = {
  readonly installationId: string;
  readonly publicKey: string;
};

const INSTALLATION_KEY = 'device-wall.installation-id';
const PUBLIC_KEY = 'device-wall.public-key';
const STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

async function installationId(): Promise<string> {
  const stored = await SecureStore.getItemAsync(INSTALLATION_KEY, STORE_OPTIONS);
  if (stored) return stored;
  const created = Crypto.randomUUID();
  await SecureStore.setItemAsync(INSTALLATION_KEY, created, STORE_OPTIONS);
  return created;
}

async function hardwarePublicKey(): Promise<string> {
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

/** The private half never enters JavaScript or leaves Keychain/Android Keystore. */
export async function getOrCreateDeviceIdentity(): Promise<DeviceIdentity> {
  if (!await SecureStore.isAvailableAsync()) {
    throw new Error('Secure device identity storage is unavailable.');
  }
  return {
    installationId: await installationId(),
    publicKey: await hardwarePublicKey(),
  };
}
