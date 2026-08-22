/**
 * The typed browser driver — the session scratchpad's drive.mjs, promoted:
 * accessibility-first lookups (the apps label every control), screenshots
 * into E2E_SHOT_DIR on demand and on failure, and a timezone pinned so the
 * local clock reads noon — pickup windows exist whatever UTC hour CI runs
 * at, while epoch time (tokens, realtime) stays real.
 */
import { mkdirSync } from 'node:fs';

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

import { stack } from './stack.ts';

/** Etc/GMT zones have inverted signs: Etc/GMT+5 means UTC-5. */
export function noonTimezone(now = new Date()): string {
  const offset = now.getUTCHours() - 12;
  if (offset === 0) return 'Etc/GMT';
  return offset > 0 ? `Etc/GMT+${offset}` : `Etc/GMT${offset}`;
}

let browser: Browser | null = null;

export async function launchBrowser(): Promise<Browser> {
  browser ??= await chromium.launch({
    ...(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {}),
    args: ['--no-sandbox'],
  });
  return browser;
}

export async function closeBrowser(): Promise<void> {
  await browser?.close();
  browser = null;
}

export type AppPage = {
  page: Page;
  context: BrowserContext;
  shot: (name: string) => Promise<void>;
  /** What this app was showing, into the log: CI artifacts are not always reachable. */
  dump: (name: string) => Promise<void>;
  close: () => Promise<void>;
};

export async function openApp(
  url: string,
  viewport: { width: number; height: number },
): Promise<AppPage> {
  const context = await (await launchBrowser()).newContext({
    viewport,
    timezoneId: noonTimezone(),
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error).slice(0, 300)));
  await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
  const shot = async (name: string) => {
    if (!stack.shotDir) return;
    mkdirSync(stack.shotDir, { recursive: true });
    await page.screenshot({ path: `${stack.shotDir}/${name}.png` }).catch(() => undefined);
  };
  const dump = async (name: string) => {
    const text = await page
      .evaluate(() => document.body?.innerText ?? '')
      .catch(() => '(could not read the page)');
    const lines = [
      `----- ${name} -----`,
      `url: ${page.url()}`,
      `visible text: ${text.replace(/\s+/g, ' ').trim().slice(0, 900)}`,
      errors.length ? `page errors: ${errors.slice(0, 3).join(' | ')}` : 'page errors: none',
      '-'.repeat(20 + name.length),
    ];
    console.error(lines.join('\n'));
  };
  return {
    page,
    context,
    shot,
    dump,
    close: async () => {
      await context.close();
    },
  };
}

/** Click a control by its accessibility label (exact string or pattern). */
export async function clickLabel(page: Page, label: string | RegExp, timeout = 20_000): Promise<void> {
  await page.getByLabel(label).first().click({ timeout });
}

/** Fill the input the given accessibility label names. */
export async function fillLabel(page: Page, label: string | RegExp, value: string): Promise<void> {
  await page.getByLabel(label).first().fill(value, { timeout: 20_000 });
}

export async function clickText(page: Page, text: string | RegExp, timeout = 20_000): Promise<void> {
  await page.getByText(text, { exact: typeof text === 'string' }).first().click({ timeout });
}

export async function waitText(page: Page, text: string | RegExp, timeout = 30_000): Promise<void> {
  await page.getByText(text, { exact: typeof text === 'string' }).first().waitFor({ timeout });
}
