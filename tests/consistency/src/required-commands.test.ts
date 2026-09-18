import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { requireCommands } from './required-commands.ts';

describe('requireCommands', () => {
  it('passes when every command is on PATH', () => {
    assert.doesNotThrow(() => requireCommands('sh'));
  });

  it('names every missing command, so a one-line failure summary still says which', () => {
    assert.throws(
      () => requireCommands('sh', 'no-such-command-7f3a', 'no-such-command-9c1e'),
      /not found on PATH: no-such-command-7f3a, no-such-command-9c1e\./,
    );
  });

  it('treats a name as a command, never as shell to run', () => {
    assert.throws(() => requireCommands('sh; exit 0'), /not found on PATH: sh; exit 0\./);
  });
});
