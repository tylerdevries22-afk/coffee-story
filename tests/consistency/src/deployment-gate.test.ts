import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const ROOT = join(process.cwd(), '..', '..');
const deploy = readFileSync(join(ROOT, '.github', 'workflows', 'deploy-hosted.yml'), 'utf8');
const bootstrap = readFileSync(join(ROOT, '.github', 'workflows', 'bootstrap-tenant.yml'), 'utf8');
const verify = readFileSync(join(ROOT, '.github', 'workflows', 'verify.yml'), 'utf8');

describe('hosted database promotion gate', () => {
  it('migrates and verifies the target before every deploy path', () => {
    assert.match(deploy, /migrate-database:[\s\S]*?needs: gate/);
    assert.doesNotMatch(deploy, /SUPABASE_DB_PASSWORD/);
    assert.match(deploy, /pnpm supabase:promote/);
    assert.match(deploy, /EXPECTED_RELEASE_READINESS: '20260828163000'/);
    assert.match(deploy, /deploy-hq:[\s\S]*?needs: migrate-database/);
    assert.match(deploy, /publish-native:[\s\S]*?needs: migrate-database/);
  });

  it('bootstraps through the passwordless Management API promotion path', () => {
    assert.doesNotMatch(bootstrap, /SUPABASE_DB_PASSWORD/);
    assert.match(bootstrap, /pnpm supabase:promote/);
    assert.match(bootstrap, /supabase\/setup-cli@v3/);
    assert.match(bootstrap, /SUPABASE_PROJECT_REF: \$\{\{ inputs\.supabase_project_ref \}\}/);
    assert.doesNotMatch(bootstrap, /supabase branches get "\$PROJECT_REF"/);
  });

  it('isolates hosted integration tests from Git-managed preview branches', () => {
    assert.match(verify, /branch_name="ci-\$\{GITHUB_RUN_ID\}-\$\{GITHUB_RUN_ATTEMPT\}"/);
    assert.doesNotMatch(verify, /--git-branch/);
    assert.doesNotMatch(verify, /GITHUB_HEAD_REF/);
    assert.match(verify, /\*'Resource has been removed'\*\) ;;/);
  });
});
