import type { IconName } from '@/components/icon';

export const APP_PREVIEW_KEYS = ['hq', 'customer', 'operator', 'kiosk', 'display'] as const;
export const APP_PREVIEW_DEVICES = ['desktop', 'tablet', 'mobile'] as const;

export type AppPreviewKey = (typeof APP_PREVIEW_KEYS)[number];
export type AppPreviewDevice = (typeof APP_PREVIEW_DEVICES)[number];
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

const DEVICE_PROFILES: Readonly<Record<AppPreviewDevice, Pick<AppPreview, 'device' | 'frame' | 'viewport'>>> = {
  desktop: { device: 'Desktop', frame: 'computer', viewport: { width: 1440, height: 810 } },
  tablet: { device: 'Tablet landscape', frame: 'tablet', viewport: { width: 1180, height: 884 } },
  mobile: { device: 'Mobile portrait', frame: 'phone', viewport: { width: 390, height: 844 } },
};

const DEFAULT_DEVICE: Readonly<Record<AppPreviewKey, AppPreviewDevice>> = {
  hq: 'desktop', customer: 'mobile', operator: 'tablet', kiosk: 'tablet', display: 'desktop',
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
    description: 'Customer account, requests, updates, and service journeys.',
    device: 'iPhone', frame: 'phone', viewport: { width: 390, height: 844 }, environmentKey: 'NEXT_PUBLIC_CUSTOMER_URL',
    localUrl: 'http://localhost:4170/',
  },
  operator: {
    key: 'operator', label: 'Operator', href: '/apps/operator', icon: 'activity',
    description: 'Team workflow for accepting, progressing, and completing work.',
    device: 'iPad Pro landscape', frame: 'tablet', viewport: { width: 1180, height: 884 }, environmentKey: 'NEXT_PUBLIC_OPERATOR_URL',
    localUrl: 'http://localhost:4191/',
  },
  kiosk: {
    key: 'kiosk', label: 'Kiosk / POS', href: '/apps/kiosk', icon: 'kiosk',
    description: 'Self-service catalog, intake, and on-site transactions.',
    device: 'iPad Pro landscape', frame: 'tablet', viewport: { width: 1180, height: 884 }, environmentKey: 'NEXT_PUBLIC_KIOSK_URL',
    localUrl: 'http://localhost:4180/',
  },
  display: {
    key: 'display', label: 'Location display', href: '/apps/display', icon: 'wall',
    description: 'Location-scoped status and activity for customers and teams.',
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

/** The initial simulator profile. Construction operators start on the phone-first workflow. */
export function defaultPreviewDevice(key: AppPreviewKey, constructionOperator = false): AppPreviewDevice {
  return key === 'operator' && constructionOperator ? 'mobile' : DEFAULT_DEVICE[key];
}

/** Reframes one app without changing its URL, identity, or tenant scope. */
export function previewForDevice(preview: AppPreview, device: AppPreviewDevice): AppPreview {
  if (preview.key === 'display' && device === 'desktop') return preview;
  return { ...preview, ...DEVICE_PROFILES[device] };
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
