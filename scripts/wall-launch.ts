import { parseWallLauncherArgs, previewCommandArgs, readBuiltTenant, wallLaunchPlan } from './wall-launch-config';
import { assertPortsAvailable, waitForHealth } from './wall-health';
import { WallProcesses } from './wall-processes';

async function main(): Promise<void> {
  const root = process.cwd();
  const controller = new AbortController();
  const interrupt = () => controller.abort(new Error('Wall launcher stopped.'));
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  const processes = new WallProcesses(root, controller.signal);
  try {
    const options = parseWallLauncherArgs(process.argv.slice(2), process.env.EXPO_PUBLIC_TENANT);
    const builtTenant = readBuiltTenant(root);
    const tenant = options.requestedTenant ?? builtTenant;
    if (!tenant) throw new Error('Pass --tenant <slug> the first time the wall is launched.');
    const plan = wallLaunchPlan(root, tenant);
    // Check before exporting: a tenant switch must not rewrite another running wall.
    await assertPortsAvailable(plan);
    await processes.run('pnpm', previewCommandArgs(tenant, builtTenant, options.rebuild));
    await assertPortsAvailable(plan);
    const started = plan.map((target) => processes.start(
      target.name, target.executable, target.args, target.env,
    ));
    await waitForHealth(plan, started, controller.signal);
    const customer = plan.find(({ name }) => name === 'customer-web');
    if (!customer) throw new Error('The wall requires a customer-web launch configuration.');
    console.log(`\nFive-app wall ready for ${tenant}: ${new URL('/wall', customer.url).href}`);
    for (const target of plan) console.log(`  ${target.name.padEnd(14)} ${target.url}`);
    console.log('Keep this command running. Ctrl+C stops all five owned app processes.');
    const shutdown = new Promise<void>((resolve) => {
      if (controller.signal.aborted) resolve();
      else controller.signal.addEventListener('abort', () => resolve(), { once: true });
    });
    const failure = Promise.race(started.map(async ({ name, exited }) => {
      const result = await exited;
      throw new Error(`${name} exited (${result.reason}).`);
    }));
    await Promise.race([shutdown, failure]);
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    await processes.stop();
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Wall launcher failed.');
  process.exitCode = 1;
});
