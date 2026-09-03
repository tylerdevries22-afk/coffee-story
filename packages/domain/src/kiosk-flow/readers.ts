/**
 * The field readers that need no menu: attract, identify, tip, survey, idle.
 *
 * Each one clamps or drops rather than throwing, and each says so through the
 * note sink, so the account HQ shows a brand owner is the same walk the device
 * runs.
 */

import {
  IDENTIFY_METHODS,
  KIOSK_IDLE_MAX_MS,
  KIOSK_IDLE_MIN_MS,
  MAX_LABEL,
  MAX_PROMPT,
  MAX_SURVEY_GROUPS,
  MAX_SURVEY_OPTIONS,
  MAX_TIP_PRESETS,
  MIN_IDLE_GAP_MS,
} from './limits';
import { asRecord, bool, clampInt, note, oneOf, text, uniqueMembers } from './primitives';
import { DEFAULT_KIOSK_FLOW } from './types';

import type { KioskFlow, KioskFlowNote, KioskSurveyGroup, KioskSurveyOption } from './types';

export function readAttract(value: unknown): KioskFlow['attract'] {
  const source = asRecord(value);
  return {
    headline: text(source?.headline, MAX_PROMPT),
    invite: text(source?.invite, MAX_PROMPT) ?? DEFAULT_KIOSK_FLOW.attract.invite,
    showLogo: bool(source?.showLogo, DEFAULT_KIOSK_FLOW.attract.showLogo),
  };
}

export function readIdentify(value: unknown): KioskFlow['identify'] {
  const source = asRecord(value);
  const methods = uniqueMembers(source?.methods, IDENTIFY_METHODS);
  const mode = oneOf(source?.mode, ['off', 'optional'] as const, DEFAULT_KIOSK_FLOW.identify.mode);
  // Identify with no way to identify is off, not a dead end the guest can enter.
  if (mode === 'off' || methods.length === 0) return { mode: 'off', methods: [] };
  return { mode, methods };
}

export function readTip(value: unknown, notes: KioskFlowNote[] | null): KioskFlow['tip'] {
  const source = asRecord(value);
  const enabled = bool(source?.enabled, DEFAULT_KIOSK_FLOW.tip.enabled);
  if (!enabled) return { enabled: false, presetsCents: [] };
  const presets = Array.isArray(source?.presetsCents) ? source.presetsCents : [];
  const cents: number[] = [];
  for (const preset of presets) {
    if (cents.length >= MAX_TIP_PRESETS) break;
    // Integer cents, never float dollars (CLAUDE.md), and never negative: a
    // "tip" that took money off would be a discount with a friendly name.
    if (typeof preset !== 'number' || !Number.isInteger(preset) || preset <= 0) continue;
    if (!cents.includes(preset)) cents.push(preset);
  }
  if (cents.length > 0) return { enabled: true, presetsCents: cents };
  note(notes, 'kiosk.tip', 'Tipping is on but no usable preset survived, so it is off.');
  return { enabled: false, presetsCents: [] };
}

export function readSurvey(value: unknown, notes: KioskFlowNote[] | null): KioskFlow['survey'] {
  const source = asRecord(value);
  if (!bool(source?.enabled, false)) return { enabled: false, prompt: '', groups: [] };
  const raw = Array.isArray(source?.groups) ? source.groups : [];
  const groups: KioskSurveyGroup[] = [];
  const seen = new Set<string>();
  for (const candidate of raw) {
    if (groups.length >= MAX_SURVEY_GROUPS) break;
    const group = asRecord(candidate);
    const id = text(group?.id, MAX_LABEL);
    const label = text(group?.label, MAX_LABEL);
    if (!id || !label || seen.has(id)) continue;
    const options = parseSurveyOptions(group?.options);
    if (options.length === 0) continue;
    seen.add(id);
    groups.push({ id, label, options });
  }
  if (groups.length === 0) {
    note(notes, 'kiosk.survey', 'The survey is on but no group has a usable option, so it is off.');
    return { enabled: false, prompt: '', groups: [] };
  }
  return {
    enabled: true,
    prompt: text(source?.prompt, MAX_PROMPT) ?? 'Where have you heard about us?',
    groups,
  };
}

function parseSurveyOptions(value: unknown): KioskSurveyOption[] {
  if (!Array.isArray(value)) return [];
  const options: KioskSurveyOption[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (options.length >= MAX_SURVEY_OPTIONS) break;
    const option = asRecord(candidate);
    const id = text(option?.id, MAX_LABEL);
    const label = text(option?.label, MAX_LABEL);
    if (!id || !label || seen.has(id)) continue;
    seen.add(id);
    options.push({ id, label });
  }
  return options;
}

/**
 * The idle clock.
 *
 * The warning has to land far enough before the reset to be read and acted on,
 * so a config that inverts them or collapses the gap is corrected rather than
 * honoured -- a warning that appears one second before the bag vanishes is a
 * flicker, not a warning.
 */
export function readIdle(value: unknown, notes: KioskFlowNote[] | null): KioskFlow['idle'] {
  const source = asRecord(value);
  const warnMs = clampInt(
    source?.warnMs, KIOSK_IDLE_MIN_MS, KIOSK_IDLE_MAX_MS, DEFAULT_KIOSK_FLOW.idle.warnMs,
  );
  const resetMs = clampInt(
    source?.resetMs, KIOSK_IDLE_MIN_MS, KIOSK_IDLE_MAX_MS, DEFAULT_KIOSK_FLOW.idle.resetMs,
  );
  if (resetMs - warnMs >= MIN_IDLE_GAP_MS) return { warnMs, resetMs };
  note(notes, 'kiosk.idle.resetMs', 'The reset was moved out so the warning is readable before it lands.');
  return { warnMs, resetMs: Math.min(KIOSK_IDLE_MAX_MS, warnMs + MIN_IDLE_GAP_MS) };
}
