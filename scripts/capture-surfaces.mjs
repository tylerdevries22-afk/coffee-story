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
const base = process.env.HQ_URL ?? 'http://localhost:3000';
const locationId = process.env.BOARD_LOCATION ?? 'loc-downtown';

const kiosk = process.env.KIOSK_URL ?? 'http://localhost:4180';

/** An iPad Pro 11" in landscape, which is what a kiosk stand holds. */
const IPAD_LANDSCAPE = { width: 1366, height: 1024 };

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
    name: '02-menu-empty-bag',
    url: `${kiosk}/order`,
    viewport: IPAD_LANDSCAPE,
    note: 'Menu and bag both permanently visible: landscape has room for two things, so a standing guest never loses the menu to see their total.',
  },
  {
    dir: '02-kiosk',
    name: '03-menu-with-bag',
    url: `${kiosk}/order`,
    viewport: IPAD_LANDSCAPE,
    note: 'Two items in. Per-jurisdiction tax rows, and money on the action itself.',
    prepare: async (page) => {
      const tap = async (prefix) => {
        await page.evaluate((p) => {
          const btn = [...document.querySelectorAll('[role="button"]')]
            .find((b) => (b.getAttribute('aria-label') || '').startsWith(p));
          btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }, prefix);
        await page.waitForTimeout(250);
      };
      await tap('Spanish Latte');
      await tap('Pistachio Latte');
      await tap('Pistachio Latte');
    },
  },
  {
    dir: '02-kiosk',
    name: '04-tender',
    url: `${kiosk}/tender`,
    viewport: IPAD_LANDSCAPE,
    note: 'Tender. The card reader is the interaction; this screen exists to say which part of it is happening.',
  },
  {
    dir: '02-kiosk',
    name: '05-receipt',
    url: `${kiosk}/receipt`,
    viewport: IPAD_LANDSCAPE,
    note: 'The handoff: one number, readable while walking away, and no button to dismiss -- a kiosk waiting to be dismissed is out of service until someone notices.',
  },
  {
    dir: '03-pickup-display',
    name: '01-board-wall',
    url: `${base}/board/${locationId}`,
    viewport: { width: 1920, height: 1080 },
    note: 'The wall display at 1080p: two columns, ticket numbers sized to read across a room, a curbside arrival badged.',
  },
  {
    dir: '03-pickup-display',
    name: '02-board-portrait',
    url: `${base}/board/${locationId}`,
    viewport: { width: 1080, height: 1920 },
    note: 'The same board on a portrait-mounted tablet, which is how a small shop usually hangs one.',
  },
];

const browser = await chromium.launch();
for (const shot of SHOTS) {
  const page = await browser.newPage({ viewport: shot.viewport });
  try {
    await page.goto(shot.url, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForTimeout(800);
    if (shot.prepare) await shot.prepare(page);
    const dir = join(ROOT, 'captures', shot.dir);
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: join(dir, `${shot.name}.png`) });
    console.log(`captured ${shot.dir}/${shot.name}.png — ${shot.note}`);
  } catch (err) {
    console.log(`SKIPPED ${shot.dir}/${shot.name}: ${err.message.split('\n')[0]}`);
  }
  await page.close();
}
await browser.close();
