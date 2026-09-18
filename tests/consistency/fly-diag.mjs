// Temporary diagnostic reporter for one Fly run (not for merging): one line
// naming every failing consistency test file and how many of its tests
// failed, read back by fly-diag-run.mjs.
import { basename } from 'node:path';

export default async function* flyDiagnostics(source) {
  const counts = new Map();
  let total = 0;
  for await (const event of source) {
    if (event.type !== 'test:fail') continue;
    if (event.data.details?.error?.failureType === 'subtestsFailed') continue;
    const file = basename(event.data.file ?? '?').replace(/\.test\.ts$/, '');
    counts.set(file, (counts.get(file) ?? 0) + 1);
    total += 1;
  }
  yield `files=n${total} ${[...counts].map(([file, count]) => `${file}:${count}`).join(',')}\n`;
}
