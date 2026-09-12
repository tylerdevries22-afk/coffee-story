import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

/**
 * Sentry is instrumented (apps/hq/instrumentation.ts, apps/display/instrumentation.ts,
 * packages/monitoring/src/mobile.ts) but DSN-gated and silent: without a DSN each
 * one no-ops rather than erroring, so a deploy that forgets to configure Sentry
 * looks identical to one that succeeded -- until the first unreported error.
 *
 * This guards the wiring in the one place production deploys set hosted
 * environment variables: `deploy-hosted.yml`'s "Configure hosted server
 * environment" step must source both DSNs from repository secrets, pass them
 * through the same add_secret/add_public helpers as every other var there, and
 * refuse a production deploy outright when either is empty.
 */
const ROOT = join(process.cwd(), '..', '..');
const deploy = readFileSync(join(ROOT, '.github', 'workflows', 'deploy-hosted.yml'), 'utf8');
const bootstrap = readFileSync(join(ROOT, '.github', 'workflows', 'bootstrap-tenant.yml'), 'utf8');
const configureStep = deploy.slice(
  deploy.indexOf('- name: Configure hosted server environment'),
  deploy.indexOf('- name: Stage and verify the exact HQ commit'),
);

describe('Sentry DSNs are wired into the hosted production deploy', () => {
  it('declares both DSNs as reusable-workflow secrets', () => {
    assert.match(deploy, /SENTRY_DSN:\s*\n\s*required: false/);
    assert.match(deploy, /EXPO_PUBLIC_SENTRY_DSN:\s*\n\s*required: false/);
  });

  it('sources both DSNs from repository secrets in the HQ environment step', () => {
    assert.ok(configureStep, 'the "Configure hosted server environment" step must exist');
    assert.match(configureStep, /SENTRY_DSN: \$\{\{ secrets\.SENTRY_DSN \}\}/);
    assert.match(configureStep, /EXPO_PUBLIC_SENTRY_DSN: \$\{\{ secrets\.EXPO_PUBLIC_SENTRY_DSN \}\}/);
  });

  it('writes both through the same add_secret/add_public helpers as the other vars', () => {
    // SENTRY_DSN is server-side (apps/hq/instrumentation.ts) -- sensitive, like
    // SUPABASE_SERVICE_ROLE_KEY and CRON_SECRET above it.
    assert.match(configureStep, /add_secret SENTRY_DSN "\$SENTRY_DSN"/);
    // EXPO_PUBLIC_* is inlined into a public bundle by definition -- public,
    // like the OPENAI_*_MODEL vars above it.
    assert.match(configureStep, /add_public EXPO_PUBLIC_SENTRY_DSN "\$EXPO_PUBLIC_SENTRY_DSN"/);
  });

  it('fails the step outright on production when either DSN is empty', () => {
    const productionGate = /if \[ "\$DEPLOY_ENVIRONMENT" = production \]; then\s*\n\s*test -n "\$SENTRY_DSN" \|\| \{\s*\n\s*echo '::error::[^\n]*SENTRY_DSN[^\n]*'\s*\n\s*exit 1\s*\n\s*\}\s*\n\s*test -n "\$EXPO_PUBLIC_SENTRY_DSN" \|\| \{\s*\n\s*echo '::error::[^\n]*EXPO_PUBLIC_SENTRY_DSN[^\n]*'\s*\n\s*exit 1\s*\n\s*\}\s*\n\s*fi/;
    assert.match(configureStep, productionGate);
  });

  it('does not silently skip: both checks precede the writes they gate', () => {
    const gateIndex = configureStep.indexOf('SENTRY_DSN" || {');
    const secretWriteIndex = configureStep.indexOf('add_secret SENTRY_DSN "$SENTRY_DSN"');
    const publicWriteIndex = configureStep.indexOf('add_public EXPO_PUBLIC_SENTRY_DSN');
    assert.ok(gateIndex >= 0 && gateIndex < secretWriteIndex && secretWriteIndex < publicWriteIndex);
  });

  it('forwards both secrets from the tenant-bootstrap caller', () => {
    assert.match(bootstrap, /SENTRY_DSN: \$\{\{ secrets\.SENTRY_DSN \}\}/);
    assert.match(bootstrap, /EXPO_PUBLIC_SENTRY_DSN: \$\{\{ secrets\.EXPO_PUBLIC_SENTRY_DSN \}\}/);
  });
});
