import type { PrintStorage } from './print-outbox';

export type PrinterPreferences = {
  enabled: boolean;
  printerName: string | null;
  printerUrl: string | null;
};

const VERSION = 1;
export const EMPTY_PRINTER_PREFERENCES: PrinterPreferences = {
  enabled: false,
  printerName: null,
  printerUrl: null,
};

function storageKey(locationId: string): string {
  return `platform:operator-printer:${locationId}`;
}

export async function loadPrinterPreferences(
  storage: PrintStorage,
  locationId: string,
): Promise<PrinterPreferences> {
  try {
    const raw = await storage.getItem(storageKey(locationId));
    if (!raw) return EMPTY_PRINTER_PREFERENCES;
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.version !== VERSION) return EMPTY_PRINTER_PREFERENCES;
    const printerName = typeof value.printerName === 'string' ? value.printerName : null;
    const printerUrl = typeof value.printerUrl === 'string' ? value.printerUrl : null;
    return { enabled: value.enabled === true && printerUrl !== null, printerName, printerUrl };
  } catch {
    return EMPTY_PRINTER_PREFERENCES;
  }
}

export async function savePrinterPreferences(
  storage: PrintStorage,
  locationId: string,
  preferences: PrinterPreferences,
): Promise<boolean> {
  try {
    await storage.setItem(storageKey(locationId), JSON.stringify({ version: VERSION, ...preferences }));
    return true;
  } catch {
    return false;
  }
}
