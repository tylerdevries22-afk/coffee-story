/**
 * Runtime-mode boot. See index.js for why this lives behind a conditional
 * require instead of the unconditional `import 'expo-router/entry'` every
 * tenant build uses: apps/customer/src/tenants/selected.ts and the ~57
 * consumers behind it read their tenant at module load, so the fetched pack
 * has to be on the global before expo-router/entry -- which transitively
 * requires all of them -- is ever required. Nothing here runs unless
 * EXPO_PUBLIC_DEMO_RUNTIME=1, which only a demo web export sets.
 */
import { bannerText, type DemoPack } from './pack';

type PackResponse = DemoPack & {
  readonly businessName: string;
  readonly removeHref: string;
  readonly builder: { readonly name: string; readonly contactHref: string | null };
};

export function isPackResponse(value: unknown): value is PackResponse {
  const source = value as Partial<PackResponse> | null;
  return typeof source === 'object' && source !== null
    && typeof source.businessName === 'string'
    && typeof source.removeHref === 'string'
    && typeof source.builder === 'object' && source.builder !== null
    && typeof source.builder.name === 'string';
}

function textNode(tag: string, body: string): HTMLElement {
  const element = document.createElement(tag);
  element.textContent = body;
  return element;
}

function linkNode(href: string, label: string): HTMLAnchorElement {
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.textContent = label;
  return anchor;
}

/**
 * The mandatory line, non-dismissable, on every screen: who built this, that
 * the business never asked for it, and how to make it go away. A sibling of
 * the app's own root rather than something rendered inside it, so nothing
 * expo-router does to its own tree can ever remove or cover it -- inserted
 * first in `<body>`, in normal document flow, it reserves its own space
 * rather than overlaying anything.
 */
function showBanner(pack: PackResponse): void {
  const banner = document.createElement('div');
  banner.setAttribute('role', 'note');
  banner.setAttribute('aria-label', 'About this demo');
  banner.style.cssText = 'display: flex; flex-wrap: wrap; align-items: center; gap: 6px 20px; '
    + 'padding: 10px 20px; font: 13px/1.5 system-ui, sans-serif; background: #1c1917; color: #fafaf9;';
  const message = textNode('span', bannerText(pack.businessName, pack.builder.name));
  message.style.cssText = 'flex: 1 1 auto; min-width: 200px;';
  const removeLink = linkNode(pack.removeHref, 'Remove my business');
  const overviewLink = linkNode('/d/view', 'Back to overview');
  for (const anchor of [removeLink, overviewLink]) anchor.style.cssText = 'color: #fafaf9; font-weight: 600;';
  banner.append(message, removeLink, overviewLink);
  document.body.insertBefore(banner, document.body.firstChild);
}

/** Never starts the app without a pack: a link back is all this screen offers. */
function showUnavailable(): void {
  const root = document.createElement('div');
  root.style.cssText = 'font: 16px system-ui, sans-serif; max-width: 28rem; margin: 15vh auto; '
    + 'padding: 0 24px; text-align: center;';
  root.append(textNode('p', "This demo isn't available."), linkNode('/d/view', 'Back to overview'));
  document.body.appendChild(root);
}

async function fetchPack(): Promise<PackResponse | null> {
  try {
    const response = await fetch('/d/pack.json', { credentials: 'same-origin' });
    if (!response.ok) {
      console.warn(`Demo pack unavailable (${response.status}).`);
      return null;
    }
    const body: unknown = await response.json();
    if (!isPackResponse(body)) {
      console.warn('Demo pack response was not the expected shape.');
      return null;
    }
    return body;
  } catch (error) {
    console.warn('Demo pack fetch failed.', error instanceof Error ? error.message : error);
    return null;
  }
}

async function boot(): Promise<void> {
  const pack = await fetchPack();
  if (!pack) {
    showUnavailable();
    return;
  }
  globalThis.__PLATFORM_DEMO_PACK__ = pack;
  showBanner(pack);
  require('expo-router/entry');
}

void boot();
