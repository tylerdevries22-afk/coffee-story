import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { TenantManifest } from '../../packages/tenant-config/src/index.js';

function privacyPolicyUrl(website: string | undefined): string {
  if (!website) return '';
  try {
    const origin = new URL(website);
    return origin.protocol === 'https:' ? new URL('/privacy-policy', origin).toString() : '';
  } catch {
    return '';
  }
}

export function writeAppStoreListing(
  tenantDir: string, slug: string, brand: TenantManifest, business: Record<string, string>,
): void {
  const output = join(tenantDir, 'app-store');
  mkdirSync(output, { recursive: true });
  const points = brand.copy.pointsName ?? 'Points';
  const construction = /construction|builder|renovation/i.test(business.industry ?? '');
  if (construction) {
    writeConstructionListing(output, slug, brand, business);
    return;
  }
  writeCommerceListing(output, slug, brand, business, points);
}

function writeConstructionListing(
  output: string, slug: string, brand: TenantManifest, business: Record<string, string>,
): void {
  writeFileSync(join(output, 'listing.md'), `# ${brand.identity.name} — App Store listing draft

**Subtitle (30 chars):** Projects. Teams. Progress.

**Promotional text:** Plan work, review milestones, approve changes, and stay connected to your
${brand.identity.name} project team from first consultation through warranty.

**Description:**

Keep every construction project moving from one secure workspace. Clients can review project
packages, follow key milestones, approve change orders, manage payments, and find handoff and
warranty information. Field teams get the current standards, training, and project context they
need to deliver consistent work.

- Explore construction and renovation services
- Track project milestones and decisions
- Review estimates, change orders, deposits, and progress draws
- Access approved project documents and warranty information

**Keywords:** construction,renovation,project management,client portal,${slug}

**Category:** Business

**Support URL:** ${business.website ?? ''}

**Privacy policy URL:** ${privacyPolicyUrl(business.website)}

Publish a counsel-reviewed copy of docs/legal/privacy-policy.md at the privacy policy URL above.
`);
  writeFileSync(join(output, 'screenshots-checklist.md'), `# Screenshots checklist — ${brand.identity.name}

Capture on the 6.9" and 6.5" iPhone simulators. Light mode, demo data, full status bar.

- [ ] Home with active project milestone and team contact
- [ ] Project catalog with planning and renovation packages
- [ ] Package detail with consultation or estimate action
- [ ] Project timeline with current milestone
- [ ] Change-order review and approval
- [ ] Payment schedule with deposit and progress draws
- [ ] Field knowledge article and required acknowledgement
- [ ] Training assignment with completion status

Rules: use only approved ${brand.identity.name} project data and tenant-owned artwork.
`);
  console.log(`4. listing: construction listing.md + screenshots-checklist.md -> ${output}`);
}

function writeCommerceListing(
  output: string, slug: string, brand: TenantManifest, business: Record<string, string>, points: string,
): void {
  writeFileSync(join(output, 'listing.md'), `# ${brand.identity.name} — App Store listing draft

**Subtitle (30 chars):** Order ahead. Earn ${points}.

**Promotional text:** ${brand.copy.orderCta ?? 'Start an order'} from your phone — skip the line,
earn ${points} on every purchase, and catch every limited drop before it's gone.

**Description:**

${brand.identity.name} in your pocket. Order ahead for pickup, customize every
drink exactly how you take it, and pay in seconds. Earn ${points} on every
order and trade them for the drinks you love. Limited drops land first in the
app — with a countdown, so you never miss one.

- Order ahead, skip the line
- ${points} rewards on every purchase
- Limited drops with live countdowns
- Gift cards you can send in a minute
${brand.features.catering ? '- Catering requests for your events\n' : ''}
**Keywords:** coffee,order ahead,rewards,pickup,${slug}

**Category:** Food & Drink

**Support URL:** ${business.website ?? ''}

**Privacy policy URL:** ${privacyPolicyUrl(business.website)}

Fill in the marketing URL before submission. Publish a counsel-reviewed copy
of docs/legal/privacy-policy.md at the privacy policy URL above.
`);
  writeFileSync(join(output, 'screenshots-checklist.md'), `# Screenshots checklist — ${brand.identity.name}

Capture on the 6.9" and 6.5" iPhone simulators. Light mode, demo data, full status bar.

- [ ] Home with the live drop hero and countdown
- [ ] Menu, one category open, an 86'd item visible
- [ ] Item sheet with options and the price moving on the button
- [ ] Bag with two lines and the earn banner
- [ ] Checkout with tax and ${points} redemption
- [ ] Order tracking on "Being made"
- [ ] Rewards screen with the meter partly filled
- [ ] Gift card send flow, first screen

Rules: no competitor's name or artwork anywhere in frame; only this brand's assets.
`);
  console.log(`4. listing: listing.md + screenshots-checklist.md -> tenants/${slug}/app-store/`);
}
