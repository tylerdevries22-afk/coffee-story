import type { BundledTenantMenu } from '@platform/schema';

import { nonEmptyString, objectRecord } from './onboard-json.js';

type Reachability = { valid: boolean; reachesPack: boolean; utilityOnly: boolean };

function auditTarget(
  value: unknown, menu: BundledTenantMenu, packSlugs: ReadonlySet<string>, depth: number,
): Reachability {
  const target = objectRecord(value);
  if (!target) return { valid: false, reachesPack: false, utilityOnly: false };
  if (target.kind === 'utility') {
    return { valid: nonEmptyString(target.utility), reachesPack: false, utilityOnly: true };
  }
  if (target.kind === 'item' && nonEmptyString(target.itemSlug)) {
    const valid = menu.items.some((item) => item.id === target.itemSlug);
    return { valid, reachesPack: valid && packSlugs.has(target.itemSlug), utilityOnly: false };
  }
  if (target.kind === 'category' && nonEmptyString(target.categoryId)) {
    const category = menu.categories.find((candidate) => candidate.title === target.categoryId);
    const reachesPack = category !== undefined && menu.items.some(
      (item) => item.category === category.id && packSlugs.has(item.id),
    );
    return { valid: category !== undefined, reachesPack, utilityOnly: false };
  }
  if (target.kind !== 'group' || depth > 0 || !Array.isArray(target.nodes)) {
    return { valid: false, reachesPack: false, utilityOnly: false };
  }
  const children = target.nodes.map((node) => auditNode(node, menu, packSlugs, depth + 1));
  const validChildren = children.filter((child) => child.valid);
  const nonUtility = validChildren.filter((child) => !child.utilityOnly);
  return {
    valid: validChildren.length > 0,
    reachesPack: nonUtility.length > 0 && nonUtility.every((child) => child.reachesPack),
    utilityOnly: validChildren.length > 0 && validChildren.every((child) => child.utilityOnly),
  };
}

function auditNode(
  value: unknown, menu: BundledTenantMenu, packs: ReadonlySet<string>, depth = 0,
): Reachability {
  const node = objectRecord(value);
  if (!node || !nonEmptyString(node.id) || !nonEmptyString(node.label)) {
    return { valid: false, reachesPack: false, utilityOnly: false };
  }
  return auditTarget(node.target, menu, packs, depth);
}

export function validatePackFlow(
  config: unknown, menu: BundledTenantMenu, problems: string[],
): void {
  const kiosk = objectRecord(config);
  if (kiosk?.family !== 'pack') return;
  const packs = new Set(menu.items.filter((item) => item.packSize !== undefined).map((item) => item.id));
  if (packs.size === 0) {
    problems.push('brand.json: kiosk.family is "pack", but packs.json defines no usable pack.');
    return;
  }
  const nodes = objectRecord(kiosk.entry)?.nodes;
  if (!Array.isArray(nodes) || nodes.length === 0) return;
  const dead = nodes.map((node) => auditNode(node, menu, packs)).flatMap((target, index) => (
    target.valid && !target.utilityOnly && !target.reachesPack ? [index + 1] : []
  ));
  if (dead.length > 0) {
    problems.push(`brand.json: kiosk pack flow entry tile${dead.length === 1 ? '' : 's'} ${dead.join(', ')} cannot reach an item from packs.json.`);
  }
}
