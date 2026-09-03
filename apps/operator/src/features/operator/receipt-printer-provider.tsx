import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { Platform } from 'react-native';

import { orderReceiptHtml } from './order-receipt';
import {
  RETRY_DELAY_MS, showPrinterFailure, warnPrintFailure, withTimeout,
} from './print-feedback';
import {
  candidatePrintJob, enqueuePrintJob, nextPrintJob, printJobFits, recordPrintAttempt,
  MAX_PRINT_ATTEMPTS, recordPrintSuccess, type PrintOutbox, type PrintScope,
} from './print-outbox';
import { loadPrintOutbox, purgeLegacyPrintOutbox, savePrintOutbox } from './print-outbox-storage';
import { printSecureStorage } from './print-secure-store';
import {
  EMPTY_PRINTER_PREFERENCES, loadPrinterPreferences, savePrinterPreferences,
  type PrinterPreferences,
} from './printer-preferences';
import { useAuth } from '@/state/auth-context';
import { useOperator } from '@/state/operator-store';

/**
 * Turns the board's printer toggle into a real local, durable print path.
 * Jobs are queued before the native print call and retries are visibly marked
 * as copies, so an app restart cannot silently make a duplicate kitchen order.
 */
export function ReceiptPrinterProvider({ children }: PropsWithChildren) {
  const { location, orders, settings, updateSettings } = useOperator();
  const { tenant } = useAuth();
  // Demo has no tenant claim and its orders are fixtures, not guests. Naming
  // it keeps the demo queue out of whichever brand signs in next.
  const brandId = tenant?.brand_id ?? 'demo';
  const scope: PrintScope = { brandId, locationId: location.id };
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

  const persist = useCallback((target: PrintScope, snapshot: PrintOutbox) => {
    const write = persistence.current.then(() =>
      savePrintOutbox(AsyncStorage, printSecureStorage, target, snapshot));
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
    const attemptPersisted = await persist({ brandId, locationId: location.id }, outbox.current);
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
      await persist({ brandId, locationId: location.id }, outbox.current);
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
  }, [brandId, hydratedLocation, location.id, persist]);
  drainLatest.current = () => void drain();

  useEffect(() => {
    let active = true;
    setHydratedLocation(null);
    priorStatuses.current = new Map(orders.map((order) => [order.id, order.status]));
    // The v1 plaintext queue is the disclosure being fixed, so it goes on the
    // first launch that can see it rather than waiting for a sign-out.
    void purgeLegacyPrintOutbox(AsyncStorage, location.id);
    Promise.all([
      loadPrinterPreferences(AsyncStorage, location.id),
      loadPrintOutbox(AsyncStorage, printSecureStorage, { brandId, locationId: location.id }),
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
    // The tenant and location together are the storage boundary; order changes
    // are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId, location.id]);

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
        const input = { locationName: location.name, order, queuedAt: new Date().toISOString() };
        // SecureStore holds a bounded item, so an implausibly large ticket is
        // named to staff rather than dropped into a queue that would then fail
        // every later save. Nothing silently disappears.
        if (!printJobFits(candidatePrintJob(scope, input))) {
          warnPrintFailure('Receipt exceeded the encrypted queue item limit.', { orderId: order.id });
          showPrinterFailure(`Order ${order.shortCode} is too large to queue. Print it manually.`);
        } else {
          const queued = enqueuePrintJob(outbox.current, scope, input);
          if (queued !== outbox.current) changed = true;
          outbox.current = queued;
        }
      }
      priorStatuses.current.set(order.id, order.status);
    }
    if (changed) {
      void persist(scope, outbox.current).then((saved) => {
        if (saved) void drain();
        else warnPrintFailure('Receipt was not printed because its durable queue could not be saved.', {
          locationId: location.id,
        });
        if (!saved) showPrinterFailure('The ticket queue could not be saved. Keep this order on screen and print it manually.');
      });
    }
    // `scope` is rebuilt each render from brandId and location.id, both of
    // which are already dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId, drain, hydratedLocation, location.id, location.name, orders, persist]);

  return children;
}
