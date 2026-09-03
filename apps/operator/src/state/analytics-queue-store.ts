import { createAnalyticsQueueStore, type AnalyticsQueueStore } from '@platform/analytics';

/**
 * On-device backing for the analytics queue.
 *
 * `@platform/analytics` carries no runtime dependencies -- HQ and the pickup
 * display import it too -- so it owns the write-then-rename algorithm and this
 * module owns the only thing that is native: the file handles.
 *
 * expo-file-system stays behind a dynamic `await import()` for the same reason
 * `portal-store.ts` does: `node:test` must never evaluate a native module while
 * exercising the pure parsers around it. Opening is lazy and its failure is
 * swallowed, because a device that cannot open the file must still send
 * telemetry -- it just loses the restart guarantee.
 *
 * One file per brand. A tablet signed into a second tenant must not inherit
 * the first tenant's buffered events, and a brand-keyed name is what lets a
 * tenant-switch purge find them.
 */

const QUEUE_FILE_PREFIX = 'analytics-queue';

function fileName(brandId: string): string {
  // The id reaches here from a JWT claim, so it is shaped by the token, not by
  // this app. Narrowing it to the characters a filename may hold keeps a
  // surprising claim from naming a path instead of a file.
  return `${QUEUE_FILE_PREFIX}.${brandId.replace(/[^a-zA-Z0-9-]/g, '')}.json`;
}

export function analyticsQueueStore(brandId: string): AnalyticsQueueStore {
  let opening: Promise<AnalyticsQueueStore | null> | null = null;
  const open = (): Promise<AnalyticsQueueStore | null> => {
    opening ??= (async () => {
      try {
        const { File, Paths } = await import('expo-file-system');
        const name = fileName(brandId);
        return createAnalyticsQueueStore({
          target: new File(Paths.document, name),
          temp: new File(Paths.document, `${name}.tmp`),
        });
      } catch {
        return null;
      }
    })();
    return opening;
  };

  return Object.freeze({
    load: async () => (await open())?.load() ?? [],
    save: async (queue) => { await (await open())?.save(queue); },
    clear: async () => { await (await open())?.clear(); },
  });
}
