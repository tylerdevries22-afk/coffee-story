import { after, before, describe, it } from 'node:test';

import { APP_MODE_STORAGE_KEY as CUSTOMER_APP_MODE_KEY }
  from '../../../apps/customer/src/state/demo-storage-keys.ts';

import { closeBrowser, openApp, waitText } from './driver.ts';
import { runThreeAppsFullLoop } from './three-apps-flow.ts';
import { skipUnlessConfigured, stack } from './stack.ts';
import { startHq, startStaticServer } from './servers.ts';

const CUSTOMER_PORT = 4381;
const OPERATOR_PORT = 4382;
const HQ_PORT = 4383;
const CUSTOMER_URL = `http://127.0.0.1:${CUSTOMER_PORT}`;
const IPHONE = { width: 390, height: 844 };

/** The customer, operator, and HQ surfaces share one live database contract. */
describe('three apps, one stack', { skip: skipUnlessConfigured }, () => {
  const stops: (() => void)[] = [];

  before(async () => {
    if (skipUnlessConfigured) return;
    stops.push(await startStaticServer(stack.customerDir, CUSTOMER_PORT));
    stops.push(await startStaticServer(stack.operatorDir, OPERATOR_PORT));
    stops.push(await startHq(HQ_PORT));
  });

  after(async () => {
    await closeBrowser();
    for (const stop of stops) stop();
    setTimeout(() => process.exit(process.exitCode ?? 1), 15_000).unref();
  });

  it('demo smoke: the Expo Go preview still opens without any backend', async () => {
    const app = await openApp(CUSTOMER_URL, IPHONE, { storageKey: CUSTOMER_APP_MODE_KEY, value: 'demo' });
    try {
      await waitText(app.page, 'Weekly Drops', 30_000);
      await app.shot('demo-smoke');
    } catch (error) {
      await app.shot('demo-smoke-FAIL');
      throw error;
    } finally {
      await app.close();
    }
  });

  it('full loop: order placed by a guest is worked on the board and lands in the numbers', runThreeAppsFullLoop);
});
