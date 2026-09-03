/**
 * The bounds and the allowed member lists, in one place so a limit cannot drift
 * between the resolver and the inspector. Only the three names the kiosk app
 * and HQ actually read leave this folder; the rest stay internal.
 */

import type {
  KioskIdentifyMethod,
  KioskNodeEmphasis,
  KioskStepFamily,
  KioskTender,
  KioskUtility,
} from './types';

/**
 * Bounds, not preferences.
 *
 * `MAX_ENTRY_NODES` is the one worth explaining: the first screen is read by a
 * standing guest from two or three feet with a queue behind them, and a
 * constellation of thirty circles is not a menu, it is a search problem. Twelve
 * is where a tenant should be nesting instead, and a config that asks for more
 * gets the first twelve rather than an unusable screen.
 */
export const MAX_ENTRY_NODES = 12;
export const MAX_SURVEY_GROUPS = 4;
export const MAX_SURVEY_OPTIONS = 24;
export const MAX_TIP_PRESETS = 4;
export const MAX_LABEL = 60;
export const MAX_PROMPT = 140;

/** A kiosk nobody is standing at must not reset every few seconds, nor sit for an hour. */
export const KIOSK_IDLE_MIN_MS = 15_000;
export const KIOSK_IDLE_MAX_MS = 600_000;
/** The gap the warning needs to be readable and actionable before the reset lands. */
export const MIN_IDLE_GAP_MS = 10_000;

export const EMPHASES: readonly KioskNodeEmphasis[] = ['hero', 'standard', 'minor'];
export const UTILITIES: readonly KioskUtility[] = ['rewards', 'giftBalance', 'allergens'];
export const TENDERS: readonly KioskTender[] = ['card', 'gift_card', 'stored_value', 'cash'];
export const IDENTIFY_METHODS: readonly KioskIdentifyMethod[] = ['phone', 'scan'];
export const FAMILIES: readonly KioskStepFamily[] = ['item', 'pack'];
