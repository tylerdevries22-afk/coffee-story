export type FactoryStartupDecision = 'create' | 'restart' | 'reuse' | 'reject';

export function factoryStartupDecision(
  run: { state: unknown } | null,
): FactoryStartupDecision {
  if (!run) return 'create';
  if (run.state === 'draft' || run.state === 'blocked' || run.state === 'failed') {
    return 'restart';
  }
  if (run.state === 'running' || run.state === 'live') return 'reuse';
  return 'reject';
}
