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
const locationId = process.env.BOARD_LOCATION ?? 'loc-downtown';

const kiosk = process.env.KIOSK_URL ?? 'http://localhost:4180';
const operator = process.env.OPERATOR_URL ?? 'http://localhost:4190';
const display = process.env.DISPLAY_URL ?? 'http://localhost:3200';

/** An iPad Pro 11" in landscape, which is what a kiosk stand holds. */
const IPAD_LANDSCAPE = { width: 1366, height: 1024 };

/** Only a refused top-level navigation proves that a surface is not running. */
function isOriginConnectionFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /ERR_CONNECTION_REFUSED|ECONNREFUSED/.test(message);
}

/**
 * Taps a control by the start of its accessibility label and waits.
 *
 * The kiosk's steps past the first are STATEFUL -- /order/options renders
 * nothing without an item chosen -- so a capture cannot simply navigate to a
 * URL. It has to walk the flow the way a guest does, which is also the only
 * way a capture proves the flow works.
 */
async function tap(page, prefix, timeoutMs = 8_000) {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const control = page.getByRole('button', { name: new RegExp(`^${escaped}`) }).first();
  try {
    await control.click({ timeout: timeoutMs });
  } catch {
    throw new Error(`no control labelled "${prefix}" on ${page.url()}`);
  }
  await page.waitForTimeout(700);
}

/** Walks from attract into the flow, so a shot of a later step is real. */
const walkTo = (...steps) => async (page) => {
  await tap(page, 'Start an order');
  for (const step of steps) await tap(page, step);
};

/** The route stage stays full-width; the cart is the one intentional overlay. */
async function assertFullWidthKioskStage(page) {
  const bounds = await page.getByTestId('kiosk-full-screen-stage').boundingBox();
  const viewport = page.viewportSize();
  if (!bounds || !viewport) throw new Error('kiosk full-screen stage is missing');
  if (Math.abs(bounds.x) > 1 || Math.abs(bounds.width - viewport.width) > 1) {
    throw new Error(`kiosk stage is ${Math.round(bounds.width)}px wide in a ${viewport.width}px viewport`);
  }
}

/** Known tenant slugs must render their bundled customer photographs on web. */
async function assertLoadedMenuMedia(page, minimum) {
  await page.waitForFunction((count) => {
    const images = [...document.querySelectorAll('[data-expoimage="true"] img')];
    return images.filter((image) => image.complete && image.naturalWidth > 0).length >= count;
  }, minimum, { timeout: 8_000 });
}

async function assertDarkCartButton(page) {
  const button = await page.getByTestId('kiosk-cart-button').boundingBox();
  if (!button) throw new Error('kiosk cart control is missing');
  if (button.width < 60 || button.height < 60) throw new Error('kiosk cart control is smaller than 60px');
  const darkControl = await page.getByTestId('kiosk-cart-button').evaluate((element) => {
    const match = getComputedStyle(element).backgroundColor.match(/[\d.]+/g);
    if (!match || match.length < 3) return false;
    const [red, green, blue] = match.slice(0, 3).map(Number);
    return (red + green + blue) / 3 < 80;
  });
  if (!darkControl) throw new Error('kiosk cart control is not rendered with dark ink');
}

/** The black cart control opens a bounded rail anchored to the right edge. */
async function assertCartDrawer(page) {
  await assertDarkCartButton(page);
  const viewport = page.viewportSize();
  const drawer = await page.getByTestId('kiosk-cart-drawer').boundingBox();
  if (!viewport || !drawer) throw new Error('kiosk cart drawer is missing');
  if (drawer.x <= viewport.width / 2 || drawer.width >= viewport.width || Math.abs(drawer.x + drawer.width - viewport.width) > 1) {
    throw new Error(`cart drawer is not a right-side rail (${Math.round(drawer.x)}, ${Math.round(drawer.width)})`);
  }
  const closeFocused = await page.getByTestId('kiosk-cart-close-button').evaluate(
    (element) => document.activeElement === element,
  );
  if (!closeFocused) throw new Error('cart drawer did not move keyboard focus to its Close control');
  await page.keyboard.press('Shift+Tab');
  const backwardFocusContained = await page.getByTestId('kiosk-cart-drawer').evaluate(
    (element) => element.contains(document.activeElement),
  );
  if (!backwardFocusContained) throw new Error('cart drawer let backward keyboard focus escape');
  await page.keyboard.press('Tab');
  const forwardFocusContained = await page.getByTestId('kiosk-cart-drawer').evaluate(
    (element) => element.contains(document.activeElement),
  );
  if (!forwardFocusContained) throw new Error('cart drawer let forward keyboard focus escape');
  if (await page.getByRole('button', { name: /^Remove / }).count() === 0) {
    throw new Error('cart drawer does not announce its quantity-one removal action');
  }
}

