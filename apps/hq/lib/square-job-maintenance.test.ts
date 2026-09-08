import assert from 'node:assert/strict';
import { it } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  runSquareMaintenance,
  waitForSquareMaintenanceBeforeRethrow,
} from './square-job-maintenance';

it('reports optional Square maintenance as unconfigured without credentials', async (t) => {
  const appId = process.env.SQUARE_APP_ID;
  const secret = process.env.SQUARE_APP_SECRET;
  delete process.env.SQUARE_APP_ID;
  delete process.env.SQUARE_APP_SECRET;
  t.after(() => {
    if (appId === undefined) delete process.env.SQUARE_APP_ID;
    else process.env.SQUARE_APP_ID = appId;
    if (secret === undefined) delete process.env.SQUARE_APP_SECRET;
    else process.env.SQUARE_APP_SECRET = secret;
  });
  t.mock.method(console, 'warn', () => {});

  const result = await runSquareMaintenance({} as SupabaseClient, new Date());

  assert.equal(result.configured, false);
  assert.equal(result.checkoutLinks.scanned, 0);
  assert.equal(result.retirements.scanned, 0);
});

it('finishes Square maintenance before preserving an earlier scheduled-job error', async () => {
  let finishMaintenance: (() => void) | undefined;
  const maintenance = new Promise<void>((resolve) => {
    finishMaintenance = resolve;
  });
  const jobError = new Error('operation notifications failed');
  let settled = false;
  const result = waitForSquareMaintenanceBeforeRethrow(maintenance, jobError)
    .finally(() => { settled = true; });

  await Promise.resolve();
  assert.equal(settled, false);
  finishMaintenance?.();
  await assert.rejects(result, (error) => error === jobError);
});
