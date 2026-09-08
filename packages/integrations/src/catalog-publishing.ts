import { apiKeySetup, initialsLogo, logo, portalSetup, type CatalogDefinition } from './catalog-definition';

/**
 * Publishing and podcast providers.
 *
 * Transistor and beehiiv expose self-serve API keys, so setup is three linked
 * steps. Amazon publishes no API for Kindle Direct Publishing or ACX — the
 * Selling Partner API explicitly excludes KDP — so those two are listed as
 * guided manual workflows rather than pretending a Connect button exists.
 */
export const PUBLISHING_DEFINITIONS: readonly CatalogDefinition[] = [
  {
    id: 'transistor', provider: 'Transistor', displayName: 'Transistor',
    category: 'marketing', availability: 'available', authentication: 'api-key-reference',
    summary: 'Podcast shows, episode publishing, and per-episode download analytics.',
    capabilities: ['shows.read', 'episodes.read', 'episodes.write', 'analytics.read'],
    mapping: ['organization', 'account'],
    health: ['auth', 'read', 'write', 'quota'],
    logo: initialsLogo('#5B5BD6', 'https://transistor.fm/about/press/', 'Transistor brand guidelines'),
    setup: apiKeySetup({
      estimatedMinutes: 2,
      consoleUrl: 'https://dashboard.transistor.fm/account',
      documentationUrl: 'https://developers.transistor.fm/',
      steps: [
        { text: 'Open your Transistor account page.', href: 'https://dashboard.transistor.fm/account' },
        { text: 'Copy the API key shown under API keys; reset it there if it was never revealed.' },
        { text: 'Paste the key here — Transistor sends it as the x-api-key header, so no OAuth app is needed.' },
      ],
    }),
  },
  {
    id: 'beehiiv', provider: 'beehiiv', displayName: 'beehiiv', category: 'marketing',
    availability: 'available', authentication: 'api-key-reference',
    summary: 'Newsletter posts, subscriber counts, segments, and send performance.',
    capabilities: ['publications.read', 'posts.read', 'posts.write', 'subscriptions.read', 'segments.read'],
    mapping: ['organization', 'account'],
    health: ['auth', 'read', 'write', 'webhook', 'quota'],
    logo: initialsLogo('#FFCC33', 'https://www.beehiiv.com/press', 'beehiiv brand guidelines'), webhooks: true,
    setup: apiKeySetup({
      estimatedMinutes: 2,
      consoleUrl: 'https://app.beehiiv.com/settings/workspace/api',
      documentationUrl: 'https://developers.beehiiv.com/welcome/create-an-api-key',
      steps: [
        { text: 'Open beehiiv Settings, then Workspace, then API, then New API Key.', href: 'https://app.beehiiv.com/settings/workspace/api' },
        { text: 'Copy the key, then copy the publication ID that starts with pub_ from the same screen.' },
        { text: 'Paste both here. beehiiv also offers OAuth, but that client must be requested from their support team.', href: 'https://support.beehiiv.com/hc/en-us' },
      ],
    }),
  },
  {
    id: 'kindle-direct-publishing', provider: 'Amazon', displayName: 'Kindle Direct Publishing',
    category: 'commerce', availability: 'manual-only', authentication: 'operator-portal',
    summary: 'Ebook and paperback royalties imported from the KDP reports export.',
    capabilities: ['royalties.import', 'orders.import', 'kenp.import'],
    mapping: ['organization', 'account'], health: ['read'],
    logo: initialsLogo('#FF9900', 'https://kdp.amazon.com/en_US/help/topic/G200634360', 'Amazon KDP brand guidelines'),
    setup: portalSetup({
      estimatedMinutes: 4,
      consoleUrl: 'https://kdpreports.amazon.com/',
      documentationUrl: 'https://kdp.amazon.com/en_US/help/topic/GVTTXHKHVPAPBEDQ',
      steps: [
        { text: 'Amazon publishes no KDP API — the Selling Partner API excludes KDP — so royalties arrive by export.', href: 'https://kdp.amazon.com/en_US/help/topic/GVTTXHKHVPAPBEDQ' },
        { text: 'Open KDP Reports and choose the period you want.', href: 'https://kdpreports.amazon.com/' },
        { text: 'Download the royalties spreadsheet, then upload it here; columns map automatically.' },
      ],
    }),
  },
  {
    id: 'acx-audiobooks', provider: 'Audible', displayName: 'ACX Audiobooks',
    category: 'commerce', availability: 'manual-only', authentication: 'operator-portal',
    summary: 'Audiobook sales and royalty statements imported from the ACX reports export.',
    capabilities: ['royalties.import', 'sales.import'],
    mapping: ['organization', 'account'], health: ['read'],
    logo: logo('audible', '#F8991C', 'retain-official-mark'),
    setup: portalSetup({
      estimatedMinutes: 4,
      consoleUrl: 'https://www.acx.com/',
      documentationUrl: 'https://help.acx.com/s/audiobook-publishing',
      steps: [
        { text: 'ACX, like Audible, publishes no developer API, so statements arrive by export.', href: 'https://help.acx.com/s/' },
        { text: 'Sign in to ACX and open Reports for the royalty period.', href: 'https://www.acx.com/' },
        { text: 'Download the sales and royalty report, then upload it here alongside your KDP export.' },
      ],
    }),
  },
] as const;
