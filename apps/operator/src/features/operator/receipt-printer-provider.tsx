import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { Alert, Platform } from 'react-native';

import { orderReceiptHtml } from './order-receipt';
import {
  enqueuePrintJob, loadPrintOutbox, nextPrintJob, recordPrintAttempt,
  MAX_PRINT_ATTEMPTS, recordPrintSuccess, savePrintOutbox, type PrintOutbox,
} from './print-outbox';
import {
  EMPTY_PRINTER_PREFERENCES, loadPrinterPreferences, savePrinterPreferences,
  type PrinterPreferences,
} from './printer-preferences';
import { useOperator } from '@/state/operator-store';

const PRINT_TIMEOUT_MS = 15_000;
const RETRY_DELAY_MS = 2_000;

class PrintTimeoutError extends Error {
  override name = 'PrintTimeoutError';
}

function warnPrintFailure(message: string, context: Record<string, unknown>): void {
  console.warn(message, context);
}

function showPrinterFailure(message: string): void {
  Alert.alert('Ticket printer needs attention', message);
}

function withTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new PrintTimeoutError('The printer did not respond.')), PRINT_TIMEOUT_MS);
  });
  return Promise.race([operation, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Turns the board's printer toggle into a real local, durable print path.
 * Jobs are queued before the native print call and retries are visibly marked
 * as copies, so an app restart cannot silently make a duplicate kitchen order.
 */
export function ReceiptPrinterProvider({ children }: PropsWithChildren) {
  const { location, orders, settings, updateSettings } = useOperator();
  const [hydratedLocation, setHydratedLocation] = useState<string | null>(null);
  const preferences = useRef<PrinterPreferences>(EMPTY_PRINTER_PREFERENCES);
  const outbox = useRef<PrintOutbox>({ jobs: [], printedIds: [] });
  const priorStatuses = useRef(new Map<string, string>());
  const draining = useRef(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeLocation = useRef(location.id);
  const persistence = useRef<Promise<boolean>>(Promise.resolve(true));
  const drainLatest = useRef<() => void>(() => undefined);
  activeLocation.current = location.id;

  const persist = useCallback((locationId: string, snapshot: PrintOutbox) => {
    const write = persistence.current.then(() => savePrintOutbox(AsyncStorage, locationId, snapshot));
    persistence.current = write;
    return write;
  }, []);

  const drain = useCallback(async () => {
    if (draining.current || hydratedLocation !== location.id || activeLocation.current !== location.id) return;
    const selected = preferences.current;
    const job = nextPrintJob(outbox.current);
    if (!selected.enabled || !selected.printerUrl || !job || Platform.OS !== 'ios') return;
    draining.current = true;
    outbox.current = recordPrintAttempt(outbox.current, job.id);
    const attempt = outbox.current.jobs.find((candidate) => candidate.id === job.id)?.attempts ?? 1;
    const attemptPersisted = await persist(location.id, outbox.current);
    if (!attemptPersisted) {
      warnPrintFailure('Local receipt print paused because its durable queue could not be saved.', {
        orderId: job.order.id,
      });
      showPrinterFailure(`Order ${job.order.shortCode} was not printed. Keep it on screen and print it manually.`);
      draining.current = false;
      return;
    }
    try {
      const Print = await import('expo-print');
      await withTimeout(Print.printAsync({
        html: orderReceiptHtml({
          locationName: job.locationName,
          order: job.order,
          printedAt: job.queuedAt,
        }, attempt),
        printerUrl: selected.printerUrl,
      }));
      if (activeLocation.current !== location.id) return;
      outbox.current = recordPrintSuccess(outbox.current, job.id);
      await persist(location.id, outbox.current);
    } catch (error) {
      warnPrintFailure('Local receipt print failed.', {
        attempt,
        errorName: error instanceof Error ? error.name : 'UnknownError',
        orderId: job.order.id,
      });
      if (attempt >= MAX_PRINT_ATTEMPTS) {
        showPrinterFailure(`Order ${job.order.shortCode} could not be confirmed after two attempts. Print it manually.`);
      }
    } finally {
      draining.current = false;
      if (nextPrintJob(outbox.current)) {
        retryTimer.current = setTimeout(() => drainLatest.current(), RETRY_DELAY_MS);
      }
    }
  }, [hydratedLocation, location.id, persist]);
  drainLatest.current = () => void drain();

  useEffect(() => {
    let active = true;
    setHydratedLocation(null);
    priorStatuses.current = new Map(orders.map((order) => [order.id, order.status]));
    Promise.all([
      loadPrinterPreferences(AsyncStorage, location.id),
      loadPrintOutbox(AsyncStorage, location.id),
    ]).then(([storedPreferences, storedOutbox]) => {
      if (!active) return;
      preferences.current = storedPreferences;
      outbox.current = storedOutbox;
      updateSettings({ printerEnabled: storedPreferences.enabled });
      setHydratedLocation(location.id);
    });
    return () => {
      active = false;
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
    // The location is the storage boundary; order changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.id]);

  useEffect(() => {
    if (hydratedLocation !== location.id) return;
    const enabled = settings.printerEnabled;
    if (!enabled) {
      preferences.current = { ...preferences.current, enabled: false };
      void savePrinterPreferences(AsyncStorage, location.id, preferences.current)
        .then((saved) => {
          if (!saved) warnPrintFailure('Printer preference could not be saved.', { locationId: location.id });
        });
      return;
    }
    if (preferences.current.printerUrl) {
      preferences.current = { ...preferences.current, enabled: true };
      void savePrinterPreferences(AsyncStorage, location.id, preferences.current);
      void drain();
      return;
    }
    if (Platform.OS !== 'ios') {
      updateSettings({ printerEnabled: false });
      showPrinterFailure('Automatic local printing currently requires the iOS operator app and an AirPrint printer.');
      return;
    }
    void import('expo-print').then((Print) => Print.selectPrinterAsync()).then((printer) => {
      preferences.current = { enabled: true, printerName: printer.name, printerUrl: printer.url };
      return savePrinterPreferences(AsyncStorage, location.id, preferences.current);
    }).then((saved) => {
      if (!saved) throw new Error('Printer preference could not be saved.');
      return drain();
    }).catch(() => updateSettings({ printerEnabled: false }));
  }, [drain, hydratedLocation, location.id, settings.printerEnabled, updateSettings]);

  useEffect(() => {
    if (hydratedLocation !== location.id) return;
    let changed = false;
    for (const order of orders) {
      const previous = priorStatuses.current.get(order.id);
      if (
        preferences.current.enabled
        && previous
        && previous !== 'in_progress'
        && order.status === 'in_progress'
      ) {
        const queued = enqueuePrintJob(outbox.current, {
          locationId: location.id,
          locationName: location.name,
          order,
          queuedAt: new Date().toISOString(),
        });
        if (queued !== outbox.current) changed = true;
        outbox.current = queued;
      }
      priorStatuses.current.set(order.id, order.status);
    }
    if (changed) {
      void persist(location.id, outbox.current).then((saved) => {
        if (saved) void drain();
        else warnPrintFailure('Receipt was not printed because its durable queue could not be saved.', {
          locationId: location.id,
        });
        if (!saved) showPrinterFailure('The ticket queue could not be saved. Keep this order on screen and print it manually.');
      });
    }
  }, [drain, hydratedLocation, location.id, location.name, orders, persist]);

  return children;
}
