import * as Crypto from 'expo-crypto';

import type { DeviceIdentity } from './device-identity';

type StoredIdentity = DeviceIdentity & { readonly privateKey: CryptoKey };

const DATABASE = 'platform-device-wall';
const STORE = 'identity';
const RECORD = 'operator';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Private device identity storage is unavailable.'));
  });
}

async function readIdentity(database: IDBDatabase): Promise<StoredIdentity | null> {
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE).objectStore(STORE).get(RECORD);
    request.onsuccess = () => {
      const result: unknown = request.result;
      if (!result || typeof result !== 'object' || Array.isArray(result)) return resolve(null);
      const record = result as Record<string, unknown>;
      const { installationId, publicKey, privateKey } = record;
      if (typeof installationId !== 'string' || typeof publicKey !== 'string'
          || !(privateKey instanceof CryptoKey) || privateKey.extractable) return resolve(null);
      return resolve({ installationId, publicKey, privateKey });
    };
    request.onerror = () => reject(new Error('The private device identity could not be read.'));
  });
}

async function writeIdentity(database: IDBDatabase, value: StoredIdentity): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = database.transaction(STORE, 'readwrite').objectStore(STORE).put(value, RECORD);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error('The private device identity could not be saved.'));
  });
}

async function createIdentity(): Promise<StoredIdentity> {
  const keys = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'],
  );
  if (!('privateKey' in keys)) throw new Error('A non-exportable identity could not be created.');
  const publicKey = await crypto.subtle.exportKey('jwk', keys.publicKey);
  return {
    installationId: Crypto.randomUUID(),
    publicKey: JSON.stringify(publicKey),
    privateKey: keys.privateKey,
  };
}

/** IndexedDB structured-clones the non-exportable CryptoKey without exposing it. */
export async function getOrCreateDeviceIdentity(): Promise<DeviceIdentity> {
  if (!globalThis.isSecureContext || !globalThis.indexedDB || !globalThis.crypto?.subtle) {
    throw new Error('A secure browser context is required for device identity.');
  }
  const database = await openDatabase();
  try {
    const stored = await readIdentity(database);
    if (stored) return stored;
    const created = await createIdentity();
    await writeIdentity(database, created);
    return created;
  } finally {
    database.close();
  }
}
