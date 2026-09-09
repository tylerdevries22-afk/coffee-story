import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const ROOT = join(process.cwd(), '..', '..');
const source = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const workflow = source('.github/workflows/deploy-hosted.yml');
const easStage = source('scripts/eas-stage-update.sh');
const easStageState = source('scripts/eas-stage-state.sh');
const easRelease = source('scripts/eas-channel-release.sh');
const easState = source('scripts/eas-release-state.sh');
const rollback = source('scripts/hosted-release-rollback.sh');
const finalizer = workflow.slice(workflow.indexOf('\n  promote-vercel:'));

describe('atomic hosted and native release workflow', () => {
  it('stages one immutable EAS update and reconciles an ambiguous response read-only', () => {
    assert.match(easStage, /git status --porcelain=v1 --untracked-files=all/);
    assert.equal((easStage.match(/update --branch "\$candidate_branch"/g) ?? []).length, 1);
    assert.match(easStage, /recovery_deadline=\$\(\(SECONDS \+ 180\)\)/);
    assert.match(easStageState, /for observation in \{1\.\.18\}/);
    assert.match(easStageState, /branch:view "\$candidate_branch"/);
    assert.match(easStageState, /update:view "\$group"/);
    assert.doesNotMatch(easStage, /update[^\n]*--channel production/);
  });

  it('binds EAS evidence to exact update objects and immutable prior snapshots', () => {
    for (const field of ['id', 'platform', 'manifestPermalink']) {
      assert.match(easStage, new RegExp(field));
    }
    assert.match(easStage, /updateDigest:\$updateDigest,updates:\$updates/);
    assert.match(easState, /map\(\{id,platform,manifestPermalink\}\) \| sort_by\(\.id\)/);
    assert.match(easState, /"\$digest" == "\$candidate_update_digest"/);
    assert.match(easState, /\.updates == \$updates/);
    assert.match(easRelease, /priorUpdateGroup:\$priorUpdateGroup/);
    assert.match(easRelease, /priorUpdateDigest:\$priorUpdateDigest/);
    assert.match(easRelease, /verify-live/);
    assert.match(easRelease, /verify-restored/);
  });

  it('captures every rollback target before arming promotion', () => {
    const capture = finalizer.indexOf('> captured-rollback-set.json');
    const digest = finalizer.indexOf('sha256sum captured-rollback-set.json');
    const arm = finalizer.indexOf('install_release_rollback_traps');
    const firstMutation = finalizer.indexOf('vercel-promote-deployment.sh');
    assert.ok(capture >= 0 && capture < digest && digest < arm && arm < firstMutation);
    assert.match(finalizer, /rollback_canary_reference="rollback:sha256:\$\{rollback_digest\}"/);
  });

  it('restores package first, providers in reverse, then confirms the whole set', () => {
    const packageRestore = rollback.indexOf('restore_package_publication');
    const easRestore = rollback.indexOf("tac attempted-eas-rollbacks.txt");
    const vercelRestore = rollback.indexOf("tac attempted-rollbacks.txt");
    const wholeSet = rollback.indexOf('if output=$(verify_restored_eas_surface', vercelRestore);
    const confirm = rollback.indexOf('if output=$(confirm_package_compensation', wholeSet);
    assert.ok(packageRestore >= 0 && packageRestore < easRestore && easRestore < vercelRestore);
    assert.ok(vercelRestore < wholeSet && wholeSet < confirm);
    assert.match(rollback, /package_compensation_status" == compensated/);
    assert.match(rollback, /append_rollback_result/);
  });

  it('verifies the full provider set immediately around package publication', () => {
    const pre = finalizer.indexOf('verify_live_release_set provider-pre-publication.jsonl');
    const publish = finalizer.indexOf('/rpc/publish_tenant_package_if_current');
    const post = finalizer.indexOf('verify_live_release_set provider-post-publication.jsonl');
    const finalState = finalizer.indexOf('> package-post-publication-state.json');
    const disarm = finalizer.indexOf('disarm_release_rollback_traps');
    assert.ok(pre >= 0 && pre < publish && publish < post && post < finalState && finalState < disarm);
    assert.match(finalizer, /map\(del\(\.status\)\)/);
    assert.match(finalizer, /package_final_status=drifted/);
    assert.match(finalizer, /candidate_package_is_current && package_final_status=verified/);
  });

  it('uses explicit mutation attempts and exact immutable response reconciliation', () => {
    const publishStart = finalizer.indexOf("printf '%s\\n' package-rollback.json");
    const publishEnd = finalizer.indexOf('for observation in 1 2 3', publishStart);
    const publishMutation = finalizer.slice(publishStart, publishEnd);
    assert.match(publishMutation, /publish_tenant_package_if_current/);
    assert.doesNotMatch(publishMutation, /--retry/);
    assert.match(finalizer, /artifact_digest=eq\.\$\{ARTIFACT_DIGEST\}/);
    for (const field of [
      'brand_id', 'package_release_id', 'artifact_digest', 'deployment_commit_sha',
      'canary_reference', 'approval_reference', 'promoted_at',
    ]) {
      assert.match(finalizer, new RegExp(`select=[^\\n]*${field}`));
    }
    assert.match(finalizer, /\$event\[0\]\.brand_id == \$brand/);
    assert.match(finalizer, /\.\[0\]\.published_at == \$event\[0\]\.promoted_at/);
  });

  it('retains exact success and rollback evidence even when finalization fails', () => {
    assert.match(workflow, /id: promote/);
    assert.match(workflow, /FINALIZE_OUTCOME: \$\{\{ steps\.promote\.outcome \}\}/);
    assert.match(workflow, /Required hosted release evidence is missing/);
    assert.match(workflow, /package-post-publication-state\.json/);
    assert.match(workflow, /if: always\(\)[\s\S]*actions\/upload-artifact@[0-9a-f]{40}/);
    assert.match(workflow, /if-no-files-found: error/);
    assert.match(workflow, /retention-days: 90/);
  });
});
