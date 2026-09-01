import type { IconName } from '@/components/icon';

export const APP_PREVIEW_KEYS = ['customer', 'operator', 'kiosk', 'display'] as const;

export type AppPreviewKey = (typeof APP_PREVIEW_KEYS)[number];
export type AppPreviewSource = 'configured' | 'local' | 'unavailable';
export type AppPreviewFrame = 'phone' | 'tablet' | 'wall';
export type AppPreviewEnvironment = Readonly<Record<string, string | undefined>>;

export type AppPreview = {
  readonly key: AppPreviewKey;
  readonly label: string;
  readonly description: string;
  readonly href: string;
  readonly icon: IconName;
  readonly device: string;
  readonly frame: AppPreviewFrame;
  readonly environmentKey: string;
  readonly source: AppPreviewSource;
  readonly url: string | null;
};

type AppPreviewDefinition = Omit<AppPreview, 'source' | 'url'> & {
  readonly localUrl: string;
};

const APP_PREVIEWS = {
  customer: {
    key: 'customer', label: 'Customer', href: '/apps/customer', icon: 'users',
    description: 'Guest ordering, rewards, order status, and account journeys.',
    device: 'Phone', frame: 'phone', environmentKey: 'NEXT_PUBLIC_CUSTOMER_URL',
    localUrl: 'http://localhost:4170/',
  },
  operator: {
    key: 'operator', label: 'Operator', href: '/apps/operator', icon: 'activity',
    description: 'Barista workflow for accepting, preparing, and handing off orders.',
    device: 'Tablet', frame: 'tablet', environmentKey: 'NEXT_PUBLIC_OPERATOR_URL',
    localUrl: 'http://localhost:4191/',
  },
  kiosk: {
    key: 'kiosk', label: 'Kiosk / POS', href: '/apps/kiosk', icon: 'kiosk',
    description: 'Self-service menu, checkout, and in-store order capture.',
    device: 'iPad landscape', frame: 'tablet', environmentKey: 'NEXT_PUBLIC_KIOSK_URL',
    localUrl: 'http://localhost:4180/',
  },
  display: {
    key: 'display', label: 'Pickup display', href: '/apps/display', icon: 'wall',
    description: 'The location-scoped queue guests see when their order is ready.',
    device: 'Wall display', frame: 'wall', environmentKey: 'NEXT_PUBLIC_DISPLAY_URL',
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

/** Resolves a public, frame-safe application URL without accepting an open redirect. */
export function appPreviewFor(
  key: AppPreviewKey,
  environment: AppPreviewEnvironment = process.env,
): AppPreview {
  const definition = APP_PREVIEWS[key];
  const configured = safePreviewUrl(environment[definition.environmentKey]);
  const local = environment.NODE_ENV === 'production' ? null : definition.localUrl;
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
