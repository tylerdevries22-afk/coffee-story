import { execFileSync } from 'node:child_process';

const GENERATED_RELEASE_APPROVAL = /^tenants\/[a-z0-9]+(?:-[a-z0-9]+)*\/release\.json$/;

function changedSourcePaths(sourceCommit: string, targetCommit: string, cwd: string): string[] {
  const changed = execFileSync('git', [
    'diff', '--no-renames', '--name-only', '-z', sourceCommit, targetCommit, '--', '.',
  ], { cwd, encoding: 'utf8' });
  return changed.split('\0').filter((path) => path && !GENERATED_RELEASE_APPROVAL.test(path));
}

export function releaseCommitIssues(
  sourceCommit: string,
  targetCommit: string,
  cwd = process.cwd(),
): string[] {
  if (!/^[0-9a-f]{40}$/.test(sourceCommit) || !/^[0-9a-f]{40}$/.test(targetCommit)) return [];
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', sourceCommit, targetCommit], { cwd });
  } catch {
    return ['Release evidence commit must be an ancestor of the deployment commit.'];
  }
  try {
    return changedSourcePaths(sourceCommit, targetCommit, cwd).length > 0
      ? ['Release evidence is stale: deployable source changed after its approved commit.']
      : [];
  } catch {
    return ['Release evidence could not be compared to the deployment source.'];
  }
}
