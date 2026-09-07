import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CoverageReport } from 'monocart-coverage-reports';
import type { Page } from 'playwright';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const appByPort: Record<string, string> = {
  '4381': 'customer',
  '4382': 'operator',
  '4383': 'hq',
  '4384': 'kiosk',
  '4385': 'display',
};

let report: CoverageReport | null = null;

function appRoot(distFile = ''): string | null {
  try {
    const port = new URL(distFile).port;
    return appByPort[port] ? resolve(workspaceRoot, 'apps', appByPort[port]) : null;
  } catch {
    return null;
  }
}

export function normalizeCoveragePath(filePath: string, distFile = ''): string {
  let clean = decodeURIComponent(filePath.split('?')[0] ?? filePath).replaceAll('\\', '/');
  clean = clean.replace(/^file:\/\//, '').replace(/^webpack:\/\/[^/]*\//, '');
  clean = clean.replace(/^\.\//, '').replace(/^\/(?:_next|_expo)\//, '');
  clean = clean.replace(/^.*node_modules\/@platform\//, 'packages/');
  for (const marker of ['apps/', 'packages/', 'scripts/']) {
    const markerIndex = clean.indexOf(marker);
    if (markerIndex >= 0) return resolve(workspaceRoot, clean.slice(markerIndex));
  }
  if (isAbsolute(clean)) return clean;
  const root = appRoot(distFile);
  if (!root) return resolve(workspaceRoot, clean);
  const sourceMatch = clean.match(/(?:^|\/)(src|app|components|lib)\/(.+)$/);
  const sourceDir = sourceMatch?.[1];
  const sourceTail = sourceMatch?.[2];
  return sourceDir && sourceTail ? resolve(root, sourceDir, sourceTail) : resolve(root, clean);
}

export function isProjectSource(filePath: string): boolean {
  const clean = filePath.split('?')[0]?.replaceAll('\\', '/') ?? filePath;
  if (!clean.endsWith('.ts')) return false;
  const workspacePackage = clean.includes('/node_modules/@platform/');
  if ((clean.includes('/node_modules/') && !workspacePackage) || clean.includes('/dist-e2e/')) return false;
  if (workspacePackage) return true;
  return /(?:^|\/)(?:apps|packages|scripts)\//.test(clean)
    || /(?:^|\/)(?:src|app|components|lib)\//.test(clean);
}

function coverageReport(): CoverageReport | null {
  const outputDir = process.env.BROWSER_COVERAGE_DIR;
  if (!outputDir) return null;
  report ??= new CoverageReport({
    name: 'Hosted browser coverage',
    baseDir: workspaceRoot,
    outputDir,
    reports: ['json', 'json-summary'],
    entryFilter: (entry) => /^http:\/\/127\.0\.0\.1:438[1-5]\//.test(entry.url),
    sourceFilter: isProjectSource,
    sourcePath: (sourcePath, info) => normalizeCoveragePath(sourcePath, info.distFile),
    logging: 'info',
  });
  return report;
}

export async function startBrowserCoverage(page: Page): Promise<boolean> {
  if (!coverageReport()) return false;
  await page.coverage.startJSCoverage({ resetOnNavigation: false, reportAnonymousScripts: false });
  return true;
}

export async function stopBrowserCoverage(page: Page, started: boolean): Promise<void> {
  if (!started) return;
  const coverage = await page.coverage.stopJSCoverage();
  await coverageReport()?.add(coverage);
}

export async function writeBrowserCoverage(): Promise<void> {
  if (!report) return;
  await report.generate();
  report = null;
}
