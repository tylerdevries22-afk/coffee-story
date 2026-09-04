/**
 * This build's compiled tenant menu, as bundled JSON.
 *
 * A named export rather than a `menu.json` import site because the menu now
 * lives at `src/tenants/<slug>/menu.json`, one per applied tenant, and a JSON
 * module cannot be re-exported. Asset-free, so `node:test` can reach the
 * catalog without a `.webp` transform.
 */
import { TENANT_SLOT } from '../tenants';

export const TENANT_MENU: unknown = TENANT_SLOT.menu;
