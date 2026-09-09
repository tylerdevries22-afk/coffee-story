import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const ROOT = join(process.cwd(), '..', '..');
const source = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const workflow = source('.github/workflows/deploy-hosted.yml');
const easStage = source('scripts/eas-stage-update.sh');
const easRelease = source('scripts/eas-channel-release.sh');
const finalizer = workflow.slice(workflow.indexOf('\n  promote-vercel:'));
const nativeStage = workflow.slice(
  workflow.indexOf('\n  publish-native:'),
  workflow.indexOf('\n  promote-vercel:'),
);

describe('atomic hosted and native release workflow', () => {
  it('stages immutable native candidates without changing production channels', () => {
    assert.match(nativeStage, /name: Stage \$\{\{ matrix\.surface \}\} native OTA update/);
    assert.match(nativeStage, /FACTORY_ARTIFACT_DIGEST: .*artifact_digest/);
    assert.match(nativeStage, /SURFACE: \$\{\{ matrix\.surface \}\}/);
    assert.match(nativeStage, /bash scripts\/eas-stage-update\.sh/);
    assert.match(nativeStage, /name: eas-stage-\$\{\{ matrix\.surface \}\}/);
    assert.match(nativeStage, /path: eas-stage\/\$\{\{ matrix\.surface \}\}\.json/);
    assert.doesNotMatch(nativeStage, /eas(?:-cli)?[^\n]*update[^\n]*--channel production/);

    assert.match(easStage, /candidate_branch="release-\$\{GITHUB_SHA\}-\$\{GITHUB_RUN_ID\}-\$\{GITHUB_RUN_ATTEMPT\}"/);
    assert.match(easStage, /eas-cli@21\.4\.0/);
    assert.match(easStage, /update --branch "\$candidate_branch"/);
    assert.match(easStage, /--environment production --platform all/);
    assert.match(easStage, /run_in_app 20m/);
    assert.match(easStage, /for attempt in 1 2;/);
    assert.match(easStage, /branch:view "\$candidate_branch"/);
    assert.match(easStage, /update:view "\$group"/);
    assert.doesNotMatch(easStage, /update[^\n]*--channel production/);
  });

  it('captures all prior provider state before changing any live surface', () => {
    const capturePackage = finalizer.indexOf('> package-rollback.json');
    const captureVercel = finalizer.indexOf('vercel-capture-production.sh');
    const captureEas = finalizer.indexOf('eas-channel-release.sh capture');
    const armRollback = finalizer.indexOf('trap rollback_on_failure EXIT');
    const promoteVercel = finalizer.indexOf('vercel-promote-deployment.sh');
    const switchEas = finalizer.indexOf('eas-channel-release.sh switch');
    assert.ok(capturePackage >= 0 && capturePackage < captureVercel);
    assert.ok(captureVercel < captureEas);
    assert.ok(captureEas < armRollback && armRollback < promoteVercel);
    assert.ok(promoteVercel < switchEas);
    assert.match(finalizer, /pattern: vercel-stage-\*/);
    assert.match(finalizer, /pattern: eas-stage-\*/);
    assert.match(finalizer, /attempted-rollbacks\.txt/);
    assert.match(finalizer, /attempted-eas-rollbacks\.txt/);
    assert.match(finalizer, /attempted-package-rollback\.txt/);
    assert.match(
      finalizer,
      /select=current_release_id,artifact_digest,deployment_commit_sha,published_at&limit=2/,
    );
    assert.match(finalizer, /type == "array" and length <= 1/);
    for (const field of [
      'current_release_id',
      'artifact_digest',
      'deployment_commit_sha',
      'published_at',
    ]) {
      assert.match(finalizer, new RegExp(`\\.${field} \\| type == "string"`));
    }
  });

  it('compensates package publication before restoring providers in reverse', () => {
    const recordVercel = finalizer.indexOf('>> attempted-rollbacks.txt');
    const promoteVercel = finalizer.indexOf('vercel-promote-deployment.sh');
    const recordEas = finalizer.indexOf('>> attempted-eas-rollbacks.txt');
    const switchEas = finalizer.indexOf('eas-channel-release.sh switch');
    assert.ok(recordVercel >= 0 && recordVercel < promoteVercel);
    assert.ok(recordEas >= 0 && recordEas < switchEas);

    const compensate = finalizer.indexOf('/rpc/compensate_tenant_package_publication');
    const accepted = finalizer.indexOf('[[ "$compensation_status" == compensated');
    const reconcile = finalizer.indexOf('reconcile_package_compensation && return 0');
    const ambiguous = finalizer.indexOf('compensation was ambiguous or conflicted');
    const restorePackage = finalizer.indexOf('restore_package_publication || exit 1');
    const restoreEas = finalizer.indexOf('eas-channel-release.sh restore');
    const reverseEas = finalizer.indexOf('tac attempted-eas-rollbacks.txt');
    const restoreVercel = finalizer.indexOf('vercel-restore-deployment.sh');
    const reverseVercel = finalizer.indexOf('tac attempted-rollbacks.txt');
    assert.ok(compensate >= 0 && compensate < accepted && accepted < reconcile);
    assert.ok(reconcile < ambiguous);
    assert.ok(ambiguous < restorePackage && restorePackage < restoreEas);
    assert.ok(restoreEas < reverseEas);
    assert.ok(reverseEas < restoreVercel && restoreVercel < reverseVercel);
    assert.match(finalizer, /trap '' HUP INT TERM/);
    assert.match(
      finalizer,
      /"\$compensation_status" == compensated[\s\\]*\|\| "\$compensation_status" == not_committed/,
    );
    for (const argument of [
      'p_brand_id:$brand',
      'p_release_id:$release',
      'p_commit_sha:$commit',
      'p_canary_reference:$canary',
      'p_approval_reference:$approval',
      'p_previous_release_id:',
      'p_previous_artifact_digest:',
      'p_previous_commit_sha:',
      'p_previous_published_at:',
    ]) {
      assert.ok(finalizer.includes(argument), `missing compensation argument ${argument}`);
    }
  });

  it('proves ambiguous package compensation before provider rollback', () => {
    const start = finalizer.indexOf('reconcile_package_compensation()');
    const end = finalizer.indexOf('restore_package_publication()');
    const reconciliation = finalizer.slice(start, end);
    assert.ok(start >= 0 && start < end);
    assert.match(reconciliation, /event=\$\(fetch_exact_package_event\)/);
    assert.match(reconciliation, /pointer=\$\(fetch_package_pointer\)/);
    for (const query of [
      'publication_event_id=eq.${event_id}',
      'brand_id=eq.${brand_id}',
      'failed_release_id=eq.${RELEASE_ID}',
      'failed_deployment_commit_sha=eq.${COMMIT_SHA}',
      'rollback_canary_reference=eq.${rollback_canary_reference}',
      'rollback_approval_reference=eq.${rollback_approval_reference}',
    ]) {
      assert.ok(reconciliation.includes(`--data-urlencode "${query}"`), `missing ${query}`);
    }
    assert.match(reconciliation, /length == 1/);
    assert.match(reconciliation, /\.\[0\]\.restored_release_id/);
    assert.match(reconciliation, /\.\[0\]\.restored_deployment_commit_sha/);
    assert.match(reconciliation, /package_pointer_matches_prior "\$pointer"/);
  });

  it('publishes the package inside the armed rollback boundary', () => {
    const armRollback = finalizer.indexOf('trap rollback_on_failure EXIT');
    const packagePublish = finalizer.lastIndexOf('/rpc/publish_tenant_package');
    const packageAttempt = finalizer.indexOf('> attempted-package-rollback.txt');
    const disarmRollback = finalizer.indexOf('trap - EXIT HUP INT TERM');
    assert.ok(armRollback >= 0 && armRollback < packagePublish);
    assert.ok(packageAttempt >= 0 && packageAttempt < packagePublish);
    assert.ok(packagePublish < disarmRollback);
    assert.doesNotMatch(workflow, /^  publish-tenant-package:/m);

    const manifest = finalizer.indexOf("sort_by(.provider, .surface)");
    const digest = finalizer.indexOf('sha256sum promoted-release-set.json');
    const reference = finalizer.indexOf('release-set:sha256:${release_digest}');
    assert.ok(manifest >= 0 && manifest < digest && digest < reference);
    assert.match(
      finalizer,
      /jq '\[\.\[\] \| \[\.provider, \.surface\]\] \| unique \| length' promoted-release-set\.json/,
    );
    assert.doesNotMatch(finalizer, /jq '\[\.\[\.provider, \.surface\]\] \| unique \| length'/);
  });

  it('reconciles only the exact package publication event and candidate pointer', () => {
    assert.ok(
      finalizer.includes(
        'APPROVAL_REFERENCE: github:${{ github.run_id }}:${{ github.run_attempt }}',
      ),
    );
    for (const query of [
      'brand_id=eq.${brand_id}',
      'package_release_id=eq.${RELEASE_ID}',
      'deployment_commit_sha=eq.${COMMIT_SHA}',
      'canary_reference=eq.${release_reference}',
      'approval_reference=eq.${APPROVAL_REFERENCE}',
    ]) {
      assert.ok(finalizer.includes(`--data-urlencode "${query}"`), `missing ${query}`);
    }
    assert.match(finalizer, /\(\$event \| length\) == 1/);
    assert.match(finalizer, /\.\[0\]\.published_at == \$event\[0\]\.promoted_at/);
    assert.match(finalizer, /--arg source "\$PACKAGE_SOURCE_COMMIT_SHA"/);
    assert.match(finalizer, /\.\[0\]\.source_commit_sha == \$source/);
    assert.doesNotMatch(finalizer, /--arg source "\$GITHUB_SHA"/);
    assert.doesNotMatch(finalizer, /test "\$PACKAGE_SOURCE_COMMIT_SHA" = "\$GITHUB_SHA"/);
  });

  it('bounds, verifies, and conditionally moves EAS production channels', () => {
    assert.match(easRelease, /capture\|verify\|switch\|restore/);
    assert.match(easRelease, /channel:view production --limit 100/);
    assert.match(easRelease, /channel:edit production --branch "\$target_name"/);
    assert.match(easRelease, /run_in_app 45s/);
    assert.match(easRelease, /for attempt in 1 2 3/);
    assert.match(easRelease, /\.data \| length\) == 1/);
    assert.match(easRelease, /current_id" == "\$expected_id/);
    const verify = easRelease.indexOf('verify_candidate');
    const restoreExclusion = easRelease.indexOf('"$action" != restore');
    assert.ok(verify >= 0 && restoreExclusion >= 0);
  });
});
