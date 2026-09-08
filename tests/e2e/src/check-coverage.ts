import { readFile } from 'node:fs/promises';

import { coverageLinePercent } from './merge-coverage.ts';

export async function enforceCoverageSummary(path: string, threshold: number): Promise<number> {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    throw new RangeError('Coverage threshold must be between 0 and 100.');
  }
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Coverage summary is not a JSON object.');
  }
  const percent = coverageLinePercent(parsed);
  if (percent < threshold) {
    throw new Error(`Line coverage ${percent}% is below the required ${threshold}%.`);
  }
  console.log(`Line coverage ${percent}% meets the required ${threshold}%.`);
  return percent;
}

if (process.argv[1]?.endsWith('check-coverage.ts')) {
  const [path, rawThreshold] = process.argv.slice(2);
  if (!path || !rawThreshold) throw new Error('Usage: check-coverage.ts <summary.json> <threshold>');
  await enforceCoverageSummary(path, Number(rawThreshold));
}
