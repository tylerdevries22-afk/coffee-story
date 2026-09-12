import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/**
 * `expo config --type introspect --platform android` runs every config
 * plugin (this repository's own `with-media-projection.cjs` included) and
 * prints the resulting Android section as JSON -- the same package name,
 * permissions, and blockedPermissions `expo prebuild` would write into
 * AndroidManifest.xml. Reading it from stdin, rather than a file, means
 * this never has to name or clean up an output path: the CI step already
 * captured the JSON, and this is only responsible for judging it.
 *
 * This is a minimum bar, not a manifest diff: it asserts the values a
 * broken plugin, a missing tenant field, or a typo'd permission string
 * would most plausibly corrupt. It does not compare against a golden
 * manifest, because introspection cannot reproduce the XML merge `expo
 * prebuild` performs -- see the workflow step for what stays uncovered.
 */
type IntrospectedConfig = {
  android?: {
    package?: unknown;
    permissions?: unknown;
    blockedPermissions?: unknown;
  };
};

const JAVA_PACKAGE_NAME = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;

function readStdin(stream: NodeJS.ReadStream): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let data = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => { data += chunk; });
    stream.on('end', () => resolvePromise(data));
    stream.on('error', reject);
  });
}

function assertPermissionList(value: unknown, field: string, label: string): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${label}: android.${field} did not resolve to an array of strings: ${JSON.stringify(value)}`);
  }
}

export function assertAndroidConfig(rawJson: string, label: string): void {
  let parsed: IntrospectedConfig;
  try {
    parsed = JSON.parse(rawJson) as IntrospectedConfig;
  } catch {
    throw new Error(`${label}: expo config --type introspect did not print valid JSON.`);
  }
  const android = parsed.android;
  if (android === undefined || android === null) {
    throw new Error(`${label}: introspected config has no android section at all.`);
  }
  if (typeof android.package !== 'string' || !JAVA_PACKAGE_NAME.test(android.package)) {
    throw new Error(
      `${label}: android.package did not resolve to a valid Java package name: ${JSON.stringify(android.package)}`,
    );
  }
  assertPermissionList(android.permissions, 'permissions', label);
  assertPermissionList(android.blockedPermissions, 'blockedPermissions', label);
  console.log(
    `${label}: package=${android.package} `
    + `permissions=${JSON.stringify(android.permissions ?? [])} `
    + `blockedPermissions=${JSON.stringify(android.blockedPermissions ?? [])}`,
  );
}

function argument(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing --${name}.`);
  return value;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  (async () => {
    try {
      const label = argument('label');
      const rawJson = await readStdin(process.stdin);
      assertAndroidConfig(rawJson, label);
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Android config assertion failed.');
      process.exitCode = 1;
    }
  })();
}
