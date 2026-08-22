/**
 * Referral codes, demo-side. The engine issues real codes server-side
 * (referrals table, unique per brand); this derives a stable demo code so the
 * screen behaves identically in both modes.
 */

/** "Jordan Álvarez" + "CS" -> "CS-JORDAN-7f3a" style, stable per name. */
export function referralCodeFor(fullName: string, prefix: string): string {
  const first = fullName.trim().split(/\s+/)[0] ?? '';
  const clean = first.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8) || 'FRIEND';
  let hash = 0;
  for (const char of `${prefix}:${fullName}`) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return `${prefix}-${clean}-${(hash % 0xffff).toString(16).padStart(4, '0').toUpperCase()}`;
}

export function referralMessage(code: string, appName: string, url: string): string {
  return `Try ${appName} — use my code ${code} and we both get a free drink. ${url}`;
}
