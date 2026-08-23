import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';

import { shortCodeOf } from '../../../apps/operator/src/features/operator/live-board.ts';

import { clickLabel, clickText, closeBrowser, fillLabel, openApp, waitText } from './driver.ts';
import { latestOtpFor } from './mailpit.ts';
import { createStaffAccount, onboardedBrand, seedRivalBrandOrder, type SeededBrand } from './seed.ts';
import { skipUnlessConfigured, sql, stack, uniqueEmail } from './stack.ts';
import { startHq, startStaticServer } from './servers.ts';

const CUSTOMER_PORT = 4381;
const OPERATOR_PORT = 4382;
const HQ_PORT = 4383;
const CUSTOMER_URL = `http://127.0.0.1:${CUSTOMER_PORT}`;
const OPERATOR_URL = `http://127.0.0.1:${OPERATOR_PORT}`;
const HQ_URL = `http://127.0.0.1:${HQ_PORT}`;

const IPHONE = { width: 390, height: 844 };
const IPAD_LANDSCAPE = { width: 1194, height: 834 };
const DESKTOP = { width: 1440, height: 900 };

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * The pickup card names the tenant this stack was seeded with, so the step
 * that selects it reads the same brand.json `pnpm onboard` did rather than a
 * literal street. Pinning "Havana St" here would pass for the first tenant and
 * quietly stop meaning anything for the second -- which is exactly how that
 * address ended up hard-coded in the app in the first place.
 */
const TENANT_BRAND = JSON.parse(
  readFileSync(new URL('../../../tenants/coffee-story/brand.json', import.meta.url), 'utf8'),
) as { location: { address: { street: string } } };
const PICKUP_STREET = TENANT_BRAND.location.address.street;

/**
 * The board advances optimistically and inserts the event behind the tap, so
 * a click and the row it produces are never simultaneous. Wait for the status
 * the tap asked for, and report whatever it actually reached if it never
 * arrives — asserting on one immediate read is a race the suite would lose
 * at random.
 */
