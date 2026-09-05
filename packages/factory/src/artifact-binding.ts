import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const EXCLUDED = new Set(['release.json', '.DS_Store']);

function artifactFiles(root: string, directory = root): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    const name = relative(root, path).split(sep).join('/');
    if (entry.isDirectory()) return artifactFiles(root, path);
    if (EXCLUDED.has(name)) return [];
    if (!entry.isFile() || lstatSync(path).isSymbolicLink()) {
      throw new Error(`Tenant artifact contains an unsupported entry: ${name}`);
    }
    return [path];
  });
}

export function tenantArtifactDigest(directory: string): string {
  const hash = createHash('sha256');
  const files = artifactFiles(directory).sort((left, right) => left.localeCompare(right));
  if (files.length === 0) throw new Error('Tenant artifact contains no releasable files.');
  for (const path of files) {
    const name = relative(directory, path).split(sep).join('/');
    const content = readFileSync(path);
    hash.update(`${name.length}:${name}:${content.length}:`);
    hash.update(content);
  }
  return `sha256:${hash.digest('hex')}`;
}
