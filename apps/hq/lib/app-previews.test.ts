import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { appPreviewFor, appPreviewsFor, defaultPreviewDevice, previewForDevice } from './app-previews';

describe('appPreviewFor', () => {
  it('uses the documented local five-surface URLs during development', () => {
    const previews = appPreviewsFor({ NODE_ENV: 'development' });

    assert.deepEqual(previews.map((preview) => [preview.key, preview.url, preview.source]), [
      ['hq', '/', 'local'],
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

  it('allows a deliberate local production preview wall', () => {
    const previews = appPreviewsFor({ COFFEE_STORY_LOCAL_PREVIEWS: '1', NODE_ENV: 'production' });

    assert.deepEqual(previews.map((preview) => preview.source), ['local', 'local', 'local', 'local', 'local']);
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

  it('reframes an app without changing its source URL', () => {
    const preview = appPreviewFor('operator', { NODE_ENV: 'development' });
    const mobile = previewForDevice(preview, 'mobile');
    assert.equal(mobile.frame, 'phone');
    assert.deepEqual(mobile.viewport, { width: 390, height: 844 });
    assert.equal(mobile.url, preview.url);
  });

  it('defaults a construction operator to mobile', () => {
    assert.equal(defaultPreviewDevice('operator', true), 'mobile');
    assert.equal(defaultPreviewDevice('operator', false), 'tablet');
    assert.equal(defaultPreviewDevice('customer', true), 'mobile');
  });
});
