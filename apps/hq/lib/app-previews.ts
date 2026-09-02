import type { IconName } from '@/components/icon';

export const APP_PREVIEW_KEYS = ['hq', 'customer', 'operator', 'kiosk', 'display'] as const;

export type AppPreviewKey = (typeof APP_PREVIEW_KEYS)[number];
export type AppPreviewSource = 'configured' | 'local' | 'unavailable';
export type AppPreviewFrame = 'phone' | 'tablet' | 'computer' | 'tv';
export type AppPreviewEnvironment = Readonly<Record<string, string | undefined>>;

export type AppPreview = {
  readonly key: AppPreviewKey;
  readonly label: string;
  readonly description: string;
  readonly href: string;
  readonly icon: IconName;
  readonly device: string;
  readonly frame: AppPreviewFrame;
  readonly viewport: Readonly<{ width: number; height: number }>;
  readonly environmentKey: string;
  readonly source: AppPreviewSource;
  readonly url: string | null;
};

type AppPreviewDefinition = Omit<AppPreview, 'source' | 'url'> & {
  readonly localUrl: string;
};

const APP_PREVIEWS = {
  hq: {
    key: 'hq', label: 'HQ console', href: '/apps/hq', icon: 'activity',
    description: 'Back-office operations, planning, and team workflows.',
    device: 'iMac desktop', frame: 'computer', viewport: { width: 1440, height: 810 }, environmentKey: 'NEXT_PUBLIC_HQ_URL',
    // Relative avoids a `localhost` / `127.0.0.1` frame-ancestor mismatch.
    localUrl: '/',
  },
  customer: {
    key: 'customer', label: 'Customer', href: '/apps/customer', icon: 'users',
    description: 'Guest ordering, rewards, order status, and account journeys.',
    device: 'iPhone', frame: 'phone', viewport: { width: 390, height: 844 }, environmentKey: 'NEXT_PUBLIC_CUSTOMER_URL',
    localUrl: 'http://localhost:4170/',
  },
  operator: {
    key: 'operator', label: 'Operator', href: '/apps/operator', icon: 'activity',
    description: 'Barista workflow for accepting, preparing, and handing off orders.',
    device: 'iPad Pro landscape', frame: 'tablet', viewport: { width: 1180, height: 884 }, environmentKey: 'NEXT_PUBLIC_OPERATOR_URL',
    localUrl: 'http://localhost:4191/',
  },
  kiosk: {
    key: 'kiosk', label: 'Kiosk / POS', href: '/apps/kiosk', icon: 'kiosk',
    description: 'Self-service menu, checkout, and in-store order capture.',
    device: 'iPad Pro landscape', frame: 'tablet', viewport: { width: 1180, height: 884 }, environmentKey: 'NEXT_PUBLIC_KIOSK_URL',
    localUrl: 'http://localhost:4180/',
  },
  display: {
    key: 'display', label: 'Pickup display', href: '/apps/display', icon: 'wall',
    description: 'The location-scoped queue guests see when their order is ready.',
    device: 'TV display', frame: 'tv', viewport: { width: 1920, height: 1080 }, environmentKey: 'NEXT_PUBLIC_DISPLAY_URL',
    localUrl: 'http://localhost:3200/board/demo',
  },
} satisfies Record<AppPreviewKey, AppPreviewDefinition>;

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function safePreviewUrl(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    const allowedProtocol = url.protocol === 'https:' || (url.protocol === 'http:' && isLoopback(url.hostname));
    return allowedProtocol && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

/** The device silhouette an app previews in, without resolving its URL. */
export function frameOfKey(key: AppPreviewKey): AppPreviewFrame {
  return APP_PREVIEWS[key].frame;
}

/** Resolves a public, frame-safe application URL without accepting an open redirect. */
export function appPreviewFor(
  key: AppPreviewKey,
  environment: AppPreviewEnvironment = process.env,
): AppPreview {
  const definition = APP_PREVIEWS[key];
  const configured = safePreviewUrl(environment[definition.environmentKey]);
  const localPreview = environment.COFFEE_STORY_LOCAL_PREVIEWS === '1';
  const local = environment.NODE_ENV === 'production' && !localPreview ? null : definition.localUrl;
  const url = configured ?? local;
  return {
    ...definition,
    url,
    source: configured ? 'configured' : local ? 'local' : 'unavailable',
  };
}

/** Returns the four customer-facing operational surfaces in navigation order. */
export function appPreviewsFor(environment: AppPreviewEnvironment = process.env): AppPreview[] {
  return APP_PREVIEW_KEYS.map((key) => appPreviewFor(key, environment));
}
