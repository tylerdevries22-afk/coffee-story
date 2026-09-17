/**
 * What an unattended lobby screen shows, and in what order.
 *
 * The screen stands in a venue's own entrance and must show that venue's
 * published page -- the same sections, in the same order, as the page a guest
 * would open on their phone. Two things are dropped, and only two:
 *
 *   `claim`  an ownership band inviting the viewer to claim this business.
 *            In the venue's own lobby that is nonsense: the owner has already
 *            claimed it, and a guest cannot.
 *   social   like, comment and share counts. A lobby screen has no viewer
 *            identity and no one to attribute an action to.
 *
 * Nothing else is filtered. A screen that quietly omitted a section would be a
 * different page wearing the venue's name, which is the one thing it must not
 * be.
 *
 * Framework-free on purpose: the ordering is the contract between this repo and
 * the partner's own page, so it is unit-testable without a renderer.
 */

/** A section of a published venue page. Mirrors the partner's own registry. */
export type LobbySectionId =
  | 'hero-planner'
  | 'stats'
  | 'contact-hours'
  | 'events-calendar'
  | 'explore-map'
  | 'rails'
  | 'nearby'
  | 'planning'
  | 'seasons'
  | 'claim';

/** The page types a venue page can be. */
export type LobbyPageType = 'hotel' | 'business' | 'town';

export type LobbySection = {
  readonly id: LobbySectionId;
  /** Sticky-nav label; null when the section scrolls under a labelled anchor. */
  readonly label: string | null;
  /** Whether the section is live-polled rather than carried in the pack. */
  readonly live: boolean;
};

/**
 * Sections never rendered on a lobby screen, whatever the template says.
 *
 * Held as data rather than an `if` inside the renderer so the reason survives:
 * a future template that adds another viewer-identity section adds it here, and
 * the drop stays one decision in one place.
 */
export const LOBBY_OMITTED: readonly LobbySectionId[] = ['claim'];

/**
 * A venue: a hotel or any other single premises.
 *
 * Verbatim from the partner's venue template, including the order, because
 * matching it is the requirement. `stats` and `contact-hours` are what separate
 * it from a town page -- a venue has hours and a front desk; a destination has
 * neither.
 */
const VENUE_TEMPLATE: readonly LobbySection[] = [
  { id: 'hero-planner', label: 'Overview', live: false },
  { id: 'stats', label: null, live: false },
  { id: 'contact-hours', label: null, live: false },
  { id: 'events-calendar', label: null, live: true },
  { id: 'explore-map', label: 'Explore', live: false },
  { id: 'rails', label: null, live: true },
  { id: 'nearby', label: 'Nearby', live: true },
  { id: 'claim', label: null, live: false },
];

/** A destination rather than a premises: no hours, but seasons and planning. */
const TOWN_TEMPLATE: readonly LobbySection[] = [
  { id: 'hero-planner', label: 'Overview', live: false },
  { id: 'events-calendar', label: null, live: true },
  { id: 'explore-map', label: 'Explore', live: false },
  { id: 'rails', label: null, live: true },
  { id: 'planning', label: 'Planning', live: false },
  { id: 'seasons', label: 'Best times', live: false },
  { id: 'nearby', label: 'Nearby', live: true },
  { id: 'claim', label: null, live: false },
];

const TEMPLATES: Readonly<Record<LobbyPageType, readonly LobbySection[]>> = {
  hotel: VENUE_TEMPLATE,
  business: VENUE_TEMPLATE,
  town: TOWN_TEMPLATE,
};

/**
 * The published template for a page type, unfiltered.
 *
 * Exported so a test can assert the lobby is a strict subset of what the
 * partner publishes -- a screen showing a section the page does not have would
 * be inventing content for a venue.
 */
export function publishedTemplate(pageType: LobbyPageType): readonly LobbySection[] {
  return TEMPLATES[pageType];
}

/** The sections a lobby screen renders, in the published order. */
export function lobbySectionsFor(pageType: LobbyPageType): readonly LobbySection[] {
  return publishedTemplate(pageType).filter((section) => !LOBBY_OMITTED.includes(section.id));
}

/**
 * Sections that must be re-read from the partner rather than trusted from the
 * pack. Identity -- photos, description, amenities -- is stable enough to ship
 * in a pack; what is on today and what is nearby are not.
 */
export function livePolledSections(pageType: LobbyPageType): readonly LobbySectionId[] {
  return lobbySectionsFor(pageType).filter((section) => section.live).map((section) => section.id);
}
