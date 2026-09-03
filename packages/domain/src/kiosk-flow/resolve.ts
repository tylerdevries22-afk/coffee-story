/**
 * The three public entry points, and the single walk behind all of them.
 */

import { catalogPresentation, entryNodesFromCategories } from './entry-derived';
import { readNodes } from './entry-nodes';
import { FAMILIES, MAX_PROMPT, UTILITIES } from './limits';
import { asRecord, oneOf, text, uniqueMembers } from './primitives';
import { readAttract, readIdentify, readIdle, readSurvey, readTip } from './readers';
import { readTenders } from './tenders';
import { DEFAULT_KIOSK_FLOW, EMPTY_MENU_FACTS } from './types';

import type { KioskFlow, KioskFlowContext, KioskFlowNote } from './types';

/**
 * Merges a tenant's (untrusted, possibly partial or malformed) kiosk config
 * over the defaults, field by field.
 */
export function resolveKioskFlow(config: unknown, context: KioskFlowContext = {}): KioskFlow {
  return walk(config, context, null);
}

/**
 * The same walk, reporting what it would drop rather than dropping it silently.
 *
 * Deliberately the same function with a note sink rather than a second
 * implementation: two copies of these rules would drift within a release, and
 * the copy HQ shows a brand owner is the one that must match the device.
 */
export function inspectKioskFlow(config: unknown, context: KioskFlowContext = {}): KioskFlowNote[] {
  const notes: KioskFlowNote[] = [];
  walk(config, context, notes);
  return notes;
}

/**
 * What HQ persists.
 *
 * Drops the entry list when it was derived. Saving a derived list would freeze
 * this week's menu into stored config, and the kiosk would quietly stop
 * following the menu from then on -- the silent-drift class this whole change
 * exists to close.
 */
export function normalizeForSave(flow: KioskFlow): Record<string, unknown> {
  const { entryDerived, entry, ...rest } = flow;
  return {
    ...rest,
    entry: entryDerived ? { prompt: entry.prompt } : entry,
  };
}

function walk(config: unknown, context: KioskFlowContext, notes: KioskFlowNote[] | null): KioskFlow {
  const source = asRecord(config);
  const menu = context.menu ?? EMPTY_MENU_FACTS;
  const configured = readNodes(source?.entry, menu, notes);
  const catalogDriven = menu.categories.some((category) => category.aliases !== undefined);
  const entryDerived = configured.length === 0;
  const derived = entryNodesFromCategories(menu.categories);
  const nodes = catalogDriven ? catalogPresentation(derived, configured) : entryDerived ? derived : configured;
  if (entryDerived && notes && asRecord(source?.entry)?.nodes !== undefined) {
    notes.push({
      path: 'kiosk.entry.nodes',
      message: 'No usable tile survived; the first screen is being derived from the menu.',
    });
  }

  return {
    attract: readAttract(source?.attract),
    entry: {
      prompt: text(asRecord(source?.entry)?.prompt, MAX_PROMPT) ?? DEFAULT_KIOSK_FLOW.entry.prompt,
      nodes,
    },
    family: oneOf(source?.family, FAMILIES, DEFAULT_KIOSK_FLOW.family),
    utilities: uniqueMembers(source?.utilities, UTILITIES),
    identify: readIdentify(source?.identify),
    tenders: readTenders(source?.tenders, context.features, notes),
    tip: readTip(source?.tip, notes),
    guestName: {
      mode: oneOf(
        asRecord(source?.guestName)?.mode,
        ['off', 'optional', 'required'] as const,
        DEFAULT_KIOSK_FLOW.guestName.mode,
      ),
    },
    survey: readSurvey(source?.survey, notes),
    idle: readIdle(source?.idle, notes),
    motion: oneOf(source?.motion, ['full', 'reduced'] as const, DEFAULT_KIOSK_FLOW.motion),
    entryDerived,
  };
}
