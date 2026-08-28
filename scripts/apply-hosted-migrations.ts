import { join } from 'node:path';

import { runHostedMigrationPromotion, toStructuredError } from './hosted-migrations.js';

const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? '';
const projectRef = process.env.SUPABASE_PROJECT_REF ?? '';
const expectedReadinessValue = process.env.EXPECTED_RELEASE_READINESS ?? '';
const expectedReadiness = Number(expectedReadinessValue);

if (!/^\d{14}$/.test(expectedReadinessValue) || !Number.isSafeInteger(expectedReadiness)) {
  process.stderr.write(`${JSON.stringify({ code: 'invalid_expected_readiness', message: 'EXPECTED_RELEASE_READINESS is required.' })}\n`);
  process.exit(1);
}

runHostedMigrationPromotion({
  accessToken,
  expectedReadiness,
  migrationsDirectory: join(process.cwd(), 'supabase', 'migrations'),
  projectRef,
}).then((summary) => {
  process.stdout.write(`${JSON.stringify({ event: 'hosted_migrations_promoted', ...summary })}\n`);
}).catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify(toStructuredError(error))}\n`);
  process.exit(1);
});
