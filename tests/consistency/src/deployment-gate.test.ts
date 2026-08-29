import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const ROOT = join(process.cwd(), '..', '..');
const deploy = readFileSync(join(ROOT, '.github', 'workflows', 'deploy-hosted.yml'), 'utf8');
const bootstrap = readFileSync(join(ROOT, '.github', 'workflows', 'bootstrap-tenant.yml'), 'utf8');
const verify = readFileSync(join(ROOT, '.github', 'workflows', 'verify.yml'), 'utf8');
const simulators = readFileSync(join(ROOT, '.github', 'workflows', 'simulators.yml'), 'utf8');
const migrationRunner = readFileSync(join(ROOT, 'scripts', 'hosted-migrations.ts'), 'utf8');

describe('hosted database promotion gate', () => {
  it('migrates and verifies the target before every deploy path', () => {
    assert.match(deploy, /migrate-database:[\s\S]*?needs: gate/);
    assert.doesNotMatch(deploy, /SUPABASE_DB_PASSWORD/);
    assert.match(deploy, /pnpm supabase:promote/);
    assert.doesNotMatch(deploy, /EXPECTED_RELEASE_READINESS/);
    assert.match(migrationRunner, /const latestVersion = local\.at\(-1\)\?\.version/);
    assert.match(migrationRunner, /Release readiness must match the newest local migration version/);
    assert.match(deploy, /deploy-hq:[\s\S]*?needs: migrate-database/);
    assert.match(deploy, /publish-native:[\s\S]*?needs: migrate-database/);
  });

  it('bootstraps through the passwordless Management API promotion path', () => {
    assert.doesNotMatch(bootstrap, /SUPABASE_DB_PASSWORD/);
    assert.match(bootstrap, /pnpm supabase:promote/);
    // Pinned to an immutable SHA; the trailing comment carries the readable version.
    assert.match(bootstrap, /supabase\/setup-cli@[0-9a-f]{40} # v3\./);
    assert.match(bootstrap, /SUPABASE_PROJECT_REF: \$\{\{ inputs\.supabase_project_ref \}\}/);
    assert.doesNotMatch(bootstrap, /supabase branches get "\$PROJECT_REF"/);
  });

  it('isolates hosted integration tests from Git-managed preview branches', () => {
    assert.match(verify, /hosted-integration:[\s\S]*?if: github\.event_name != 'pull_request'/);
    assert.match(verify, /branch_name="ci-\$\{GITHUB_RUN_ID\}-\$\{GITHUB_RUN_ATTEMPT\}"/);
    assert.doesNotMatch(verify, /--git-branch/);
    assert.doesNotMatch(verify, /GITHUB_HEAD_REF/);
    assert.match(verify, /\*'Resource has been removed'\*\) ;;/);
    assert.match(verify, /actual_readiness=\$\(psql "\$SUPABASE_DB_URL"/);
    assert.match(verify, /actual_readiness" = "\$expected_readiness/);
  });

  it('keeps the generated repository passwordless after Supabase creation', () => {
    const factory = readFileSync(join(ROOT, 'apps', 'hq', 'workflows', 'platform-factory.ts'), 'utf8');
    const deploymentSecrets = /const required:[\s\S]*?if \(process\.env\.OPENAI_API_KEY\)/.exec(factory)?.[0] ?? '';
    assert.ok(deploymentSecrets);
    assert.doesNotMatch(deploymentSecrets, /SUPABASE_DB_PASSWORD/);
    // A blindly retried POST is how one run ends up with two repositories or
    // two billed Supabase projects. Assert the property rather than the line:
    // retries are gated on a method allowlist that POST is not in, and a POST
    // earns one only by an opt-in the caller has to write down. Pinning the
    // exact source text instead makes every reformat look like a regression
    // and every real regression look like a reformat.
    const retrySafe = /const retrySafe = ([\s\S]*?);\n/.exec(factory)?.[1] ?? '';
    assert.ok(retrySafe, 'providerFetch must still decide retries from a retrySafe expression');
    assert.match(retrySafe, /\['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'\]\.includes\(method\)/);
    assert.doesNotMatch(retrySafe, /'POST'/);
    assert.match(factory, /const attempts = retrySafe \? 2 : 1;/);
  });

  // A moving tag is resolved at run time, so a retagged or compromised upstream
  // release would run against this repository's secrets without a diff to review.
  it('pins every external action to an immutable commit SHA', () => {
    const workflows: [string, string][] = [
      ['bootstrap-tenant.yml', bootstrap],
      ['deploy-hosted.yml', deploy],
      ['verify.yml', verify],
      ['simulators.yml', simulators],
    ];
    let pinned = 0;
    for (const [name, source] of workflows) {
      for (const line of source.split('\n')) {
        // Local reusable workflows (uses: ./...) resolve within this repository
        // at the triggering commit, so they are already immutable.
        const reference = /^\s*(?:- )?uses:\s+(?!\.\/)(\S+)/.exec(line)?.[1];
        if (reference === undefined) continue;
        assert.match(reference, /@[0-9a-f]{40}$/, `${name} references ${reference} by tag`);
        pinned += 1;
      }
    }
    // Guards the guard: a refactor that stopped finding references would pass silently.
    assert.ok(pinned >= 30, `expected the workflows to pin many actions, found ${pinned}`);
  });
});
