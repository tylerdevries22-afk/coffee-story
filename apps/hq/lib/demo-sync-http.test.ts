import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  demoSyncAvailable,
  demoMediaAvailable,
  demoSyncChannel,
  demoSyncHeaders,
  demoSyncRuntimeEnabled,
  demoSyncWriteAllowed,
  parseDemoSyncBody,
  previewWallRuntimeEnabled,
} from './demo-sync-http';

const previousMode = process.env.COFFEE_STORY_DEMO_SYNC;
const previousPreview = process.env.COFFEE_STORY_PREVIEW_WALL;
afterEach(() => {
  if (previousMode === undefined) delete process.env.COFFEE_STORY_DEMO_SYNC;
  else process.env.COFFEE_STORY_DEMO_SYNC = previousMode;
  if (previousPreview === undefined) delete process.env.COFFEE_STORY_PREVIEW_WALL;
  else process.env.COFFEE_STORY_PREVIEW_WALL = previousPreview;
});
describe('demo sync HTTP boundary', () => {
  it('requires an explicit non-production loopback mode', () => {
    process.env.COFFEE_STORY_DEMO_SYNC = '1';
    assert.equal(demoSyncRuntimeEnabled(), true);
    assert.equal(demoSyncAvailable(new Request('http://localhost:3300/api/demo-sync/orders')), true);
    assert.equal(demoSyncAvailable(new Request('http://demo.example/api/demo-sync/orders')), false);
  });
  it('serves read-only preview media on loopback without enabling demo writes', () => {
    delete process.env.COFFEE_STORY_DEMO_SYNC;
    assert.equal(demoMediaAvailable(new Request('http://localhost:3300/api/demo-media/menu/espresso')), true);
    assert.equal(demoMediaAvailable(new Request('http://127.0.0.1:3300/api/demo-media/training/knowledge')), true);
    assert.equal(demoMediaAvailable(new Request('https://demo.example/api/demo-media/menu/espresso')), false);
    assert.equal(demoSyncAvailable(new Request('http://localhost:3300/api/demo-sync/orders')), false);
  });
  it('isolates HQ only for the explicit local preview wall', () => {
    process.env.COFFEE_STORY_DEMO_SYNC = '1';
    process.env.COFFEE_STORY_PREVIEW_WALL = '1';
    assert.equal(previewWallRuntimeEnabled(), true);
    delete process.env.COFFEE_STORY_PREVIEW_WALL;
    assert.equal(previewWallRuntimeEnabled(), false);
  });
  it('allows only known channels and loopback browser origins', () => {
    assert.equal(demoSyncChannel('kiosk'), 'kiosk'); assert.equal(demoSyncChannel('display'), null);
    const local = new Request('http://localhost:3300/api/demo-sync/orders', { headers: { origin: 'http://localhost:4180' } });
    const remote = new Request('http://localhost:3300/api/demo-sync/orders', { headers: { origin: 'https://attacker.example' } });
    const opaque = new Request('http://localhost:3300/api/demo-sync/orders', { headers: { origin: 'null' } });
    assert.equal(demoSyncWriteAllowed(local), true); assert.equal(demoSyncWriteAllowed(remote), false);
    assert.equal(new Headers(demoSyncHeaders(local)).get('access-control-allow-origin'), 'http://localhost:4180');
    assert.equal(new Headers(demoSyncHeaders(remote)).has('access-control-allow-origin'), false);
    assert.equal(new Headers(demoSyncHeaders(opaque)).has('access-control-allow-origin'), false);
  });
  it('bounds and parses JSON before it reaches typed code', async () => {
    const local = 'http://localhost:3300/api/demo-sync/orders';
    const parsed = await parseDemoSyncBody(new Request(local, { method: 'POST', body: '{"ok":true}' }));
    assert.deepEqual(parsed, { ok: true, value: { ok: true } });
    const oversized = await parseDemoSyncBody(new Request(local, {
      method: 'POST', headers: { 'content-length': '70000' }, body: '{}',
    }));
    assert.equal(oversized.ok, false);
    if (!oversized.ok) assert.equal(oversized.response.status, 413);
  });
});
