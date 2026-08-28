import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import sodium from 'libsodium-wrappers';

import { encryptGitHubActionsSecret } from './github-actions-secrets';

describe('encryptGitHubActionsSecret', () => {
  it('creates a GitHub-compatible sealed box without returning plaintext', async () => {
    await sodium.ready;
    const keys = sodium.crypto_box_keypair();
    const publicKey = sodium.to_base64(keys.publicKey, sodium.base64_variants.ORIGINAL);
    const encrypted = await encryptGitHubActionsSecret('sensitive-value', publicKey);
    assert.equal(encrypted.includes('sensitive-value'), false);
    const opened = sodium.crypto_box_seal_open(
      sodium.from_base64(encrypted, sodium.base64_variants.ORIGINAL),
      keys.publicKey,
      keys.privateKey,
    );
    assert.equal(sodium.to_string(opened), 'sensitive-value');
  });

  it('rejects malformed repository keys', async () => {
    await assert.rejects(() => encryptGitHubActionsSecret('secret', 'invalid-key'), /invalid/);
  });
});
