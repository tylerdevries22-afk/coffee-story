import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { tenantArtifactDigest } from '../packages/factory/src/artifact-binding';
import { easProjectIssues, releaseBinding, releaseManifestIssues } from '../packages/factory/src/release';
import { releaseCommitIssues } from './release-commit';
import { tenantReleaseSurfacePlan } from './release-surfaces';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function deployedCommit(): string {
  const supplied = argument('--commit') ?? process.env.GITHUB_SHA;
  if (supplied) return supplied.trim();
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

const tenant = argument('--tenant');
if (!tenant || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tenant)) {
  console.error('Usage: pnpm release:gate --tenant <slug>');
  process.exit(1);
}

const tenantDirectory = join(process.cwd(), 'tenants', tenant);
const manifestPath = join(tenantDirectory, 'release.json');
const brandPath = join(tenantDirectory, 'brand.json');
const issues: string[] = [];
const commitSha = deployedCommit();
const artifactDigest = existsSync(tenantDirectory) ? tenantArtifactDigest(tenantDirectory) : '';
const expectedDigest = argument('--artifact-digest') ?? process.env.FACTORY_ARTIFACT_DIGEST;
if (!/^[0-9a-f]{40}$/.test(commitSha)) issues.push('A full lowercase deployment commit SHA is required.');
if (!expectedDigest || !/^sha256:[0-9a-f]{64}$/.test(expectedDigest)) {
  issues.push('A verified factory artifact digest is required.');
} else if (expectedDigest !== artifactDigest) {
  issues.push('The verified factory artifact digest does not match this checkout.');
}
if (!existsSync(manifestPath)) issues.push(`tenants/${tenant}/release.json is required.`);
if (!existsSync(brandPath)) issues.push(`tenants/${tenant}/brand.json is required.`);

if (existsSync(manifestPath)) {
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown;
    issues.push(...releaseManifestIssues(manifest, tenant, {
      expectedArtifactDigest: artifactDigest,
    }));
    const binding = releaseBinding(manifest);
    if (binding && /^[0-9a-f]{40}$/.test(commitSha)) {
      issues.push(...releaseCommitIssues(binding.commitSha, commitSha));
    }
  } catch {
    issues.push('release.json must contain valid JSON.');
  }
}
if (existsSync(brandPath)) {
  try {
    const brand = JSON.parse(readFileSync(brandPath, 'utf8')) as { identity?: unknown };
    const surfacePlan = tenantReleaseSurfacePlan(tenantDirectory, tenant);
    issues.push(...surfacePlan.issues);
    issues.push(...easProjectIssues(brand.identity, surfacePlan.all));
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
