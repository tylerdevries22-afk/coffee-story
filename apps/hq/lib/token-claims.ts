/**
 * The tenancy the Postgres access-token hook minted, out of a JWT payload.
 *
 * `supabase.auth.getUser()` returns the `app_metadata` STORED on the user row,
 * which never contains hook-minted claims — the hook writes them into the token
 * it issues and nowhere else. Reading them from the user record therefore
 * always yields nothing, and every role gate built on it silently fails closed.
 *
 * This does not verify the token: the caller must have already established the
 * token is genuine (`getUser()` round-trips it through GoTrue) before trusting
 * what is inside it. Decoding is separate from verifying on purpose, because
 * the two answers come from different places.
 */
export function tokenAppMetadata(accessToken: string): Record<string, unknown> | null {
  const payload = accessToken.split('.')[1];
  if (!payload) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      app_metadata?: unknown;
    };
    const metadata = decoded.app_metadata;
    return typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** The brand's display name, which the hook mints alongside the claims. */
export function brandNameFromMetadata(metadata: Record<string, unknown> | null): string | null {
  const name = metadata?.brand_name;
  return typeof name === 'string' && name.trim().length > 0 ? name : null;
}
