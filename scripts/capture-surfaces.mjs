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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'captures');
const base = process.env.DISPLAY_URL ?? 'http://localhost:3200';
const locationId = process.env.BOARD_LOCATION ?? 'loc-downtown';

const kiosk = process.env.KIOSK_URL ?? 'http://localhost:4180';
const operator = process.env.OPERATOR_URL ?? 'http://localhost:4190';
const display = process.env.DISPLAY_URL ?? 'http://localhost:3200';

/** An iPad Pro 11" in landscape, which is what a kiosk stand holds. */
const IPAD_LANDSCAPE = { width: 1366, height: 1024 };


/**
 * Taps a control by the start of its accessibility label and waits.
 *
 * The kiosk's steps past the first are STATEFUL -- /order/options renders
 * nothing without an item chosen -- so a capture cannot simply navigate to a
 * URL. It has to walk the flow the way a guest does, which is also the only
 * way a capture proves the flow works.
 */
async function tap(page, prefix, timeoutMs = 8_000) {
  // Polls rather than assuming: the processing step takes a beat to settle, and
  // a capture that taps into the gap fails for a reason that has nothing to do
  // with the screen being wrong.
  const deadline = Date.now() + timeoutMs;
  let found = false;
  while (!found && Date.now() < deadline) {
    found = await page.evaluate((label) => {
      const button = [...document.querySelectorAll('[role="button"]')]
        .find((candidate) => (candidate.getAttribute('aria-label') || '').startsWith(label));
      if (!button) return false;
      const options = { bubbles: true, cancelable: true, view: window, button: 0 };
      button.dispatchEvent(new PointerEvent('pointerdown', { ...options, pointerId: 1, isPrimary: true }));
      button.dispatchEvent(new MouseEvent('mousedown', options));
      button.dispatchEvent(new PointerEvent('pointerup', { ...options, pointerId: 1, isPrimary: true }));
      button.dispatchEvent(new MouseEvent('mouseup', options));
      button.dispatchEvent(new MouseEvent('click', options));
      return true;
    }, prefix);
    if (!found) await page.waitForTimeout(250);
  }
  if (!found) throw new Error(`no control labelled "${prefix}" on ${page.url()}`);
  await page.waitForTimeout(700);
}

/** Walks from attract into the flow, so a shot of a later step is real. */
const walkTo = (...steps) => async (page) => {
  await tap(page, 'Start an order');
  for (const step of steps) await tap(page, step);
};

const SHOTS = [
  {
    dir: '02-kiosk',
    name: '01-attract',
    url: `${kiosk}/`,
    viewport: IPAD_LANDSCAPE,
    note: 'What the kiosk shows most of its life. The whole surface is the button.',
  },
  {
    dir: '02-kiosk',
    name: '02-entry',
    url: `${kiosk}/`,
    viewport: IPAD_LANDSCAPE,
    note: "The tenant's own first screen: every tile, its size and its order come from brand_config.kiosk, and a shop that configures nothing gets one derived from its menu.",
    prepare: walkTo(),
  },
  {
    dir: '02-kiosk',
    name: '03-options',
    url: `${kiosk}/`,
    viewport: IPAD_LANDSCAPE,
    note: 'Size and options. The Ice group does not exist until the drink is asked for iced, and the action reads what is missing rather than what it does.',
    prepare: walkTo('Signature Lattes', 'Tiramisu Latte', 'Iced'),
  },
  {
    dir: '02-kiosk',
    name: '04-review',
    url: `${kiosk}/`,
    viewport: IPAD_LANDSCAPE,
    note: 'The last look before the bag. Money rides the action, so a choice shows its cost where the hand already is.',
    prepare: walkTo('Signature Lattes', 'Tiramisu Latte', 'Iced', 'Regular Ice', 'Continue'),
  },
  {
    dir: '02-kiosk',
    name: '05-pay',
    url: `${kiosk}/`,
    viewport: IPAD_LANDSCAPE,
    note: "Per-authority tax rows from the tenant's own config, each rounded on its own so the printed rows add up to the printed total.",
    prepare: walkTo('Signature Lattes', 'Tiramisu Latte', 'Iced', 'Regular Ice', 'Continue', 'Add to bag', 'Checkout'),
  },
  {
    dir: '02-kiosk',
    name: '06-done',
    url: `${kiosk}/`,
    viewport: IPAD_LANDSCAPE,
    note: 'The handoff, and the optional attribution question the tenant configured. No button to dismiss: a guest who has paid is already leaving.',
    prepare: walkTo(
      'Signature Lattes', 'Tiramisu Latte', 'Iced', 'Regular Ice', 'Continue',
      'Add to bag', 'Checkout', 'Credit / Debit', 'Continue', 'Skip',
    ),
  },
  {
    dir: '03-pickup-display',
    name: '01-board-wall',
    url: `${display}/board/${locationId}`,
    viewport: { width: 1920, height: 1080 },
    note: 'The wall display at 1080p: two columns, ticket numbers sized to read across a room, a curbside arrival badged.',
  },
  {
    dir: '03-pickup-display',
    name: '02-board-portrait',
    url: `${display}/board/${locationId}`,
    viewport: { width: 1080, height: 1920 },
    note: 'The same board on a portrait-mounted tablet, which is how a small shop usually hangs one.',
  },
  {
    dir: '04-prep-station',
    name: '01-bake-list',
    url: `${operator}/staff/prep`,
    viewport: { width: 1194, height: 834 },
    note: "Today's bake, sorted the way a shift works it: what is in the oven first, then the biggest batch still to start.",
  },
  {
    dir: '04-prep-station',
    name: '02-recipe',
    url: `${operator}/staff/prep`,
    viewport: { width: 1194, height: 834 },
    note: 'A recipe scaled to the batch, with the recipe figure kept beside the scaled one and the allergen banner pinned.',
    prepare: async (page) => {
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('[role="button"]')]
          .find((b) => (b.getAttribute('aria-label') || '').startsWith('Pistachio Milk Cake'));
        btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await page.waitForTimeout(500);
    },
  },
  {
    dir: '05-crew',
    name: '01-roster-and-checklists',
    url: `${operator}/staff/crew`,
    viewport: { width: 1194, height: 834 },
    note: 'Who is on now, who is next, who has gone -- then what the shift still owes, with each tick attributed to a name.',
  },
  {
    dir: '01-customer',
    name: '01-home',
    url: `${process.env.CUSTOMER_URL ?? 'http://localhost:4170'}/`,
    viewport: { width: 430, height: 932 },
    note: 'The guest app. Phone portrait, thumb-reachable.',
  },
];

const failures = [];
const browser = await chromium.launch();
for (const shot of SHOTS) {
  const page = await browser.newPage({ viewport: shot.viewport });
  try {
    // Playwright does NOT throw on a 404, which is how all five committed
    // kiosk captures came to be error pages -- four of them byte-identical --
    // filed under confident captions. Both checks below exist because of that.
    const response = await page.goto(shot.url, { waitUntil: 'networkidle', timeout: 30_000 });
    if (response && !response.ok()) {
      throw new Error(`${response.status()} from ${shot.url}`);
    }
    await page.waitForTimeout(800);
    if (shot.prepare) await shot.prepare(page);
    const rendered = await page.evaluate(() => document.body.innerText.trim());
    if (rendered.length < 8) throw new Error('rendered nothing worth capturing');
    if (/unmatched route|could not be found/i.test(rendered)) {
      throw new Error('landed on a not-found screen');
    }
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
    const serverDown = /ERR_CONNECTION_REFUSED|ECONNREFUSED|net::ERR_/.test(reason);
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