async function dismissCartWithEscape(page) {
  await page.keyboard.press('Escape');
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="kiosk-cart-drawer"]'),
    undefined,
    { timeout: 8_000 },
  );
  const cartFocused = await page.getByTestId('kiosk-cart-button').evaluate(
    (element) => document.activeElement === element,
  );
  if (!cartFocused) throw new Error('cart drawer did not restore focus to the black Cart control');
}

/** Setup cannot hide its single launch action below the physical screen. */
async function assertPairingControlsFit(page) {
  const viewport = page.viewportSize();
  const action = await page.getByRole('button', { name: 'Pair this kiosk' }).boundingBox();
  if (!viewport || !action || action.y + action.height > viewport.height) {
    throw new Error('pairing action is outside the kiosk viewport');
  }
  const controls = await page.getByRole('button').all();
  for (const control of controls) {
    const bounds = await control.boundingBox();
    if (!bounds || bounds.width < 60 || bounds.height < 60) {
      throw new Error('pairing control is smaller than the 60px kiosk target');
    }
  }
}

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
    minimumMenuImages: 7,
  },
  {
    dir: '02-kiosk',
    name: '03-options',
    url: `${kiosk}/`,
    viewport: IPAD_LANDSCAPE,
    note: 'Size and options. The Ice group does not exist until the drink is asked for iced, and the action reads what is missing rather than what it does.',
    prepare: walkTo('Signature Lattes', 'Tiramisu Latte', 'Iced'),
    minimumMenuImages: 1,
  },
  {
    dir: '02-kiosk',
    name: '04-review',
    url: `${kiosk}/`,
    viewport: IPAD_LANDSCAPE,
    note: 'The last look before the bag. Money rides the action, so a choice shows its cost where the hand already is.',
    prepare: walkTo('Signature Lattes', 'Tiramisu Latte', 'Iced', 'Regular Ice', 'Continue'),
    minimumMenuImages: 1,
  },
  {
    dir: '02-kiosk',
    name: '05-cart',
    url: `${kiosk}/`,
    viewport: IPAD_LANDSCAPE,
    note: 'The black cart control opens a right-side rail over the menu, with the same item photograph, editable quantity, exact tax rows and checkout total.',
    prepare: async (page) => {
      await walkTo(
        'Signature Lattes', 'Tiramisu Latte', 'Iced', 'Regular Ice', 'Continue', 'Add to cart',
      )(page);
      await assertCartDrawer(page);
    },
    minimumMenuImages: 1,
  },
  {
    dir: '02-kiosk',
    name: '05-cart-button',
    url: `${kiosk}/`,
    viewport: IPAD_LANDSCAPE,
    note: 'After the rail closes, the dark cart control remains in the top-right chrome with its item count and total.',
    prepare: async (page) => {
      await walkTo(
        'Signature Lattes', 'Tiramisu Latte', 'Iced', 'Regular Ice', 'Continue',
        'Add to cart', 'Keep shopping',
      )(page);
      await assertDarkCartButton(page);
      await tap(page, 'Cart, 1 item');
      await assertCartDrawer(page);
      await dismissCartWithEscape(page);
      await assertDarkCartButton(page);
    },
    minimumMenuImages: 7,
  },
  {
    dir: '02-kiosk',
    name: '05-pay',
    url: `${kiosk}/`,
    viewport: IPAD_LANDSCAPE,
    note: "Per-authority tax rows from the tenant's own config, each rounded on its own so the printed rows add up to the printed total.",
    prepare: walkTo(
      'Signature Lattes', 'Tiramisu Latte', 'Iced', 'Regular Ice', 'Continue',
      'Add to cart', 'Checkout', 'No tip', 'Continue',
    ),
  },
  {
    dir: '02-kiosk',
    name: '06-done',
    url: `${kiosk}/`,
    viewport: IPAD_LANDSCAPE,
    note: 'The pay-at-counter handoff and optional attribution question fill the kiosk stage, with one explicit reset for the next guest.',
    prepare: walkTo(
      'Signature Lattes', 'Tiramisu Latte', 'Iced', 'Regular Ice', 'Continue',
      'Add to cart', 'Checkout', 'No tip', 'Continue', 'Pay at the counter', 'Skip', 'Continue',
    ),
  },
  {
    dir: '02-kiosk',
    name: '07-pairing',
    url: `${kiosk}/pair`,
    viewport: IPAD_LANDSCAPE,
    note: 'First-run setup keeps every 64pt key and the Pair action inside the landscape kiosk viewport.',
    prepare: assertPairingControlsFit,
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
      await page.getByRole('button', { name: /^Pistachio Milk Cake/ }).first().click();
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
