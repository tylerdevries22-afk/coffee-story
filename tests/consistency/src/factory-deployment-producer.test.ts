import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const ROOT = join(process.cwd(), '..', '..');
const source = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const deploy = source('.github/workflows/deploy-hosted.yml');
const stage = source('scripts/vercel-stage-deployment.sh');
const stageState = source('scripts/vercel-stage-state.sh');
const capture = source('scripts/vercel-capture-production.sh');
const promote = source('scripts/vercel-promote-deployment.sh');
const restore = source('scripts/vercel-restore-deployment.sh');
const state = source('scripts/vercel-release-state.sh');
const rootPackage = source('package.json');
const hqPackage = source('apps/hq/package.json');
const lockfile = source('pnpm-lock.yaml');
const factory = source('apps/hq/workflows/platform-factory.ts');
const github = source('apps/hq/workflows/factory-github-actions.ts');

describe('factory deployment attestation producer', () => {
  it('publishes the authoritative digest only after complete content is loaded', () => {
    const content = factory.indexOf('await loadContentEvidence(run.id, brandId)');
    const synchronize = factory.indexOf('await synchronizeGitHubArtifactDigest(');
    const verify = factory.indexOf('await synchronizeDeploymentEvidence(');
    assert.ok(content >= 0 && content < synchronize && synchronize < verify);
    assert.match(github, /putVariable\(repository\.externalId, token, 'FACTORY_ARTIFACT_DIGEST', digest\)/);
    assert.match(github, /githubArtifactDigest\(artifactDigest\)/);
  });

  it('passes one synchronized digest to every deployment job', () => {
    assert.match(deploy, /artifact_digest: \$\{\{ steps\.artifact-digest\.outputs\.value \}\}/);
    assert.match(deploy, /SYNCHRONIZED_FACTORY_DIGEST: \$\{\{ vars\.FACTORY_ARTIFACT_DIGEST \}\}/);
    assert.match(deploy, /tenant-artifact-digest\.ts --tenant "\$TENANT"/);
    assert.match(deploy, /SYNCHRONIZED_FACTORY_DIGEST" != "\$digest"/);
    assert.ok((deploy.match(/needs\.release-policy\.outputs\.artifact_digest/g) ?? []).length >= 2);
  });

  it('stages one metadata-bound deployment and reconciles ambiguity read-only', () => {
    assert.match(stage, /vc=\(pnpm exec -- vercel\)/);
    assert.equal((stage.match(/"\$\{vc\[@\]\}" "\$\{deploy\[@\]\}"/g) ?? []).length, 1);
    assert.match(stage, /timeout --kill-after=10s 3m/);
    assert.match(stage, /--meta "githubCommitSha=\$GITHUB_SHA"/);
    assert.match(stage, /--meta "factoryArtifactDigest=\$FACTORY_ARTIFACT_DIGEST"/);
    assert.match(stage, /--meta "factoryReleaseOperation=\$release_operation"/);
    assert.match(stage, /recover_staged_deployment/);
    assert.match(stageState, /api\.vercel\.com\/v6\/deployments/);
    assert.match(stageState, /\.meta\.factoryReleaseOperation == \$operation/);
    assert.match(stageState, /jq -r 'length'.*matches:-\[\]/);
  });

  it('captures an authoritative exact rollback set and rejects unsafe provider state', () => {
    assert.match(capture, /candidate_record=\$\(vercel_api_record "\$candidate_id"\)/);
    assert.match(capture, /\.meta\.githubCommitSha == \$sha/);
    assert.match(capture, /\.meta\.factoryArtifactDigest == \$digest/);
    assert.match(capture, /production_aliases=\$\(read_production_aliases\)/);
    assert.match(capture, /\.rollingRelease == null/);
    assert.match(capture, /productionAliases:\$productionAliases/);
    assert.match(capture, /releaseOperation:\$releaseOperation/);
    assert.match(state, /production=true&verified=true&redirects=false&limit=100/);
    assert.match(state, /invalid production domain response/);
    assert.ok(state.includes('^(\\\\*\\\\.)?'));
  });

  it('promotes and rolls back once, then observes exact terminal state', () => {
    assert.equal((promote.match(/promote "\$deployment_url"/g) ?? []).length, 1);
    assert.equal((restore.match(/rollback "\$deployment_url"/g) ?? []).length, 1);
    for (const script of [promote, restore]) {
      assert.match(script, /release_deadline=\$\(\(SECONDS \+ 420\)\)/);
      assert.match(script, /rolling_release_active/);
      assert.match(script, /read_release_state/);
    }
    assert.match(promote, /candidate_aliases_complete/);
    assert.match(promote, /alias_job_successful/);
    assert.match(restore, /previous_aliases_complete/);
    assert.match(restore, /alias_job_successful/);
    assert.match(promote, /meta_pattern='<meta\[\^>\]\*\('/);
  });

  it('executes only lockfile-integrated deployment and connector packages', () => {
    assert.match(rootPackage, /"vercel": "59\.11\.7"/);
    assert.match(lockfile, /vercel@59\.11\.7:/);
    const asset = 'https://github.com/tylerdevries22-afk/franchise-mcp-store-ui/releases/download/v1.3.1/franchise-mcp-store-ui-1.3.1.tgz';
    const integrity = 'sha512-kOkOH3hsGTeBpAmFaxtNyX4v4uerdLBT3CdROTZkaUYAtb/PNyFQ89tzAZOVrAuVI+Vn7OnHUT2MXgnQn9IPEg==';
    assert.ok(hqPackage.includes(`"franchise-mcp-store-ui": "${asset}"`));
    assert.ok(lockfile.includes(`resolution: {integrity: ${integrity}, tarball: ${asset}}`));
    assert.doesNotMatch(lockfile, /version: link:.*packages\/franchise-mcp-store-ui/);
  });
});
