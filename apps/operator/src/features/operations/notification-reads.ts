const NOTIFICATION_ACKNOWLEDGEMENT_LIMIT = 100;

type NotificationReadListener = (ids: ReadonlySet<string>) => void;

export function operationNotificationBatches(
  ids: readonly string[],
  limit = NOTIFICATION_ACKNOWLEDGEMENT_LIMIT,
): readonly (readonly string[])[] {
  if (!Number.isInteger(limit) || limit < 1) return [];
  const uniqueIds = [...new Set(ids)];
  const batches: string[][] = [];
  for (let offset = 0; offset < uniqueIds.length; offset += limit) {
    batches.push(uniqueIds.slice(offset, offset + limit));
  }
  return batches;
}

export function createOperationNotificationReadBus() {
  const listeners = new Set<NotificationReadListener>();
  return {
    publish(ids: readonly string[]): void {
      if (ids.length === 0) return;
      const readIds = new Set(ids);
      for (const listener of listeners) listener(readIds);
    },
    subscribe(listener: NotificationReadListener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const operationNotificationReadBus = createOperationNotificationReadBus();
