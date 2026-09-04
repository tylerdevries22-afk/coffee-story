import { parseDeviceWallPolicy, type DeviceWallPolicy } from '@platform/device-wall';

import coffeeStoryPolicy from '../../../tenants/coffee-story/modules/device-wall.json';
import templatePolicy from '../../../tenants/_template/modules/device-wall.json';

const POLICIES: Readonly<Record<string, unknown>> = {
  'coffee-story': coffeeStoryPolicy,
};

/**
 * Unknown tenants inherit the disabled template; policy never escalates by omission.
 *
 * `Object.hasOwn` and not a truthiness test, for the reason `selectTenantSlot`
 * documents: a bare index reaches the prototype chain, so a slug of
 * `constructor` resolved to `Object` here -- truthy, so the `||` fallback never
 * fired and a function was parsed as a policy.
 */
export function deviceWallPolicyFor(slug: string | null): DeviceWallPolicy {
  const own = slug !== null && Object.hasOwn(POLICIES, slug) ? POLICIES[slug] : undefined;
  return parseDeviceWallPolicy(own ?? templatePolicy);
}

export function deviceWallStreamsEnabled(policy: DeviceWallPolicy): boolean {
  return policy.enabled && (policy.rollout === 'owner_beta' || policy.rollout === 'full');
}
