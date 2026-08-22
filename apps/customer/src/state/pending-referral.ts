/**
 * The referral code a deep link carried in, held until a screen consumes it.
 * Module state rather than context: it must survive the redirect dance before
 * providers under the tab shell have mounted, and it is write-once-read-once.
 */
let pendingCode: string | null = null;

export function setPendingReferralCode(code: string): void {
  const cleaned = code.trim().toUpperCase();
  if (/^[A-Z0-9-]{4,32}$/.test(cleaned)) pendingCode = cleaned;
}

export function readPendingReferralCode(): string | null {
  return pendingCode;
}

export function clearPendingReferralCode(): void {
  pendingCode = null;
}
