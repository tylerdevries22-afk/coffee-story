/**
 * Regenerates tenants/coffee-story/menu.csv and modifiers.json from the
 * app's menu model (`pnpm emit:menu` from apps/customer). The menu-export
 * sync test fails until this has been run after a catalog or option edit.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { menuCsv, menuModifiersJson } from '../src/data/menu-export';

const tenantDir = join(__dirname, '../../../tenants/coffee-story');
writeFileSync(join(tenantDir, 'menu.csv'), menuCsv());
writeFileSync(join(tenantDir, 'modifiers.json'), menuModifiersJson());
console.log(`Wrote ${tenantDir}/menu.csv and modifiers.json`);
