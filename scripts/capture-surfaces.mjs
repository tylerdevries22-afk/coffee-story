/**
 * Captures our own five surfaces.
 *
 * Separate from the reference capture on purpose: `reference/` is observed,
 * `captures/` is built, and nothing moves between them. Each surface names the
 * server it needs; a surface whose server is not running is skipped loudly
 * rather than silently producing an empty folder.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertFullWidthKioskStage, assertLoadedMenuMedia, isOriginConnectionFailure } from './capture-surface-actions.mjs';
import { captureShots } from './capture-surface-shots.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'captures');
const locationId = process.env.BOARD_LOCATION ?? 'loc-downtown';

const kiosk = process.env.KIOSK_URL ?? 'http://localhost:4180';
const operator = process.env.OPERATOR_URL ?? 'http://localhost:4190';
const display = process.env.DISPLAY_URL ?? 'http://localhost:3200';

const SHOTS = captureShots({
  kiosk,
  operator,
  display,
  customer: process.env.CUSTOMER_URL ?? 'http://localhost:4170',
  locationId,
});

const failures = [];
const requested = new Set((process.env.CAPTURE_ONLY ?? '').split(',').map((value) => value.trim()).filter(Boolean));
const selectedShots = requested.size === 0
  ? SHOTS
  : SHOTS.filter((shot) => requested.has(shot.name) || requested.has(`${shot.dir}/${shot.name}`));
if (requested.size > 0 && selectedShots.length === 0) {
  throw new Error(`CAPTURE_ONLY did not match a capture: ${[...requested].join(', ')}`);
}
const browser = await chromium.launch();
for (const shot of selectedShots) {
  const page = await browser.newPage({ viewport: shot.viewport });
  const pageErrors = [];
  let topLevelOriginConnectionFailure = false;
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') pageErrors.push(message.text());
  });
  page.on('requestfailed', (request) => {
    const failure = request.failure();
    pageErrors.push(`request failed: ${failure?.errorText ?? 'unknown error'} (${request.url()})`);
  });
  try {
    // Playwright does NOT throw on a 404, which is how all five committed
    // kiosk captures came to be error pages -- four of them byte-identical --
    // filed under confident captions. Both checks below exist because of that.
    // Expo's dev server keeps framework connections open, so `networkidle`
    // never arrives even when the screen is fully rendered. DOM readiness plus
    // visible body copy is the contract these captures actually need.
    let response;
    try {
      response = await page.goto(shot.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    } catch (navigationError) {
      topLevelOriginConnectionFailure = isOriginConnectionFailure(navigationError);
      throw navigationError;
    }
    if (response && !response.ok()) {
      throw new Error(`${response.status()} from ${shot.url}`);
    }
    await page.waitForFunction(
      () => document.body.innerText.trim().length >= 8,
      undefined,
      { timeout: 30_000 },
    );
    await page.waitForTimeout(800);
    if (shot.prepare) await shot.prepare(page);
    if (shot.dir === '02-kiosk' && shot.name !== '01-attract') {
      await assertFullWidthKioskStage(page);
    }
    if (shot.minimumMenuImages) await assertLoadedMenuMedia(page, shot.minimumMenuImages);
    const rendered = await page.evaluate(() => document.body.innerText.trim());
    if (rendered.length < 8) throw new Error('rendered nothing worth capturing');
    if (/unmatched route|could not be found/i.test(rendered)) {
      throw new Error('landed on a not-found screen');
    }
    if (pageErrors.length > 0) throw new Error(`browser error: ${pageErrors[0]}`);
    const dir = join(OUT, shot.dir);
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: join(dir, `${shot.name}.png`) });
    console.log(`captured ${shot.dir}/${shot.name}.png — ${shot.note}`);
  } catch (err) {
    const reason = err.message.split('\n')[0];
    // A surface whose server is not up is skipped loudly, which is this
    // script's documented behaviour. A surface whose server IS up and served
    // something broken is a failure -- that distinction is the whole point,
    // because the committed kiosk captures were error pages from a live server.
    const serverDown = topLevelOriginConnectionFailure;
    if (!serverDown) failures.push(`${shot.dir}/${shot.name}: ${reason}`);
    console.log(`${serverDown ? 'SKIPPED' : 'FAILED '} ${shot.dir}/${shot.name}: ${reason}`);
  }
  await page.close();
}
await browser.close();

// A partial run used to look like a successful one. It exits non-zero now, so
// a capture that silently stopped matching the product is a failure rather
// than a line in a log nobody reads.
if (failures.length > 0) {
  console.error(`\n${failures.length} capture(s) failed:`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exitCode = 1;
}
