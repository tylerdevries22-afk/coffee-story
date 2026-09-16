import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  LOBBY_OMITTED,
  livePolledSections,
  lobbySectionsFor,
  publishedTemplate,
  type LobbyPageType,
} from './lobby-sections';

const PAGE_TYPES: readonly LobbyPageType[] = ['hotel', 'business', 'town'];

/**
 * The lobby screen's whole job is to be the venue's own page. What is worth
 * asserting is therefore not the section list itself -- that would just restate
 * the module -- but the relationship between what the partner publishes and
 * what the screen draws: same order, nothing invented, and exactly one
 * deliberate omission.
 */
describe('lobby sections', () => {
  it('renders the hotel page in its published order', () => {
    assert.deepEqual(lobbySectionsFor('hotel').map((section) => section.id), [
      'hero-planner', 'stats', 'contact-hours', 'events-calendar',
      'explore-map', 'rails', 'nearby',
    ]);
  });

  // Order is the contract. A screen that showed the right sections rearranged
  // would still be a different page, so this checks the sequence survives the
  // filter rather than just the membership.
  for (const pageType of PAGE_TYPES) {
    it(`keeps ${pageType} sections in their published sequence`, () => {
      const published = publishedTemplate(pageType).map((section) => section.id);
      const rendered = lobbySectionsFor(pageType).map((section) => section.id);
      assert.deepEqual(rendered, published.filter((id) => rendered.includes(id)));
    });

    it(`invents no section for ${pageType} that the page does not publish`, () => {
      const published = new Set(publishedTemplate(pageType).map((section) => section.id));
      for (const section of lobbySectionsFor(pageType)) {
        assert.ok(published.has(section.id), `${section.id} is not on the published page`);
      }
    });

    it(`drops exactly the omitted sections for ${pageType}, and no others`, () => {
      const published = publishedTemplate(pageType).map((section) => section.id);
      const rendered = lobbySectionsFor(pageType).map((section) => section.id);
      const dropped = published.filter((id) => !rendered.includes(id));
      assert.deepEqual(dropped, published.filter((id) => LOBBY_OMITTED.includes(id)));
    });
  }

  // The ownership band asks the viewer to claim this business. In the venue's
  // own entrance that is both meaningless and faintly alarming.
  it('never asks a guest to claim the hotel they are standing in', () => {
    for (const pageType of PAGE_TYPES) {
      assert.equal(
        lobbySectionsFor(pageType).some((section) => section.id === 'claim'), false,
        `${pageType} kept the claim band`,
      );
    }
  });

  it('separates a venue from a destination by hours and a front desk', () => {
    const venue = lobbySectionsFor('hotel').map((section) => section.id);
    const town = lobbySectionsFor('town').map((section) => section.id);
    assert.ok(venue.includes('contact-hours') && venue.includes('stats'));
    assert.equal(town.includes('contact-hours'), false);
    assert.ok(town.includes('seasons') && town.includes('planning'));
  });

  it('treats business as the same premises template a hotel gets', () => {
    assert.deepEqual(lobbySectionsFor('business'), lobbySectionsFor('hotel'));
  });

  /**
   * What a lobby screen may cache and what it must re-read. Identity is stable
   * enough to ship in a pack; what is on today is not, and a screen showing
   * yesterday's events is worse than one showing none.
   */
  it('re-reads what changes and trusts what does not', () => {
    const live = livePolledSections('hotel');
    assert.ok(live.includes('events-calendar'), 'a stale event list is a wrong lobby screen');
    assert.equal(live.includes('hero-planner'), false, 'identity does not need polling');
    assert.equal(live.includes('contact-hours'), false);
  });

  it('polls nothing that is not rendered', () => {
    for (const pageType of PAGE_TYPES) {
      const rendered = new Set(lobbySectionsFor(pageType).map((section) => section.id));
      for (const id of livePolledSections(pageType)) {
        assert.ok(rendered.has(id), `${pageType} polls ${id} without drawing it`);
      }
    }
  });
});
