/**
 * Monitoring as code (Checkly): the two paths that lose money when they
 * break. `npx checkly deploy` with CHECKLY_API_KEY + CHECKLY_ACCOUNT_ID and
 * PLATFORM_BASE_URL pointing at the HQ deployment.
 */
import { defineConfig } from 'checkly';

export default defineConfig({
  projectName: 'ordering-platform',
  logicalId: 'ordering-platform',
  repoUrl: 'https://github.com/tylerdevries22-afk/coffee-story',
  checks: {
    activated: true,
    frequency: 5,
    locations: ['us-west-1', 'us-east-1'],
    checkMatch: '**/__checks__/**/*.check.ts',
  },
  cli: { runLocation: 'us-west-1' },
});
