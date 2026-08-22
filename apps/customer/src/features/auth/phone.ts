/**
 * Phone-OTP sign-in helpers. Pure: normalisation and validation only; the
 * Supabase calls live in auth-context.
 */

/** "(720) 609-2971" -> "+17206092971". US-defaulted; keeps an explicit +CC. */
export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (hasPlus) {
    if (digits.length < 8 || digits.length > 15) return null;
    return `+${digits}`;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

export function isValidOtpCode(code: string): boolean {
  return /^\d{6}$/.test(code.trim());
}
