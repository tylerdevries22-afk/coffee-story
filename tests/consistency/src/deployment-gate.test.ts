import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const ROOT = join(process.cwd(), '..', '..');
const deploy = readFileSync(join(ROOT, '.github', 'workflows', 'deploy-hosted.yml'), 'utf8');
const bootstrap = readFileSync(join(ROOT, '.github', 'workflows', 'bootstrap-tenant.yml'), 'utf8');

describe('hosted database promotion gate', () => {
  it('migrates and verifies the target before every deploy path', () => {
    assert.match(deploy, /migrate-database:[\s\S]*?needs: gate/);
    assert.match(deploy, /SUPABASE_DB_PASSWORD:[\s\S]*?required: true/);
    assert.match(deploy, /supabase link --project-ref "\$SUPABASE_PROJECT_REF"/);
    assert.match(deploy, /supabase db push --linked --include-all/);
    assert.match(deploy, /platform_release_readiness/);
    assert.match(deploy, /deploy-hq:[\s\S]*?needs: migrate-database/);
    assert.match(deploy, /publish-native:[\s\S]*?needs: migrate-database/);
  });

  it('bootstraps through the supported credentialed production connection', () => {
    assert.match(bootstrap, /test -n "\$SUPABASE_DB_PASSWORD"/);
    assert.match(bootstrap, /supabase link --project-ref "\$PROJECT_REF"/);
    assert.match(bootstrap, /supabase db push --linked --include-all/);
    assert.match(bootstrap, /supabase db advisors --linked/);
    assert.doesNotMatch(bootstrap, /supabase branches get "\$PROJECT_REF"/);
  });
});
