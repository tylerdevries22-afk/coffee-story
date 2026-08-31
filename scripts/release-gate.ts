import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { releaseManifestIssues } from '../packages/factory/src/release';

const index = process.argv.indexOf('--tenant');
const tenant = index >= 0 ? process.argv[index + 1] : undefined;
if (!tenant || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tenant)) {
  console.error('Usage: pnpm release:gate --tenant <slug>');
  process.exit(1);
}

const tenantDirectory = join(process.cwd(), 'tenants', tenant);
const manifestPath = join(tenantDirectory, 'release.json');
const brandPath = join(tenantDirectory, 'brand.json');
const issues: string[] = [];
if (!existsSync(manifestPath)) issues.push(`tenants/${tenant}/release.json is required.`);
if (!existsSync(brandPath)) issues.push(`tenants/${tenant}/brand.json is required.`);

if (existsSync(manifestPath)) {
  try {
    issues.push(...releaseManifestIssues(JSON.parse(readFileSync(manifestPath, 'utf8')), tenant));
  } catch {
    issues.push('release.json must contain valid JSON.');
  }
}
if (existsSync(brandPath)) {
  try {
    const brand = JSON.parse(readFileSync(brandPath, 'utf8')) as {
      identity?: { easProjectId?: unknown; kioskEasProjectId?: unknown };
    };
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (typeof brand.identity?.easProjectId !== 'string' || !uuid.test(brand.identity.easProjectId)) {
      issues.push('brand.json identity.easProjectId must be the tenant customer EAS project UUID.');
    }
    if (typeof brand.identity?.kioskEasProjectId !== 'string' || !uuid.test(brand.identity.kioskEasProjectId)) {
      issues.push('brand.json identity.kioskEasProjectId must be the tenant kiosk EAS project UUID.');
    }
  } catch {
    issues.push('brand.json must contain valid JSON.');
  }
}

if (issues.length > 0) {
  console.error(`Production release for ${tenant} is blocked:`);
  for (const issue of issues) console.error(`  - ${issue}`);
  process.exit(1);
}
console.log(`Production release gate passed for ${tenant}.`);
