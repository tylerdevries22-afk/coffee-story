import assert from 'node:assert/strict';
import type { Page } from 'playwright';

const CUSTOMER_ROUTES = [
  '/client/home', '/client/rewards', '/client/gift', '/client/more',
  '/client/more/catering', '/client/more/drops', '/client/more/faq',
  '/client/more/gift-balance', '/client/more/location', '/client/more/membership',
  '/client/more/menu-prices', '/client/more/messages', '/client/more/order-policy',
  '/client/more/orders', '/client/more/payments', '/client/more/preferences',
  '/client/more/privacy', '/client/more/profile', '/client/more/referrals',
  '/client/more/resources',
] as const;

const OPERATOR_ROUTES = [
  '/staff', '/staff/orders', '/staff/prep', '/staff/calendar',
  '/staff/crew', '/staff/training', '/staff/more',
] as const;

const HQ_ROUTES = [
  '/', '/locations', '/apps', '/apps/customer', '/apps/operator', '/apps/kiosk',
  '/apps/display', '/analytics', '/analytics/apps', '/analytics/commerce',
  '/analytics/operations', '/analytics/training', '/analytics/growth',
  '/analytics/reliability', '/network', '/integrations', '/integrations/connected',
  '/integrations/activity', '/integrations/health', '/operations',
  '/operations/templates', '/operations/schedules', '/operations/history',
  '/operations/reporting', '/operations/retention', '/menu', '/menu/import',
  '/kiosk', '/storage', '/training', '/brand', '/staff', '/fees', '/drops',
  '/campaigns', '/customers', '/knowledge',
] as const;

// A client-rendered route still has an empty <body> when domcontentloaded fires, and the
// locator resolves the moment that element exists. Sampling innerText once therefore races
// hydration and reports a painted page as empty, so poll until text appears.
async function readRenderedText(page: Page, timeoutMs = 20_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let text = await page.locator('body').innerText({ timeout: 20_000 });
  while (text.trim().length === 0 && Date.now() < deadline) {
    await page.waitForTimeout(100);
    text = await page.locator('body').innerText({ timeout: 20_000 });
  }
  return text;
}

async function visitRoutes(page: Page, baseUrl: string, routes: readonly string[]): Promise<void> {
  for (const route of routes) {
    const url = `${baseUrl}${route}`;
    let response = null;
    for (let attempt = 0; attempt < 2 && !response; attempt += 1) {
      try {
        response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      } catch (error) {
        if (attempt > 0 || !String(error).includes('ERR_ABORTED')) throw error;
        await page.waitForTimeout(250);
      }
    }
    assert.ok(response?.ok(), `${route} returned HTTP ${response?.status() ?? 'no response'}`);
    const body = await readRenderedText(page);
    assert.ok(body.trim().length > 0, `${route} rendered an empty document`);
    assert.doesNotMatch(body, /Application error|Internal Server Error/i, `${route} rendered a fatal error`);
    await page.waitForTimeout(100);
  }
}

export function smokeCustomerRoutes(page: Page): Promise<void> {
  return visitRoutes(page, 'http://127.0.0.1:4381', CUSTOMER_ROUTES);
}

export function smokeOperatorRoutes(page: Page): Promise<void> {
  return visitRoutes(page, 'http://127.0.0.1:4382', OPERATOR_ROUTES);
}

export function smokeHqRoutes(page: Page): Promise<void> {
  return visitRoutes(page, 'http://127.0.0.1:4383', HQ_ROUTES);
}
