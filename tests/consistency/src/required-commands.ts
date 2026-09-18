import { spawnSync } from 'node:child_process';

/**
 * Fails a suite before its first test when the shell scripts it runs need a
 * command this machine does not have.
 *
 * The release-script suites run the real scripts, and those call jq -- and
 * sha256sum and git -- the way the GitHub-hosted runners that deploy with them
 * provide. Without this check a missing jq does not fail cleanly: a script
 * meant to succeed exits non-zero several assertions in, and a script meant to
 * refuse refuses anyway, for the wrong reason, so its test passes having
 * tested nothing. Mission Control's Fly workers had exactly this gap, and they
 * keep only a one-line summary of a failed check, so the missing command has
 * to be named in the message itself.
 */
export function requireCommands(...commands: readonly string[]): void {
  const missing = commands.filter(
    (command) => spawnSync('sh', ['-c', 'command -v "$1" >/dev/null 2>&1', 'sh', command]).status !== 0,
  );
  if (missing.length > 0) {
    throw new Error(`Required command not found on PATH: ${missing.join(', ')}. `
      + 'This suite runs the real release scripts, which call it.');
  }
}
