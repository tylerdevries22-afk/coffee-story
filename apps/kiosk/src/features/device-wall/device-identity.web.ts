/** Static kiosk previews are deliberately unpaired and never receive an identity. */
export async function getOrCreateDevicePublicKey(): Promise<string> {
  throw new Error('Pair a custom kiosk build before registering its device identity.');
}
