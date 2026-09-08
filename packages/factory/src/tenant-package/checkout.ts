import { execFileSync } from 'node:child_process';
import { relative } from 'node:path';

import { TenantPackageError } from './types';

const COMMIT = /^[0-9a-f]{40}$/;

function git(root: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

export function assertImmutableCheckout(input: {
  repositoryRoot: string;
  tenantRoot: string;
  sourceCommit: string;
  requireCi?: boolean;
}): string {
  if (input.requireCi !== false && process.env.CI !== 'true') {
    throw new TenantPackageError('ci_required', 'Tenant packages may be published only from CI.');
  }
  const head = git(input.repositoryRoot, ['rev-parse', 'HEAD']);
  if (!COMMIT.test(head) || !COMMIT.test(input.sourceCommit)) {
    throw new TenantPackageError('commit_invalid', 'Tenant package commit binding is invalid.');
  }
  if (git(input.repositoryRoot, ['status', '--porcelain=v1', '--untracked-files=all'])) {
    throw new TenantPackageError('checkout_dirty', 'Tenant packages require a clean checkout.');
  }
  try {
    git(input.repositoryRoot, ['merge-base', '--is-ancestor', input.sourceCommit, head]);
    const tenantPath = relative(input.repositoryRoot, input.tenantRoot);
    git(input.repositoryRoot, [
      'diff', '--quiet', input.sourceCommit, head, '--', tenantPath,
      `:(exclude)${tenantPath}/release.json`,
    ]);
  } catch {
    throw new TenantPackageError(
      'source_binding_mismatch',
      'Tenant payload differs from the immutable source commit in release.json.',
    );
  }
  return head;
}
