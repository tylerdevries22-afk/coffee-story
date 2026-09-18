import type { SupabaseClient } from '@supabase/supabase-js';

export type DemoDbCall = { readonly kind: string; readonly args: readonly unknown[] };

export type DemoDbScript = {
  readonly rpcData?: unknown;
  readonly rpcError?: unknown;
  readonly row?: unknown;
  readonly selectError?: unknown;
  readonly listed?: readonly { readonly name: string }[];
  readonly listError?: unknown;
  readonly removeError?: unknown;
  readonly download?: Blob | null;
  readonly insertError?: unknown;
};

/**
 * Just enough of the service client for lib/demo-site.ts, recording every
 * call so a test can assert what reached the database -- above all, that the
 * raw link token never did.
 */
export function fakeDemoDb(script: DemoDbScript = {}) {
  const calls: DemoDbCall[] = [];
  const db = {
    rpc: async (name: string, args: unknown) => {
      calls.push({ kind: 'rpc', args: [name, args] });
      return { data: script.rpcData ?? null, error: script.rpcError ?? null };
    },
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: (column: string, value: unknown) => ({
          maybeSingle: async () => {
            calls.push({ kind: 'select', args: [table, columns, column, value] });
            return { data: script.row ?? null, error: script.selectError ?? null };
          },
        }),
      }),
      insert: async (row: unknown) => {
        calls.push({ kind: 'insert', args: [table, row] });
        return { data: null, error: script.insertError ?? null };
      },
    }),
    storage: {
      from: (bucket: string) => ({
        list: async (prefix: string) => {
          calls.push({ kind: 'list', args: [bucket, prefix] });
          return { data: script.listed ?? [], error: script.listError ?? null };
        },
        remove: async (paths: string[]) => {
          calls.push({ kind: 'remove', args: [bucket, paths] });
          return { data: [], error: script.removeError ?? null };
        },
        download: async (path: string) => {
          calls.push({ kind: 'download', args: [bucket, path] });
          return script.download ? { data: script.download, error: null } : { data: null, error: { message: 'missing' } };
        },
      }),
    },
  };
  return { db: db as unknown as Pick<SupabaseClient, 'rpc' | 'from' | 'storage'>, calls };
}
