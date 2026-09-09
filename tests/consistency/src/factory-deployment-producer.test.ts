import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const ROOT = join(process.cwd(), '..', '..');
const source = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const deploy = source('.github/workflows/deploy-hosted.yml');
const producer = source('scripts/vercel-stage-deployment.sh');
const capture = source('scripts/vercel-capture-production.sh');
const promoter = source('scripts/vercel-promote-deployment.sh');
const restore = source('scripts/vercel-restore-deployment.sh');
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

  it('captures one digest for every deployment job in the workflow run', () => {
    assert.match(deploy, /artifact_digest: \$\{\{ steps\.artifact-digest\.outputs\.value \}\}/);
    assert.match(deploy, /SYNCHRONIZED_FACTORY_DIGEST: \$\{\{ vars\.FACTORY_ARTIFACT_DIGEST \}\}/);
    assert.match(deploy, /tenant-artifact-digest\.ts --tenant "\$TENANT"/);
    assert.match(deploy, /SYNCHRONIZED_FACTORY_DIGEST" != "\$digest"/);
    assert.match(deploy, /FACTORY_ARTIFACT_DIGEST: \$\{\{ steps\.artifact-digest\.outputs\.value \}\}/);
    assert.match(deploy, /add_public TENANT "\$TENANT"/);
    assert.ok((deploy.match(/needs\.release-policy\.outputs\.artifact_digest/g) ?? []).length >= 2);
  });

  it('creates metadata-bearing deployments and canaries before promotion', () => {
    assert.doesNotMatch(deploy, /npx .*vercel@/);
    assert.doesNotMatch(producer, /npx .*vercel@/);
    assert.match(producer, /vc=\(pnpm exec -- vercel\)/);
    assert.match(producer, /retry_command\(\)/);
    assert.match(producer, /for attempt in 1 2 3/);
    assert.match(producer, /timeout 3m/);
    assert.match(producer, /deploy --force --no-wait --no-color/);
    assert.match(producer, /--meta "githubCommitSha=\$GITHUB_SHA"/);
    assert.match(producer, /--meta "factoryArtifactDigest=\$FACTORY_ARTIFACT_DIGEST"/);
    assert.match(producer, /deploy\+\=\(--prod --skip-domain\)/);
    assert.match(producer, /api\.vercel\.com\/v13\/deployments/);
    assert.match(producer, /\(\$target == "preview"\).*\(\.target == null\)/);
    assert.match(producer, /'\/api\/health\?deep=1'/);
    assert.doesNotMatch(producer, /promote "\$deployment_url"/);
    const validate = promoter.indexOf('record=$(deployment_record)');
    const canonicalRead = promoter.indexOf('record=$(canonical_record)');
    const promote = promoter.indexOf('promote "$deployment_url"');
    const canonical = promoter.indexOf('canonical="https://${project}.vercel.app"');
    assert.ok(validate >= 0 && validate < canonicalRead && canonicalRead < promote);
    assert.ok(promote < canonical);
    assert.match(promoter, /rollback_path="\$\{2:\?Pass the matching Vercel rollback evidence file\.\}"/);
    assert.match(promoter, /\.candidateDeploymentId == \$candidateId/);
    assert.match(promoter, /\.candidateDeploymentUrl == \$candidateUrl/);
    assert.match(promoter, /"\$current_deployment_id" == "\$prior_deployment_id"/);
    assert.match(promoter, /"\$current_deployment_id" == "\$deployment_id"/);
    assert.match(promoter, /for attempt in 1 2/);
    assert.match(promoter, /timeout 4m/);
    assert.match(
      promoter,
      /promote "\$deployment_url" --yes --timeout 3m \\\n\s+"\$\{scope\[@\]\}" >&2/,
    );
    const promoteRetries = promoter.slice(
      promoter.indexOf('for attempt in 1 2; do'),
      promoter.indexOf('test -n "$promote_ok"'),
    );
    const reread = promoteRetries.indexOf('record=$(canonical_record)');
    const alreadyCurrent = promoteRetries.indexOf('"$current_deployment_id" == "$deployment_id"');
    const priorGuard = promoteRetries.indexOf('"$current_deployment_id" == "$prior_deployment_id"');
    const promoteAttempt = promoteRetries.indexOf('promote "$deployment_url"');
    assert.ok(reread >= 0 && reread < alreadyCurrent);
    assert.ok(alreadyCurrent < priorGuard && priorGuard < promoteAttempt);
    assert.match(promoter, /\.target \/\/ empty/);
    assert.match(promoter, /\.readyState \/\/ \.state \/\/ empty/);
    assert.match(producer, /deployment_id=\$deployment_id/);
    assert.match(producer, /provider_evidence=\$evidence/);
  });

  it('captures and restores the prior production deployment around promotion', () => {
    const captureLookup = capture.indexOf('canonical_host="${project}.vercel.app"');
    const captureEvidence = capture.indexOf('status:"rollback-ready"');
    assert.ok(captureLookup >= 0 && captureLookup < captureEvidence);
    assert.match(capture, /\.target == "production"/);
    assert.match(capture, /\.readyState \/\/ \.state/);
    assert.match(capture, /schemaVersion:1/);
    assert.match(capture, /candidateDeploymentId:\$candidateDeploymentId/);
    assert.match(capture, /candidate is already live before final promotion/);
    assert.match(capture, /--retry 2 --retry-all-errors/);
    assert.match(capture, /--max-time 15/);

    const restoreValidate = restore.indexOf('record=$(api_record "$deployment_id")');
    const restoreConcurrency = restore.indexOf('changed concurrently');
    const restorePromote = restore.indexOf('promote "$deployment_url"');
    const restoreVerify = restore.lastIndexOf('api_record "${project}.vercel.app"');
    assert.ok(restoreValidate >= 0 && restoreValidate < restoreConcurrency);
    assert.ok(restoreConcurrency < restorePromote && restorePromote < restoreVerify);
    assert.match(restore, /for attempt in 1 2/);
    assert.match(restore, /timeout 4m/);
    assert.match(
      restore,
      /promote "\$deployment_url" --yes --timeout 3m \\\n\s+"\$\{scope\[@\]\}" >&2/,
    );
    const restoreRetries = restore.slice(
      restore.indexOf('for attempt in 1 2; do'),
      restore.indexOf('test -n "$restore_started"'),
    );
    const reread = restoreRetries.indexOf('current_record=$(api_record "${project}.vercel.app")');
    const alreadyCurrent = restoreRetries.indexOf('"$current_id" == "$deployment_id"');
    const candidateGuard = restoreRetries.indexOf('"$current_id" == "$candidate_id"');
    const restoreAttempt = restoreRetries.indexOf('promote "$deployment_url"');
    assert.ok(reread >= 0 && reread < alreadyCurrent);
    assert.ok(alreadyCurrent < candidateGuard && candidateGuard < restoreAttempt);
  });

  it('executes only lockfile-integrated deployment and connector packages', () => {
    assert.match(rootPackage, /"vercel": "59\.11\.7"/);
    assert.match(lockfile, /vercel@59\.11\.7:/);
    const asset = 'https://github.com/tylerdevries22-afk/franchise-mcp-store-ui/releases/download/v1.3.0/franchise-mcp-store-ui-1.3.0.tgz';
    const integrity = 'sha512-0YyDFsGFRw+fSwG7bmYnhEcGoYabQRj1CcdPEeUGDhOTsHy+oWQhJ33/xOXzhDHAqnWLOyF7sjQFbltvYPHaig==';
    assert.ok(hqPackage.includes(`"franchise-mcp-store-ui": "${asset}"`));
    assert.ok(lockfile.includes(`resolution: {integrity: ${integrity}, tarball: ${asset}}`));
    assert.doesNotMatch(lockfile, /version: link:.*packages\/franchise-mcp-store-ui/);
  });
});
