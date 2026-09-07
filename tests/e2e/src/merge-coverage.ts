import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { CoverageReport } from 'monocart-coverage-reports';

type CoverageSummary = {
  total?: { lines?: { pct?: unknown } };
};

export function coverageLinePercent(summary: CoverageSummary): number {
  const percent = summary.total?.lines?.pct;
  if (typeof percent !== 'number' || !Number.isFinite(percent)) {
    throw new Error('Merged coverage summary has no numeric total.lines.pct.');
  }
  return percent;
}

async function readJson(path: string): Promise<object> {
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Coverage input ${path} is not a JSON object.`);
  }
  return parsed;
}

export async function mergeCoverage(
  unitPath: string,
  browserPath: string,
  outputDir: string,
  threshold = 70,
): Promise<number> {
  const report = new CoverageReport({
    name: 'Unit and hosted browser coverage',
    outputDir,
    reports: ['json', 'json-summary', 'text-summary'],
    logging: 'info',
  });
  await report.add(await readJson(unitPath));
  await report.add(await readJson(browserPath));
  await report.generate();
  const summary = await readJson(resolve(outputDir, 'coverage-summary.json')) as CoverageSummary;
  const percent = coverageLinePercent(summary);
  if (percent < threshold) {
    throw new Error(`Merged line coverage ${percent}% is below the required ${threshold}%.`);
  }
  return percent;
}

if (process.argv[1]?.endsWith('merge-coverage.ts')) {
  const [unitPath, browserPath, outputDir] = process.argv.slice(2);
  if (!unitPath || !browserPath || !outputDir) {
    throw new Error('Usage: merge-coverage.ts <unit.json> <browser.json> <output-dir>');
  }
  await mergeCoverage(unitPath, browserPath, outputDir);
}
