/**
 * Monitoring as code (Checkly): the two paths that lose money when they
 * break. `npx checkly deploy` with CHECKLY_API_KEY + CHECKLY_ACCOUNT_ID and
 * PLATFORM_BASE_URL pointing at the HQ deployment.
 */
import { defineConfig } from 'checkly';
import { EmailAlertChannel } from 'checkly/constructs';

const alertAddress = process.env.CHECKLY_ALERT_EMAIL;
if (process.env.CHECKLY_API_KEY && !alertAddress) {
  throw new Error('CHECKLY_ALERT_EMAIL is required when deploying monitoring.');
}

export const alertChannels = alertAddress
  ? [new EmailAlertChannel('platform-operations-email', {
    address: alertAddress,
    sendFailure: true,
    sendRecovery: true,
    sslExpiry: true,
  })]
  : [];

export default defineConfig({
  projectName: 'ordering-platform',
  logicalId: 'ordering-platform',
  repoUrl: 'https://github.com/tylerdevries22-afk/coffee-story',
  checks: {
    activated: true,
    frequency: 5,
    locations: ['us-west-1', 'us-east-1'],
    checkMatch: '**/__checks__/**/*.check.ts',
    alertChannels,
  },
  cli: { runLocation: 'us-west-1' },
});
