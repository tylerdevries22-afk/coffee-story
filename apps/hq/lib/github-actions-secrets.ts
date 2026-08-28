import sodium from 'libsodium-wrappers';

export async function encryptGitHubActionsSecret(value: string, publicKey: string): Promise<string> {
  if (!value || !publicKey) throw new Error('A secret value and repository public key are required.');
  await sodium.ready;
  const keyBytes = sodium.from_base64(publicKey, sodium.base64_variants.ORIGINAL);
  if (keyBytes.length !== sodium.crypto_box_PUBLICKEYBYTES) {
    throw new Error('Repository public key is invalid.');
  }
  const encrypted = sodium.crypto_box_seal(sodium.from_string(value), keyBytes);
  return sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL);
}
