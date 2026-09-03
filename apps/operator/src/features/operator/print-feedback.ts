import { Alert } from 'react-native';

/**
 * How a failing local print reaches the counter: a structured warning for the
 * log and one plain sentence for the person holding the tablet.
 *
 * Lifted out of `receipt-printer-provider.tsx` when the queue moved into
 * SecureStore, purely so the provider stays inside the file-size rule.
 */

export const PRINT_TIMEOUT_MS = 15_000;
export const RETRY_DELAY_MS = 2_000;

export class PrintTimeoutError extends Error {
  override name = 'PrintTimeoutError';
}

/** Never carries the order itself: a ticket is the guest's name and their cart. */
export function warnPrintFailure(message: string, context: Record<string, unknown>): void {
  console.warn(message, context);
}

export function showPrinterFailure(message: string): void {
  Alert.alert('Ticket printer needs attention', message);
}

/** A printer that never answers must not hold the queue open forever. */
export function withTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new PrintTimeoutError('The printer did not respond.')), PRINT_TIMEOUT_MS);
  });
  return Promise.race([operation, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
