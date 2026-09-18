// Temporary diagnostic reporter for one Fly run: prints each failing leaf test
// as a short "error:" line, because Mission Control keeps only the last lines
// matching /error:/ of a failed check. Not for merging.
import { basename } from 'node:path';

function flat(value, max) {
  return String(value).replace(/\s+/g, ' ').trim().slice(0, max);
}

export default async function* flyDiagnostics(source) {
  const failures = [];
  for await (const event of source) {
    if (event.type !== 'test:fail') continue;
    const { name, file, line, details } = event.data;
    const error = details?.error;
    if (error?.failureType === 'subtestsFailed') continue;
    failures.push({ where: `${basename(file ?? '?')}:${line ?? '?'}`, name, cause: error?.cause ?? error });
  }
  for (const { where, name, cause } of failures.slice(-2)) {
    const detail = cause && typeof cause === 'object' && 'actual' in cause
      ? `A=${flat(JSON.stringify(cause.actual), 40)} E=${flat(JSON.stringify(cause.expected), 40)}`
      : flat(cause?.message ?? cause, 80);
    yield `error: n=${failures.length} ${where} ${flat(name, 45)} ${detail}\n`;
  }
}
