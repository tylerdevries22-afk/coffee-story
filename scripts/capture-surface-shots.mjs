import {
  assertCartDrawer,
  assertDarkCartButton,
  assertPairingControlsFit,
  dismissCartWithEscape,
  tap,
  walkTo,
} from './capture-surface-actions.mjs';

/** An iPad Pro 11" in landscape, which is what a kiosk stand holds. */
const IPAD_LANDSCAPE = { width: 1366, height: 1024 };

export function captureShots({ kiosk, operator, display, customer, locationId }) {
  return [
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
    url: `${customer}/`,
    viewport: { width: 430, height: 932 },
    note: 'The guest app. Phone portrait, thumb-reachable.',
  },
];
}
