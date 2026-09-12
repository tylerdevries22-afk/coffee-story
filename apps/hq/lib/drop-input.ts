/**
 * Pure validation for the "Schedule a drop" form. `drops.item_id` is a
 * required foreign key (rule 5 / the rotating-drop model), so the form offers
 * a select of the brand's own menu items rather than free text -- there is no
 * path here that creates a menu item on the fly.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DropDraft = {
  readonly itemId: string;
  readonly startsAt: string;
  readonly endsAt: string;
};

export type DropInput = {
  itemId?: string;
  startsAt?: string;
  endsAt?: string;
};

function parseWallClock(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function parseDropDraft(input: DropInput):
  { ok: true; draft: DropDraft } | { ok: false; error: string } {
  const itemId = (input.itemId ?? '').trim();
  if (!UUID.test(itemId)) return { ok: false, error: 'Choose which menu item is dropping.' };

  const starts = parseWallClock(input.startsAt);
  if (!starts) return { ok: false, error: 'Enter a valid start date and time.' };
  const ends = parseWallClock(input.endsAt);
  if (!ends) return { ok: false, error: 'Enter a valid end date and time.' };
  // Matches the `ends_at > starts_at` check on public.drops -- caught here so
  // the form gets a plain-language message instead of a database error.
  if (ends.getTime() <= starts.getTime()) {
    return { ok: false, error: 'The drop must end after it starts.' };
  }

  return { ok: true, draft: { itemId, startsAt: starts.toISOString(), endsAt: ends.toISOString() } };
}
