/**
 * Turns `eas update --json` output into the two links IPHONE_EXPO_GO_DEMO.md
 * asks for, and writes them to the run's job summary.
 *
 * A separate file rather than a `node -e` block in the workflow: the script
 * uses template literals and backticks, which have to survive YAML quoting and
 * then shell quoting to get there intact. That is not something a reviewer can
 * check by reading.
 *
 * Never fails the job. The publish has already happened by the time this runs,
 * and reporting is not worth turning a successful deploy red.
 */
import { appendFileSync, readFileSync } from 'node:fs';

const MANIFEST = process.argv[2] ?? 'update.json';

function read() {
  try {
    const parsed = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (error) {
    console.log(`Published, but ${MANIFEST} could not be read as JSON: ${error.message}`);
    return null;
  }
}

const updates = read();
if (updates) {
  const lines = ['## Expo Go preview published', ''];

  for (const update of updates) {
    if (!update?.id) continue;
    lines.push(`### ${update.platform ?? 'unknown platform'}`);
    lines.push(`- Runtime: \`${update.runtimeVersion ?? 'unknown'}\``);
    lines.push(`- Update group: \`${update.group ?? update.id}\``);
    lines.push(`- QR: https://qr.expo.dev/eas-update?updateId=${update.id}`);
    lines.push(`- Deep link: \`exp://u.expo.dev/update/${update.id}\``);
    lines.push('');
  }

  if (lines.length === 2) {
    lines.push('The CLI reported no updates. Check the publish step above.', '');
  } else {
    lines.push(
      'Paste these into `IPHONE_EXPO_GO_DEMO.md`. A publish can mint new update',
      'ids, so an older QR keeps serving an older bundle.',
      '',
    );
  }

  const summary = process.env.GITHUB_STEP_SUMMARY;
  const body = `${lines.join('\n')}\n`;
  if (summary) appendFileSync(summary, body);
  console.log(body);
}
