/** Only a refused top-level navigation proves that a surface is not running. */
export function isOriginConnectionFailure(error) {
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
export async function tap(page, prefix, timeoutMs = 8_000) {
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
export const walkTo = (...steps) => async (page) => {
  await tap(page, 'Start an order');
  for (const step of steps) await tap(page, step);
};

/** The route stage stays full-width; the cart is the one intentional overlay. */
export async function assertFullWidthKioskStage(page) {
  const bounds = await page.getByTestId('kiosk-full-screen-stage').boundingBox();
  const viewport = page.viewportSize();
  if (!bounds || !viewport) throw new Error('kiosk full-screen stage is missing');
  if (Math.abs(bounds.x) > 1 || Math.abs(bounds.width - viewport.width) > 1) {
    throw new Error(`kiosk stage is ${Math.round(bounds.width)}px wide in a ${viewport.width}px viewport`);
  }
}

/** Known tenant slugs must render their bundled customer photographs on web. */
export async function assertLoadedMenuMedia(page, minimum) {
  await page.waitForFunction((count) => {
    const images = [...document.querySelectorAll('[data-expoimage="true"] img')];
    return images.filter((image) => image.complete && image.naturalWidth > 0).length >= count;
  }, minimum, { timeout: 8_000 });
}

export async function assertDarkCartButton(page) {
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
export async function assertCartDrawer(page) {
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

export async function dismissCartWithEscape(page) {
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
export async function assertPairingControlsFit(page) {
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
