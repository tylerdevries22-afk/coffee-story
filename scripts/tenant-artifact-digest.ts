import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { tenantArtifactDigest } from '../packages/factory/src/artifact-binding';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const tenant = argument('--tenant');
if (!tenant || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tenant)) {
  console.error('Usage: tsx scripts/tenant-artifact-digest.ts --tenant <slug>');
  process.exit(1);
}

const directory = join(process.cwd(), 'tenants', tenant);
if (!existsSync(directory)) {
  console.error(`Tenant artifact directory does not exist: tenants/${tenant}`);
  process.exit(1);
}

console.log(tenantArtifactDigest(directory));
