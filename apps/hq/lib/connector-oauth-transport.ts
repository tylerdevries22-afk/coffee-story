const PRE_DELIVERY_CODES = new Set([
  'EAI_AGAIN', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND',
  'UND_ERR_CONNECT_TIMEOUT',
]);

export function stringAt(source: unknown, key: string): string | null {
  if (!source || typeof source !== 'object') return null;
  const result = Reflect.get(source, key);
  return typeof result === 'string' && result.trim() ? result : null;
}

export function objectAt(source: unknown, key: string): Record<string, unknown> | null {
  if (!source || typeof source !== 'object') return null;
  const result = Reflect.get(source, key);
  return result && typeof result === 'object' ? result as Record<string, unknown> : null;
}

/** True only when the transport proves that no request reached the provider. */
export function isProvablePreDeliveryFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const cause = Reflect.get(error, 'cause');
  const values = [error, cause].filter((value) => value && typeof value === 'object');
  return values.some((value) => {
    const code = Reflect.get(value, 'code');
    return typeof code === 'string' && PRE_DELIVERY_CODES.has(code);
  });
}
