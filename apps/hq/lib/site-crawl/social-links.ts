/**
 * The business's own social profiles, from the links its site publishes.
 *
 * Share buttons, embedded widgets and "log in with" links point at the same
 * networks but are not profiles, so only a profile-shaped path is kept, one
 * per network, the first one the site shows.
 */
export type SocialLink = { readonly network: string; readonly url: string };

const NETWORKS: Readonly<Record<string, string>> = {
  'instagram.com': 'instagram',
  'facebook.com': 'facebook',
  'tiktok.com': 'tiktok',
  'x.com': 'x',
  'twitter.com': 'x',
  'youtube.com': 'youtube',
  'linkedin.com': 'linkedin',
  'pinterest.com': 'pinterest',
  'yelp.com': 'yelp',
  'threads.net': 'threads',
};

const NOT_A_PROFILE = /^\/(?:sharer|share|intent|dialog|plugins|login|signup|tr|hashtag|search|explore|policies|legal|help|embed|watch)(?:[/.?]|$)/i;
const MAX_SOCIAL_LINKS = 8;

/** The network a URL belongs to, when it is one of the profile networks. */
export function socialNetwork(url: URL): string | null {
  const host = url.hostname.toLowerCase().replace(/^(?:www\.|m\.|mobile\.)/, '');
  return NETWORKS[host] ?? null;
}

export function socialLinks(hrefs: readonly string[]): SocialLink[] {
  const found: SocialLink[] = [];
  for (const href of hrefs) {
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
    const network = socialNetwork(url);
    if (network === null || found.some((entry) => entry.network === network)) continue;
    if (url.pathname.replace(/\/+$/, '') === '' || NOT_A_PROFILE.test(url.pathname)) continue;
    url.protocol = 'https:';
    url.hash = '';
    url.search = '';
    found.push({ network, url: url.href });
    if (found.length === MAX_SOCIAL_LINKS) break;
  }
  return found;
}
