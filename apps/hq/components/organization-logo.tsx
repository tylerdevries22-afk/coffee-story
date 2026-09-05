import Image from 'next/image';
import type { StaticImageData } from 'next/image';

import coffeeStoryLogo from '../../../tenants/coffee-story/assets/logo.png';
import stillpointLogo from '../../../tenants/stillpoint-builders/app-store/generated/icon.png';

type OrganizationLogoProps = {
  readonly id: string;
  readonly name: string;
  readonly compact?: boolean;
};

const TENANT_LOGOS: readonly { keys: readonly string[]; image: StaticImageData }[] = [
  { keys: ['coffee story'], image: coffeeStoryLogo },
  { keys: ['stillpoint-builders', 'stillpoint builders'], image: stillpointLogo },
];

function tenantLogo(id: string, name: string): StaticImageData | null {
  const keys = [id.toLowerCase(), name.toLowerCase()];
  return TENANT_LOGOS.find((entry) => entry.keys.some((key) => keys.includes(key)))?.image ?? null;
}

export function OrganizationLogo({ id, name, compact = false }: OrganizationLogoProps) {
  const image = tenantLogo(id, name);
  const className = `scope-organization-logo${compact ? ' compact' : ''}`;
  return image
    ? <Image className={className} src={image} alt="" aria-hidden="true" sizes={compact ? '28px' : '34px'} />
    : <span className={`${className} fallback`} aria-hidden="true">{name.trim().charAt(0).toUpperCase()}</span>;
}
