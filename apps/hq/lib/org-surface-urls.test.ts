import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  displayBoardPath,
  hostedSurfaceUrlsForSlug,
  pathBasedSurfaceUrls,
  surfaceUrlsForTenant,
} from './org-surface-urls';

describe('hostedSurfaceUrlsForSlug', () => {
  it('derives Model B path URLs for any tenant slug', () => {
    const urls = hostedSurfaceUrlsForSlug('demo-roastery');
    assert.equal(urls.hq, 'https://demo-roastery-hq.vercel.app/');
    assert.equal(urls.customer, 'https://demo-roastery-hq.vercel.app/customer');
    assert.equal(urls.kiosk, 'https://demo-roastery-hq.vercel.app/kiosk');
    assert.equal(urls.operator, 'https://demo-roastery-hq.vercel.app/operator');
    assert.equal(urls.display, 'https://demo-roastery-display.vercel.app/');
  });

  it('uses /board/<uuid> when a location id is known', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    assert.equal(displayBoardPath(id), `/board/${id}`);
    assert.equal(displayBoardPath('demo'), '/');
    const urls = hostedSurfaceUrlsForSlug('demo-roastery', {}, id);
    assert.equal(urls.display, `https://demo-roastery-display.vercel.app/board/${id}`);
  });
});

describe('surfaceUrlsForTenant', () => {
  it('returns coffee-story hosted URLs when wall-hosted is requested', () => {
    const urls = surfaceUrlsForTenant('coffee-story', {
      NODE_ENV: 'development',
      COFFEE_STORY_WALL_HOSTED: '1',
    });
    assert.equal(urls.customer, 'https://coffee-story-hq.vercel.app/customer');
    assert.equal(urls.display, 'https://coffee-story-display.vercel.app/');
  });

  it('keeps local loopback URLs in development by default', () => {
    const urls = surfaceUrlsForTenant('coffee-story', { NODE_ENV: 'development' });
    assert.equal(urls.kiosk, 'http://localhost:4180/');
    assert.equal(urls.hq, '/');
  });

  it('honors model-B path origin when configured', () => {
    const urls = surfaceUrlsForTenant('any-tenant', {
      NODE_ENV: 'production',
      NEXT_PUBLIC_ORG_SURFACE_ORIGIN: 'https://coffee-story.example.com',
    });
    assert.equal(urls.hq, 'https://coffee-story.example.com/');
    assert.equal(urls.customer, 'https://coffee-story.example.com/customer');
  });

  it('keeps dedicated display host under model-B path origin', () => {
    const urls = surfaceUrlsForTenant('coffee-story', {
      NODE_ENV: 'production',
      NEXT_PUBLIC_ORG_SURFACE_ORIGIN: 'https://coffee-story-hq.vercel.app',
    });
    assert.equal(urls.customer, 'https://coffee-story-hq.vercel.app/customer');
    assert.equal(urls.display, 'https://coffee-story-display.vercel.app/');
  });

  it('rejects credentialed or http non-loopback origins', () => {
    const urls = surfaceUrlsForTenant('coffee-story', {
      NODE_ENV: 'production',
      NEXT_PUBLIC_ORG_SURFACE_ORIGIN: 'https://user:pass@evil.example.com',
    });
    assert.equal(urls.customer, 'https://coffee-story-hq.vercel.app/customer');
  });
});

describe('pathBasedSurfaceUrls', () => {
  it('strips a trailing slash once', () => {
    assert.equal(pathBasedSurfaceUrls('https://x.example/').customer, 'https://x.example/customer');
  });
});
