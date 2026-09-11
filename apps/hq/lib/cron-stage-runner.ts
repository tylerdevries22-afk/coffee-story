type StageFactories = Record<string, () => Promise<unknown>>;

type StageResults<T extends StageFactories> = {
  [K in keyof T]: Awaited<ReturnType<T[K]>>;
};

/** Run independent cron stages to completion before reporting any failures. */
export async function runIndependentCronStages<T extends StageFactories>(
  stages: T,
): Promise<StageResults<T>> {
  const entries = Object.entries(stages);
  const outcomes = await Promise.allSettled(
    entries.map(([, run]) => Promise.resolve().then(run)),
  );
  const failures = outcomes.flatMap((outcome, index) => {
    if (outcome.status === 'fulfilled') return [];
    const stage = entries[index]![0];
    return [new Error(`Scheduled maintenance stage failed: ${stage}`, { cause: outcome.reason })];
  });
  if (failures.length > 0) {
    throw new AggregateError(failures, 'One or more scheduled maintenance stages failed.');
  }
  return Object.fromEntries(outcomes.map((outcome, index) => [
    entries[index]![0],
    outcome.status === 'fulfilled' ? outcome.value : undefined,
  ])) as StageResults<T>;
}
