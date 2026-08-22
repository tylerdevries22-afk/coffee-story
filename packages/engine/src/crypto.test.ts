import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';

import { decryptToken, encryptToken, loadTokenKey } from './crypto';

const KEY = randomBytes(32);

describe('token crypto', () => {
  it('round-trips', () => {
    const blob = encryptToken('EAAA-sandbox-token', KEY);
    assert.equal(decryptToken(blob, KEY), 'EAAA-sandbox-token');
    assert.ok(blob.startsWith('v1:'));
  });

  it('produces a different blob every time (fresh IV)', () => {
    assert.notEqual(encryptToken('same', KEY), encryptToken('same', KEY));
  });

  it('rejects tampering', () => {
    const blob = encryptToken('secret', KEY);
    const raw = Buffer.from(blob.slice(3), 'base64');
    raw[14] = (raw[14] ?? 0) ^ 0xff;
    const tampered = `v1:${raw.toString('base64')}`;
    assert.throws(() => decryptToken(tampered, KEY));
  });

  it('rejects the wrong key', () => {
    const blob = encryptToken('secret', KEY);
    assert.throws(() => decryptToken(blob, randomBytes(32)));
  });

  it('loadTokenKey demands exactly 32 base64 bytes', () => {
    assert.throws(() => loadTokenKey({} as NodeJS.ProcessEnv));
    assert.throws(() => loadTokenKey({ SQUARE_TOKEN_KEY: Buffer.from('short').toString('base64') } as NodeJS.ProcessEnv));
    const good = loadTokenKey({ SQUARE_TOKEN_KEY: KEY.toString('base64') } as NodeJS.ProcessEnv);
    assert.equal(good.length, 32);
  });
});
