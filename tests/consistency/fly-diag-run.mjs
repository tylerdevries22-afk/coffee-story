// Temporary diagnostic driver for one Fly run (not for merging). Mission
// Control keeps only the last four output lines matching /error:/ of a failed
// check, so this runs every workspace's tests without stopping at the first
// failure and prints three compact "error:" lines: the tools missing on the
// worker, the workspaces whose tests failed, and the failing consistency
// test files.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const env = { ...process.env, EXPO_PUBLIC_TENANT: process.env.EXPO_PUBLIC_TENANT || 'coffee-story' };
const run = (cmd, args, options = {}) => spawnSync(cmd, args, { env, encoding: 'utf8', maxBuffer: 1 << 28, ...options });

const TOOLS = ['jq', 'curl', 'zip', 'unzip', 'xxd', 'file', 'perl', 'openssl', 'flock', 'timeout', 'sha256sum',
  'python3', 'bash', 'awk', 'base64', 'envsubst', 'rsync', 'sqlite3', 'psql', 'gh', 'docker', 'ruby'];
const missing = TOOLS.filter((tool) => run('sh', ['-c', `command -v ${tool}`]).status !== 0);

const failed = [];
if (run('pnpm', ['test:scripts']).status !== 0) failed.push('test:scripts');

const listing = run('pnpm', ['-r', 'ls', '--depth', '-1', '--json']);
const packages = JSON.parse(listing.stdout || '[]');
let consistency = '';
for (const pkg of packages) {
  const manifest = JSON.parse(readFileSync(join(pkg.path, 'package.json'), 'utf8'));
  if (!manifest.scripts?.test || pkg.path === process.cwd()) continue;
  const short = (pkg.name ?? basename(pkg.path)).replace(/^@platform\//, '');
  if (short === 'consistency-tests') {
    const result = run('pnpm', ['exec', 'tsx', '--test', '--test-reporter=./fly-diag.mjs', 'src/**/*.test.ts'], { cwd: pkg.path });
    if (result.status !== 0) failed.push(short);
    consistency = (result.stdout.match(/^files=.*$/m) ?? [''])[0];
    continue;
  }
  if (run('pnpm', ['run', 'test'], { cwd: pkg.path }).status !== 0) failed.push(short);
}

console.log(`error: jq=${process.env.JQ_SETUP ?? '-'} node=${process.version} missing=${missing.join(',') || 'none'} pkgs=${packages.length}`);
console.log(`error: failed=${failed.join(',') || 'none'}`);
console.log(`error: cons ${consistency}`);
process.exit(1);
