import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { releaseCommitIssues } from './release-commit';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function write(directory: string, path: string, content: string): void {
  const target = join(directory, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function repository(): { directory: string; source: string } {
  const directory = mkdtempSync(join(tmpdir(), 'release-commit-'));
  git(directory, 'init', '-q');
  git(directory, 'config', 'user.name', 'Release Test');
  git(directory, 'config', 'user.email', 'release@example.test');
  write(directory, 'application.txt', 'approved\n');
  write(directory, 'tenants/coffee-story/release.json', '{"status":"pending"}\n');
  write(directory, 'tenants/stillpoint-builders/release.json', '{"status":"pending"}\n');
  write(directory, 'tenants/_template/release.json', '{"status":"template"}\n');
  git(directory, 'add', '.');
  git(directory, 'commit', '-qm', 'approved source');
  return { directory, source: git(directory, 'rev-parse', 'HEAD') };
}

describe('releaseCommitIssues', () => {
  it('allows a descendant that changes every tenant release approval', () => {
    const { directory, source } = repository();
    write(directory, 'tenants/coffee-story/release.json', '{"status":"approved"}\n');
    write(directory, 'tenants/stillpoint-builders/release.json', '{"status":"approved"}\n');
    git(directory, 'add', 'tenants/coffee-story/release.json',
      'tenants/stillpoint-builders/release.json');
    git(directory, 'commit', '-qm', 'record evidence');
    const target = git(directory, 'rev-parse', 'HEAD');
    assert.deepEqual(releaseCommitIssues(source, target, directory), []);
  });

  it('rejects evidence when deployable source changed after approval', () => {
    const { directory, source } = repository();
    write(directory, 'application.txt', 'changed\n');
    git(directory, 'add', 'application.txt');
    git(directory, 'commit', '-qm', 'change source');
    const target = git(directory, 'rev-parse', 'HEAD');
    assert.match(releaseCommitIssues(source, target, directory)[0] ?? '', /stale/);
  });

  it('treats the release template as deployable source', () => {
    const { directory, source } = repository();
    write(directory, 'tenants/_template/release.json', '{"status":"changed"}\n');
    git(directory, 'add', 'tenants/_template/release.json');
    git(directory, 'commit', '-qm', 'change template');
    const target = git(directory, 'rev-parse', 'HEAD');
    assert.match(releaseCommitIssues(source, target, directory)[0] ?? '', /stale/);
  });

  it('does not hide source renamed into an approval path', () => {
    const { directory, source } = repository();
    mkdirSync(join(directory, 'tenants/new-tenant'));
    git(directory, 'mv', 'application.txt', 'tenants/new-tenant/release.json');
    git(directory, 'commit', '-qm', 'rename source into approval path');
    const target = git(directory, 'rev-parse', 'HEAD');
    assert.match(releaseCommitIssues(source, target, directory)[0] ?? '', /stale/);
  });
});