async function waitForOrderStatus(orderId: string, status: string, timeoutMs = 20_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let seen = '';
  while (Date.now() < deadline) {
    const row = await sql<{ status: string }>('select status from public.orders where id = $1', [orderId]);
    seen = row.rows[0]?.status ?? '(gone)';
    if (seen === status) return seen;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return seen;
}

/**
 * The three apps together, against one real stack: what a guest does in the
 * customer app must appear under the barista's hands in the operator app and
 * in the owner's numbers in HQ — through the actual database, the actual
 * API, the actual RLS, and the actual Realtime channels.
 */
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
    // Belt and suspenders: if any stray handle survives the teardown, exit
    // with the verdict the runner has already established instead of hanging
    // the CI job until its timeout. Unref'd, so a clean exit ignores it.
    setTimeout(() => process.exit(process.exitCode ?? 1), 15_000).unref();
  });

  it('demo smoke: the Expo Go preview still opens without any backend', async () => {
    const app = await openApp(CUSTOMER_URL, IPHONE);
    try {
      await clickText(app.page, 'Preview the complete Demo');
      await waitText(app.page, 'Weekly Drops', 30_000);
      await app.shot('demo-smoke');
    } catch (error) {
      await app.shot('demo-smoke-FAIL');
      throw error;
    } finally {
      await app.close();
    }
  });

  it('full loop: order placed by a guest is worked on the board and lands in the numbers', async () => {
    const brand: SeededBrand = await onboardedBrand();
    const staff = await createStaffAccount(brand, 'location_manager');
    const guestEmail = uniqueEmail('guest');

    const customer = await openApp(CUSTOMER_URL, IPHONE);
    const operator = await openApp(OPERATOR_URL, IPAD_LANDSCAPE);
    const hq = await openApp(HQ_URL, DESKTOP);
    const dumpOnFail = async () => {
      await customer.shot('full-loop-customer-FAIL');
      await operator.shot('full-loop-operator-FAIL');
      await hq.shot('full-loop-hq-FAIL');
      // Into the log as well as the artifact: what each app was showing is
      // the whole diagnosis, and the screenshots are not always reachable
      // from where this gets read.
      await customer.dump('customer at failure');
      await operator.dump('operator at failure');
      await hq.dump('hq at failure');
    };

    try {
      // ---- The guest signs in with an email code, like a real first run.
      await clickText(customer.page, 'Email me a sign-in code instead');
      await fillLabel(customer.page, 'Email', guestEmail);
      await clickText(customer.page, 'Email me a code');
      const code = await latestOtpFor(guestEmail);
      await fillLabel(customer.page, 'Six-digit code', code);
      await clickText(customer.page, 'Verify and sign in');
      await waitText(customer.page, 'Weekly Drops', 45_000);
      await customer.shot('01-customer-signed-in');

      // ---- Builds a bag and places a pay-at-pickup order.
      await customer.page.goto(`${CUSTOMER_URL}/client/book`, { waitUntil: 'load' });
      await clickLabel(customer.page, 'Pickup order');
      await clickLabel(customer.page, new RegExp(PICKUP_STREET.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      await fillLabel(customer.page, 'Name for the order', 'E2E Guest');
      await clickLabel(customer.page, /^Today, /);
      await clickText(customer.page, 'See the menu');
      await clickLabel(customer.page, /^Latte, /);
      await clickText(customer.page, 'Add to Bag');
      await clickLabel(customer.page, /^View bag, /);
      await clickText(customer.page, 'Checkout');
      await clickText(customer.page, 'Skip');
      await waitText(customer.page, 'Pay at the counter');
      await customer.shot('02-customer-checkout');
      await clickText(customer.page, 'Place Order');
      await waitText(customer.page, 'Order placed', 45_000);
      await waitText(customer.page, 'Order received');
      await customer.shot('03-customer-confirmation');

      // ---- The database is the truth the confirmation rendered.
      const placed = await sql<{ id: string; status: string; total_cents: number; subtotal_cents: number }>(
        `select id, status, total_cents, subtotal_cents from public.orders
         where brand_id = $1 order by created_at desc limit 1`,
        [brand.brandId],
      );
      const order = placed.rows[0];
      assert.ok(order, 'the order reached the database');
      assert.equal(order.status, 'paid', 'pay_at_pickup lands on the board immediately');
      await waitText(customer.page, money(Number(order.total_cents)));
      const callOut = shortCodeOf(order.id);

      // ---- The barista sees it and works it; the guest watches it move.
      await fillLabel(operator.page, 'Email', staff.email);
      await fillLabel(operator.page, 'Password', staff.password);
      await clickText(operator.page, 'Sign in');
      await operator.page.waitForURL(/\/staff/, { timeout: 45_000 });
      await operator.page.goto(`${OPERATOR_URL}/staff/orders`, { waitUntil: 'load' });
      await waitText(operator.page, callOut, 45_000);
      await operator.shot('04-operator-board');

      await clickLabel(operator.page, `Start order ${callOut}`);
      await waitText(customer.page, 'Being made', 30_000);
      await clickLabel(operator.page, `Ready order ${callOut}`);
      await waitText(customer.page, 'Ready for pickup', 30_000);
      await customer.shot('05-customer-ready');
      await clickLabel(operator.page, `Picked up order ${callOut}`);
      assert.equal(await waitForOrderStatus(order.id, 'picked_up'), 'picked_up');

      // ---- A rival brand's order never reaches this board (RLS isolation).
      const rival = await seedRivalBrandOrder();
      const rivalCallOut = shortCodeOf(rival.orderId);
      await operator.page.goto(`${OPERATOR_URL}/staff/orders`, { waitUntil: 'load' });
      await operator.page.waitForTimeout(4000);
      assert.equal(
        await operator.page.getByText(rivalCallOut, { exact: true }).count(),
        0,
        'another brand’s order must never appear on this board',
      );

      // ---- The owner's dashboard carries the money.
      await hq.page.goto(`${HQ_URL}/`, { waitUntil: 'load' });
      await hq.page.waitForURL(/\/login/, { timeout: 30_000 });
      await fillLabel(hq.page, 'Email', staff.email);
      await fillLabel(hq.page, 'Password', staff.password);
      // The page's heading also reads "Sign in"; target the button.
      await hq.page.getByRole('button', { name: 'Sign in' }).first().click({ timeout: 20_000 });
      await waitText(hq.page, 'This week', 45_000);
      const metrics = await sql<{ revenue_cents: string }>(
        `select revenue_cents from public.brand_daily_metrics where brand_id = $1 order by day desc limit 1`,
        [brand.brandId],
      );
      const revenue = Number(metrics.rows[0]?.revenue_cents ?? 0);
      assert.ok(revenue >= Number(order.total_cents), 'the metric views carry the order');
      await waitText(hq.page, money(revenue), 30_000);
      await hq.shot('06-hq-dashboard');
    } catch (error) {
      await dumpOnFail();
      throw error;
    } finally {
      await customer.close();
      await operator.close();
      await hq.close();
    }
  });
});
