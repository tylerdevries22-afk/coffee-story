import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const ROOT = join(process.cwd(), '..', '..');
const source = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const deploy = source('.github/workflows/deploy-hosted.yml');
const producer = source('scripts/vercel-stage-deployment.sh');
const rootPackage = source('package.json');
const hqPackage = source('apps/hq/package.json');
const lockfile = source('pnpm-lock.yaml');
const factory = source('apps/hq/workflows/platform-factory.ts');
const github = source('apps/hq/workflows/factory-github-actions.ts');

describe('factory deployment attestation producer', () => {
  it('publishes the authoritative digest only after complete content is loaded', () => {
    const content = factory.indexOf('const content = await loadContentEvidence(run.id)');
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
    assert.match(producer, /vc=\(pnpm exec vercel\)/);
    assert.match(producer, /deploy --force --no-wait --no-color/);
    assert.match(producer, /--meta "githubCommitSha=\$GITHUB_SHA"/);
    assert.match(producer, /--meta "factoryArtifactDigest=\$FACTORY_ARTIFACT_DIGEST"/);
    assert.match(producer, /deploy\+\=\(--prod --skip-domain\)/);
    assert.match(producer, /api\.vercel\.com\/v13\/deployments/);
    assert.match(producer, /\(\$target == "preview"\).*\(\.target == null\)/);
    const canary = producer.indexOf("curl '/api/health?deep=1'");
    const promote = producer.indexOf('promote "$deployment_url"');
    assert.ok(canary >= 0 && canary < promote);
    assert.match(producer, /\.readySubstate \/\/ empty/);
    assert.match(producer, /deployment_id=\$deployment_id/);
    assert.match(producer, /provider_evidence=\$evidence/);
  });

  it('executes only lockfile-integrated deployment and connector packages', () => {
    assert.match(rootPackage, /"vercel": "59\.11\.7"/);
    assert.match(lockfile, /vercel@59\.11\.7:/);
    assert.match(hqPackage, /"franchise-mcp-store-ui": "workspace:\*"/);
    assert.match(lockfile, /version: link:\.\.\/\.\.\/packages\/franchise-mcp-store-ui/);
  });
});
