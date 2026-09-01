import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { appPreviewFor, appPreviewsFor } from './app-previews';

describe('appPreviewFor', () => {
  it('uses the documented local five-surface URLs during development', () => {
    const previews = appPreviewsFor({ NODE_ENV: 'development' });

    assert.deepEqual(previews.map((preview) => [preview.key, preview.url, preview.source]), [
      ['customer', 'http://localhost:4170/', 'local'],
      ['operator', 'http://localhost:4191/', 'local'],
      ['kiosk', 'http://localhost:4180/', 'local'],
      ['display', 'http://localhost:3200/board/demo', 'local'],
    ]);
  });

  it('accepts configured HTTPS URLs in production', () => {
    const preview = appPreviewFor('customer', {
      NODE_ENV: 'production',
      NEXT_PUBLIC_CUSTOMER_URL: 'https://customer.example.com/app',
    });

    assert.equal(preview.url, 'https://customer.example.com/app');
    assert.equal(preview.source, 'configured');
  });

  it('fails closed for untrusted or malformed configured URLs', () => {
    const production = { NODE_ENV: 'production' };

    assert.equal(appPreviewFor('operator', {
      ...production, NEXT_PUBLIC_OPERATOR_URL: 'http://operator.example.com',
    }).source, 'unavailable');
    assert.equal(appPreviewFor('kiosk', {
      ...production, NEXT_PUBLIC_KIOSK_URL: 'javascript:alert(1)',
    }).url, null);
    assert.equal(appPreviewFor('display', {
      ...production, NEXT_PUBLIC_DISPLAY_URL: 'https://user:secret@display.example.com',
    }).url, null);
  });
});
