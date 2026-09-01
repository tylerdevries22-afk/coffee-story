import assert from 'node:assert/strict';
import type { Page } from 'playwright';

import { ticketCallout } from '@platform/domain/src/board-display.ts';
import { APP_MODE_STORAGE_KEY as CUSTOMER_APP_MODE_KEY }
  from '../../../apps/customer/src/state/demo-storage-keys.ts';
import { APP_MODE_STORAGE_KEY as OPERATOR_APP_MODE_KEY }
  from '../../../apps/operator/src/state/demo-storage-keys.ts';

import { clickLabel, clickText, fillLabel, openApp, waitText } from './driver.ts';
import { createGuestAccount, createStaffAccount, onboardedBrand, seedRivalBrandOrder } from './seed.ts';
import { sql } from './stack.ts';

const CUSTOMER_URL = 'http://127.0.0.1:4381';
const OPERATOR_URL = 'http://127.0.0.1:4382';
const HQ_URL = 'http://127.0.0.1:4383';
const IPHONE = { width: 390, height: 844 };
const IPAD_LANDSCAPE = { width: 1194, height: 834 };
const DESKTOP = { width: 1440, height: 900 };

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Wait for the optimistic board action to settle in the database. */
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

/** Work a scheduled order from its detail sheet or a current order from the board. */
async function clickOperatorAction(page: Page, orderCode: number, actionText: string): Promise<void> {
  const boardAction = page.getByLabel(`${actionText} for order ${orderCode}`);
  const scheduledCard = page.getByLabel(new RegExp(`^Scheduled order ${orderCode} for `));
  await boardAction.or(scheduledCard).first().waitFor({ timeout: 45_000 });
  if (await boardAction.count() > 0) {
    await boardAction.first().click({ timeout: 20_000 });
    return;
  }
  await scheduledCard.first().click({ timeout: 20_000 });
  await boardAction.first().click({ timeout: 20_000 });
}

export async function runThreeAppsFullLoop(): Promise<void> {
  const brand = await onboardedBrand();
  const staff = await createStaffAccount(brand, 'location_manager');
  const guest = await createGuestAccount();
  const customer = await openApp(CUSTOMER_URL, IPHONE, { storageKey: CUSTOMER_APP_MODE_KEY, value: 'live' });
  const operator = await openApp(OPERATOR_URL, IPAD_LANDSCAPE, { storageKey: OPERATOR_APP_MODE_KEY, value: 'live' });
  const hq = await openApp(HQ_URL, DESKTOP);
  const dumpOnFail = async () => {
    await customer.shot('full-loop-customer-FAIL');
    await operator.shot('full-loop-operator-FAIL');
    await hq.shot('full-loop-hq-FAIL');
    await customer.dump('customer at failure');
    await operator.dump('operator at failure');
    await hq.dump('hq at failure');
  };

  try {
    await fillLabel(customer.page, 'Email', guest.email);
    await fillLabel(customer.page, 'Password', guest.password);
    await clickText(customer.page, 'Sign in');
    await waitText(customer.page, 'Weekly Drops', 45_000);
    await customer.shot('01-customer-signed-in');
    await customer.page.goto(`${CUSTOMER_URL}/client/book`, { waitUntil: 'load' });
    await clickLabel(customer.page, 'Pickup order');
    await clickLabel(customer.page, /Havana St/);
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

    const placed = await sql<{ id: string; status: string; total_cents: number; daily_number: number | null; guest_label: string | null }>(
      `select id, status, total_cents, daily_number, guest_label from public.orders
       where brand_id = $1 order by created_at desc limit 1`, [brand.brandId],
    );
    const order = placed.rows[0];
    assert.ok(order, 'the order reached the database');
    assert.ok(order.daily_number, 'the order carries a human-readable ticket');
    assert.equal(order.status, 'created', 'pay_at_pickup waits for staff to collect payment');
    await waitText(customer.page, money(Number(order.total_cents)));

    await fillLabel(operator.page, 'Email', staff.email);
    await fillLabel(operator.page, 'Password', staff.password);
    await clickText(operator.page, 'Sign in');
    await operator.page.waitForURL(/\/staff/, { timeout: 45_000 });
    await operator.page.goto(`${OPERATOR_URL}/staff/orders`, { waitUntil: 'load' });
    await clickOperatorAction(operator.page, order.daily_number, `Collect ${money(Number(order.total_cents))}`);
    await operator.shot('04-operator-board');
    assert.equal(await waitForOrderStatus(order.id, 'paid'), 'paid');
    await clickOperatorAction(operator.page, order.daily_number, 'Start');
    await waitText(customer.page, 'Being made', 30_000);
    await clickOperatorAction(operator.page, order.daily_number, 'Ready');
    await waitText(customer.page, 'Ready for pickup', 30_000);
    await customer.shot('05-customer-ready');
    await clickOperatorAction(operator.page, order.daily_number, 'Picked up');
    assert.equal(await waitForOrderStatus(order.id, 'picked_up'), 'picked_up');

    const rival = await seedRivalBrandOrder();
    const rivalRow = await sql<{ daily_number: number | null; guest_label: string | null }>(
      'select daily_number, guest_label from public.orders where id = $1', [rival.orderId],
    );
    const rivalTicket = rivalRow.rows[0];
    assert.ok(rivalTicket, 'rival order exists');
    const rivalCallOut = ticketCallout(rivalTicket.daily_number, rivalTicket.guest_label);
    await operator.page.goto(`${OPERATOR_URL}/staff/orders`, { waitUntil: 'load' });
    await operator.page.waitForTimeout(4000);
    assert.equal(await operator.page.getByText(rivalCallOut, { exact: true }).count(), 0,
      'another brand’s order must never appear on this board');

    await hq.page.goto(`${HQ_URL}/`, { waitUntil: 'load' });
    await hq.page.waitForURL(/\/login/, { timeout: 30_000 });
    await fillLabel(hq.page, 'Email', staff.email);
    await fillLabel(hq.page, 'Password', staff.password);
    await hq.page.getByRole('button', { name: 'Sign in' }).first().click({ timeout: 20_000 });
    await hq.page.getByRole('heading', { name: 'Network overview' }).waitFor({ timeout: 45_000 });
    const metrics = await sql<{ revenue_cents: string }>(
      `select revenue_cents from public.brand_daily_metrics where brand_id = $1 order by day desc limit 1`, [brand.brandId],
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
}
