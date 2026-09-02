import { parseDeviceWallPolicy, type DeviceWallPolicy } from '@platform/device-wall';

import coffeeStoryPolicy from '../../../tenants/coffee-story/modules/device-wall.json';
import templatePolicy from '../../../tenants/_template/modules/device-wall.json';

const POLICIES: Readonly<Record<string, unknown>> = {
  'coffee-story': coffeeStoryPolicy,
};

/** Unknown tenants inherit the disabled template; policy never escalates by omission. */
export function deviceWallPolicyFor(slug: string | null): DeviceWallPolicy {
  return parseDeviceWallPolicy((slug && POLICIES[slug]) || templatePolicy);
}

export function deviceWallStreamsEnabled(policy: DeviceWallPolicy): boolean {
  return policy.enabled && (policy.rollout === 'owner_beta' || policy.rollout === 'full');
}
