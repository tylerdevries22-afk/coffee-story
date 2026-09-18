import type { SupabaseClient } from '@supabase/supabase-js';

export type FactoryCall = { readonly kind: string; readonly args: readonly unknown[] };

export type FactoryScript = {
  readonly rpc?: Readonly<Record<string, { readonly data?: unknown; readonly error?: unknown }>>;
  readonly settingsRow?: unknown;
  readonly selectError?: unknown;
  readonly insertError?: unknown;
  readonly updateError?: unknown;
};

/**
 * Just enough of the service client for lib/demo-factory, recording every
 * call so a test can assert exactly what reached the database.
 */
export function fakeFactoryDb(script: FactoryScript = {}) {
  const calls: FactoryCall[] = [];
  const db = {
    rpc: async (name: string, args: unknown) => {
      calls.push({ kind: 'rpc', args: [name, args] });
      const answer = script.rpc?.[name];
      return { data: answer?.data ?? null, error: answer?.error ?? null };
    },
    from: (table: string) => ({
      insert: async (row: unknown) => {
        calls.push({ kind: 'insert', args: [table, row] });
        return { data: null, error: script.insertError ?? null };
      },
      update: (columns: unknown) => ({
        eq: async (column: string, value: unknown) => {
          calls.push({ kind: 'update', args: [table, columns, column, value] });
          return { data: null, error: script.updateError ?? null };
        },
      }),
      select: (columns: string) => ({
        eq: (column: string, value: unknown) => ({
          maybeSingle: async () => {
            calls.push({ kind: 'select', args: [table, columns, column, value] });
            return { data: script.settingsRow ?? null, error: script.selectError ?? null };
          },
        }),
      }),
    }),
  };
  return { db: db as unknown as Pick<SupabaseClient, 'rpc' | 'from'>, calls };
}
