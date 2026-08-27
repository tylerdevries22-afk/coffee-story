function normalizedOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return url.origin === value.replace(/\/$/, '') ? url.origin : null;
  } catch {
    return null;
  }
}

/** Allows native requests, same-origin HQ, and exact configured web-app origins. */
export function analyticsOriginAllowed(
  requestUrl: string,
  origin: string | null,
  configuredOrigins: string | undefined,
): boolean {
  if (!origin) return true;
  const candidate = normalizedOrigin(origin);
  if (!candidate) return false;
  if (candidate === new URL(requestUrl).origin) return true;
  return (configuredOrigins ?? '').split(',')
    .map((value) => normalizedOrigin(value.trim()))
    .some((value) => value === candidate);
}
