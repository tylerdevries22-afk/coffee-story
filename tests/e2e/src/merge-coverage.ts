import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CoverageReport } from 'monocart-coverage-reports';

type CoverageSummary = {
  total?: { lines?: { pct?: unknown } };
};

type IstanbulMap = Record<string, object>;
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

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

export function isCountedBrowserFile(file: string): boolean {
  const clean = file.replaceAll('\\', '/');
  const fromRoot = relative(workspaceRoot, clean).replaceAll('\\', '/');
  if (!isAbsolute(clean) || !existsSync(clean)
    || fromRoot.startsWith('../') || isAbsolute(fromRoot)) return false;
  if (!/^(?:apps|packages|scripts)\//.test(fromRoot) || !/\.tsx?$/.test(clean)) return false;
  return !/(?:\.d|\.test|\.config|\.generated)\.tsx?$|\/(?:dist[^/]*|node_modules|tests?)\//.test(clean);
}

export function filterBrowserCoverage(input: object): IstanbulMap {
  return Object.fromEntries(
    Object.entries(input).filter(([file]) => isCountedBrowserFile(file)),
  );
}

export async function mergeCoverage(
  verificationPath: string,
  integrationPath: string,
  browserPath: string,
  outputDir: string,
  threshold = 40,
): Promise<number> {
  const report = new CoverageReport({
    name: 'Workspace verification, database integration, and hosted browser coverage',
    outputDir,
    reports: ['json', 'json-summary', 'text-summary'],
    logging: 'info',
  });
  await report.add(await readJson(verificationPath));
  await report.add(await readJson(integrationPath));
  await report.add(filterBrowserCoverage(await readJson(browserPath)));
  await report.generate();
  const summary = await readJson(resolve(outputDir, 'coverage-summary.json')) as CoverageSummary;
  const percent = coverageLinePercent(summary);
  if (percent < threshold) {
    throw new Error(`Merged line coverage ${percent}% is below the required ${threshold}%.`);
  }
  return percent;
}

if (process.argv[1]?.endsWith('merge-coverage.ts')) {
  const [verificationPath, integrationPath, browserPath, outputDir] = process.argv.slice(2);
  if (!verificationPath || !integrationPath || !browserPath || !outputDir) {
    throw new Error(
      'Usage: merge-coverage.ts <verification.json> <integration.json> <browser.json> <output-dir>',
    );
  }
  await mergeCoverage(verificationPath, integrationPath, browserPath, outputDir);
}
