/**
 * The contact addresses a business publishes on its own site.
 *
 * A Google listing carries no email, and the outreach drafts need somewhere
 * to address a demo. So the crawl keeps the addresses the business itself
 * put on its pages -- `mailto:` links anywhere, structured data, and plain
 * text on its contact and about pages -- and nothing it merely mentions. An
 * address is kept only on the site's own domain (www and apex are one) or a
 * common personal mailbox provider; a vendor's address in a footer, a
 * placeholder, or an image file name that happens to contain an `@` is not a
 * way to reach this business. Obfuscated spellings (`name [at] domain`) are
 * left alone on purpose: decoding them is guessing.
 */
export const MAX_CONTACT_EMAILS = 5;

const MAILBOX_PROVIDERS = new Set(['gmail.com', 'outlook.com', 'yahoo.com', 'icloud.com', 'hotmail.com']);
/** Own-domain mailboxes a business reads for new enquiries, in order of preference. */
const PREFERRED_MAILBOXES = ['info', 'hello', 'contact', 'orders'];
const PLACEHOLDER_DOMAINS = /(?:^|\.)(?:example\.(?:com|org|net)|domain\.com|email\.com|yourdomain\.com|test|invalid|localhost)$/;
const VENDOR_HINT = /sentry|wixpress|mailchimp|sendgrid|squarespace|godaddy|wordpress|cloudflare/;
/** File extensions that turn up as "top-level domains" in image names like logo@2x.png. */
const FILE_SUFFIX = /\.(?:png|jpe?g|gif|webp|svg|avif|ico|bmp|tiff?|css|js|json|pdf|mp4|webm|woff2?)$/;
const TEXT_ADDRESS = /[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,24}/gi;
const WHOLE_ADDRESS = /^[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,24}$/;

/** Every address-shaped string in visible text. */
export function emailsInText(text: string): string[] {
  return [...text.matchAll(TEXT_ADDRESS)].map((match) => match[0]);
}

/** The addresses in a `mailto:` link, without its query. */
export function emailsInMailto(href: string): string[] {
  if (!/^mailto:/i.test(href.trim())) return [];
  const target = href.trim().slice('mailto:'.length).split('?')[0] ?? '';
  let decoded = target;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    // A malformed escape is left as written; validation below decides.
  }
  return decoded.split(/[,;]/).map((entry) => entry.trim()).filter(Boolean);
}

function usable(address: string, ownHost: string): boolean {
  if (!WHOLE_ADDRESS.test(address) || address.includes('..')) return false;
  const [local = '', domain = ''] = address.split('@');
  if (local.startsWith('.') || local.endsWith('.')) return false;
  if (FILE_SUFFIX.test(address) || PLACEHOLDER_DOMAINS.test(domain) || VENDOR_HINT.test(domain)) return false;
  return ownDomain(domain, ownHost) || MAILBOX_PROVIDERS.has(domain);
}

function ownDomain(domain: string, ownHost: string): boolean {
  return domain.replace(/^www\./, '') === ownHost;
}

function rank(address: string, ownHost: string): number {
  const [local = '', domain = ''] = address.split('@');
  if (!ownDomain(domain, ownHost)) return 100;
  const preferred = PREFERRED_MAILBOXES.indexOf(local);
  return preferred >= 0 ? preferred : 50;
}

/**
 * The publishable contact addresses among `candidates`, for a site whose
 * host (without `www.`) is `ownHost`: lowercased, deduplicated, ordered
 * info/hello/contact/orders on the own domain first, then other own-domain
 * addresses, then mailbox-provider addresses, and capped at five.
 */
export function contactEmails(candidates: readonly string[], ownHost: string): string[] {
  const host = ownHost.toLowerCase().replace(/^www\./, '');
  const kept: { address: string; order: number }[] = [];
  for (const candidate of candidates) {
    const address = candidate.trim().toLowerCase();
    if (!usable(address, host) || kept.some((entry) => entry.address === address)) continue;
    kept.push({ address, order: kept.length });
  }
  return kept
    .sort((a, b) => rank(a.address, host) - rank(b.address, host) || a.order - b.order)
    .slice(0, MAX_CONTACT_EMAILS)
    .map((entry) => entry.address);
}
