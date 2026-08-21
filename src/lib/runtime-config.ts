export type MobileLiveConfig = {
  stripePublishableKey: unknown;
  supabaseUrl: unknown;
  supabasePublishableKey: unknown;
};

export function isValidStripePublishableKey(value: unknown): value is string {
  return typeof value === 'string' && /^pk_(test|live)_[A-Za-z0-9]+$/.test(value);
}

export function isValidSupabaseUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === 'localhost');
  } catch {
    return false;
  }
}

export function isValidSupabasePublishableKey(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 20;
}

export function missingLiveConfig(config: MobileLiveConfig): string[] {
  const missing: string[] = [];
  if (!isValidStripePublishableKey(config.stripePublishableKey)) missing.push('EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY');
  if (!isValidSupabaseUrl(config.supabaseUrl)) missing.push('EXPO_PUBLIC_SUPABASE_URL');
  if (!isValidSupabasePublishableKey(config.supabasePublishableKey)) {
    missing.push('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  }
  return missing;
}
