import type { PlaceDetails } from '@platform/engine';
import type { SupabaseClient } from '@supabase/supabase-js';

type Answer = { readonly data?: unknown; readonly error?: unknown };

export type RunnerCall = { readonly kind: string; readonly target: string; readonly args: readonly unknown[] };

export type RunnerScript = {
  readonly rpc?: Readonly<Record<string, Answer>>;
  /** Answers to list reads (`...limit(n)`), by table. */
  readonly select?: Readonly<Record<string, Answer>>;
  /** Answers to inserts, by table. */
  readonly insert?: Readonly<Record<string, Answer>>;
  readonly listed?: readonly { readonly name: string }[];
  readonly removeError?: unknown;
};

function answer(value: Answer | undefined) {
  return { data: value?.data ?? null, error: value?.error ?? null };
}

/**
 * Just enough of the service client for the runner, recording every call --
 * table reads with the filters they applied, inserts with their rows,
 * storage and RPCs -- so a test can assert what reached the database.
 */
export function fakeRunnerDb(script: RunnerScript = {}) {
  const calls: RunnerCall[] = [];
  const query = (table: string) => {
    const filters: unknown[] = [];
    const builder = {
      select: (columns: string) => { filters.push(['select', columns]); return builder; },
      eq: (column: string, value: unknown) => { filters.push(['eq', column, value]); return builder; },
      in: (column: string, values: unknown) => { filters.push(['in', column, values]); return builder; },
      limit: async (count: number) => {
        calls.push({ kind: 'select', target: table, args: [...filters, ['limit', count]] });
        return answer(script.select?.[table]);
      },
      insert: async (row: unknown) => {
        calls.push({ kind: 'insert', target: table, args: [row] });
        return answer(script.insert?.[table]);
      },
    };
    return builder;
  };
  const db = {
    rpc: async (name: string, args: unknown) => {
      calls.push({ kind: 'rpc', target: name, args: [args] });
      return answer(script.rpc?.[name]);
    },
    from: query,
    storage: {
      from: (bucket: string) => ({
        list: async (prefix: string) => {
          calls.push({ kind: 'list', target: bucket, args: [prefix] });
          return { data: script.listed ?? [], error: null };
        },
        remove: async (paths: string[]) => {
          calls.push({ kind: 'remove', target: bucket, args: [paths] });
          return { data: [], error: script.removeError ?? null };
        },
      }),
    },
  };
  return { db: db as unknown as Pick<SupabaseClient, 'rpc' | 'from' | 'storage'>, calls };
}

/** An operating café in Boulder, as the Places client hands it back. */
export const CAFE: PlaceDetails = {
  placeId: 'ChIJHarborRoastBoulder',
  name: 'Harbor Roast',
  formattedAddress: '1 Pier Way, Boulder, CO 80302, USA',
  address: { street: '1 Pier Way', city: 'Boulder', region: 'CO', postal: '80302', country: 'US' },
  location: { lat: 40.015, lng: -105.27 },
  timeZone: 'America/Denver',
  rating: 4.7,
  userRatingCount: 212,
  websiteUri: 'https://www.harborroast.example/',
  phone: '+1 303-555-0100',
  weekdayDescriptions: ['Monday: 7:00 AM – 3:00 PM', 'Tuesday: 7:00 AM – 3:00 PM'],
  openingPeriods: [
    { openDay: 1, open: '07:00', closeDay: 1, close: '15:00' },
    { openDay: 2, open: '07:00', closeDay: 2, close: '15:00' },
  ],
  photoNames: [],
  types: ['coffee_shop', 'cafe', 'food'],
  primaryType: 'coffee_shop',
  businessStatus: 'OPERATIONAL',
  mapsUri: 'https://maps.google.com/?cid=1',
  reviewsUri: 'https://www.google.com/maps/place//data=reviews',
  writeReviewUri: null,
};
