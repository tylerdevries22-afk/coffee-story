import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEMO_ADD_ONS } from '@/data/add-ons';

import {
  defaultOptionSelection,
  isGroupVisible,
  missingRequiredGroups,
  optionDeltaCents,
  optionFingerprint,
  optionGroupsFor,
  pruneHiddenGroups,
  selectedChoices,
  toggleOptionChoice,
  visibleOptionGroups,
  type OptionGroup,
} from './menu-options';

function groupIds(groups: readonly OptionGroup[]): string[] {
  return groups.map((group) => group.id);
}

function groupFor(groups: readonly OptionGroup[], id: string): OptionGroup {
  const group = groups.find((entry) => entry.id === id);
  assert.ok(group, `expected a "${id}" group`);
  return group;
}

describe('optionGroupsFor', () => {
  it('asks a hot-capable drink how it is served before it asks about ice', () => {
    const groups = optionGroupsFor('latte', 'coffee');
    assert.deepEqual(groupIds(groups), ['serve', 'ice', 'milk', 'sweetness', 'extras']);
    assert.equal(groupFor(groups, 'serve').required, true);
    assert.deepEqual(groupFor(groups, 'ice').dependsOn, {
      groupId: 'serve',
      choiceIds: ['serve-iced'],
    });
  });

  it('asks a cold-only drink about ice unconditionally', () => {
    const groups = optionGroupsFor('cold-brew', 'coffee');
    assert.equal(groupIds(groups).includes('serve'), false);
    assert.equal(groupFor(groups, 'ice').dependsOn, undefined);
    assert.equal(groupFor(groups, 'ice').required, true);
  });

  it('never asks a blended smoothie for an ice level', () => {
    assert.equal(groupIds(optionGroupsFor('smoothie-green-machine', 'ades-smoothies')).includes('ice'), false);
  });

  it('never asks a hot-only drink whether it should be iced', () => {
    const groups = optionGroupsFor('turkish-coffee', 'signature');
    assert.deepEqual(groupIds(groups).filter((id) => id === 'serve' || id === 'ice'), []);
  });

  it('turns the printed "pistachio, ube, or Nutella" into a required choice', () => {
    const groups = optionGroupsFor('mochi-donut', 'sweets');
    const flavor = groupFor(groups, 'flavor');
    assert.equal(flavor.required, true);
    assert.equal(flavor.select, 'single');
    assert.deepEqual(flavor.choices.map((choice) => choice.name), ['Pistachio', 'Ube', 'Nutella']);
  });

  it('offers a sandwich its preparation and nothing drink-shaped', () => {
    assert.deepEqual(groupIds(optionGroupsFor('grilled-cheese', 'sandwiches')), ['preparation']);
  });

  it('sells oat milk exactly once, at the register add-on price', () => {
    const groups = optionGroupsFor('latte', 'coffee');
    const oatPriceCents = DEMO_ADD_ONS.find((addOn) => addOn.slug === 'oat-milk')?.priceCents;
    const milkOat = groupFor(groups, 'milk').choices.find((choice) => choice.id === 'milk-oat');
    assert.equal(milkOat?.priceDeltaCents, oatPriceCents);
    assert.equal(
      groupFor(groups, 'extras').choices.some((choice) => choice.id === 'extra-oat-milk'),
      false,
    );
  });

  it('prices every other extra from the register add-on list', () => {
    const extras = groupFor(optionGroupsFor('latte', 'coffee'), 'extras');
    assert.deepEqual(
      extras.choices.map((choice) => [choice.name, choice.priceDeltaCents]),
      DEMO_ADD_ONS
        .filter((addOn) => addOn.slug !== 'oat-milk')
        .map((addOn) => [addOn.name, addOn.priceCents]),
    );
  });
});

describe('visibility', () => {
  const groups = optionGroupsFor('latte', 'coffee');

  it('hides the ice group until the drink is iced', () => {
    assert.equal(isGroupVisible(groupFor(groups, 'ice'), { serve: ['serve-hot'] }), false);
    assert.equal(isGroupVisible(groupFor(groups, 'ice'), { serve: ['serve-iced'] }), true);
  });

  it('drops a hidden group from the visible list', () => {
    assert.equal(
      groupIds(visibleOptionGroups(groups, { serve: ['serve-hot'] })).includes('ice'),
      false,
    );
  });
});

describe('toggleOptionChoice', () => {
  const groups = optionGroupsFor('latte', 'coffee');

  it('replaces the choice in a single-select group', () => {
    const next = toggleOptionChoice(groups, { serve: ['serve-hot'] }, 'serve', 'serve-iced');
    assert.deepEqual(next.serve, ['serve-iced']);
  });

  it('keeps a required single-select choice when it is tapped again', () => {
    const next = toggleOptionChoice(groups, { serve: ['serve-hot'] }, 'serve', 'serve-hot');
    assert.deepEqual(next.serve, ['serve-hot']);
  });

  it('lets an optional single-select choice be un-picked', () => {
    const next = toggleOptionChoice(
      groups,
      { serve: ['serve-hot'], milk: ['milk-oat'] },
      'milk',
      'milk-oat',
    );
    assert.deepEqual(next.milk ?? [], []);
  });

  it('toggles multi-select choices independently', () => {
    const once = toggleOptionChoice(groups, { serve: ['serve-hot'] }, 'extras', 'extra-extra-shot');
    const twice = toggleOptionChoice(groups, once, 'extras', 'extra-boba-pearls');
    assert.deepEqual(twice.extras, ['extra-extra-shot', 'extra-boba-pearls']);
    const back = toggleOptionChoice(groups, twice, 'extras', 'extra-extra-shot');
    assert.deepEqual(back.extras, ['extra-boba-pearls']);
  });

  it('ignores a choice that does not belong to the group', () => {
    const selection = { serve: ['serve-hot'] };
    assert.equal(toggleOptionChoice(groups, selection, 'serve', 'ice-extra'), selection);
    assert.equal(toggleOptionChoice(groups, selection, 'nope', 'serve-hot'), selection);
  });

  it('forgets the ice level when the drink goes back to hot', () => {
    const iced = toggleOptionChoice(groups, {}, 'serve', 'serve-iced');
    const withIce = toggleOptionChoice(groups, iced, 'ice', 'ice-extra');
    assert.deepEqual(withIce.ice, ['ice-extra']);
    const hot = toggleOptionChoice(groups, withIce, 'serve', 'serve-hot');
    assert.equal(hot.ice, undefined);
  });
});

describe('pruneHiddenGroups', () => {
  it('drops selections for groups the current selection hides', () => {
    const groups = optionGroupsFor('latte', 'coffee');
    const pruned = pruneHiddenGroups(groups, { serve: ['serve-hot'], ice: ['ice-regular'] });
    assert.deepEqual(pruned, { serve: ['serve-hot'] });
  });

  it('drops a selection whose group is not on the item at all', () => {
    const groups = optionGroupsFor('grilled-cheese', 'sandwiches');
    assert.deepEqual(pruneHiddenGroups(groups, { serve: ['serve-hot'] }), {});
  });
});

describe('defaultOptionSelection', () => {
  it('pre-picks the first choice of every required group that is visible', () => {
    const groups = optionGroupsFor('latte', 'coffee');
    // Serve defaults to Hot, which keeps Ice hidden and therefore unselected.
    assert.deepEqual(defaultOptionSelection(groups), { serve: ['serve-hot'] });
  });

  it('pre-picks a cold-only drink an ice level, so it is immediately addable', () => {
    const groups = optionGroupsFor('cold-brew', 'coffee');
    assert.deepEqual(defaultOptionSelection(groups), { ice: ['ice-none'] });
    assert.deepEqual(missingRequiredGroups(groups, defaultOptionSelection(groups)), []);
  });

  it('leaves optional groups alone', () => {
    const groups = optionGroupsFor('latte', 'coffee');
    const selection = defaultOptionSelection(groups);
    assert.equal(selection.milk, undefined);
    assert.equal(selection.extras, undefined);
  });
});

describe('missingRequiredGroups', () => {
  const groups = optionGroupsFor('latte', 'coffee');

  it('reports a newly revealed required group as unanswered', () => {
    const iced = toggleOptionChoice(groups, {}, 'serve', 'serve-iced');
    assert.deepEqual(groupIds(missingRequiredGroups(groups, iced)), ['ice']);
  });

  it('never reports a required group that is currently hidden', () => {
    assert.deepEqual(missingRequiredGroups(groups, { serve: ['serve-hot'] }), []);
  });
});

describe('pricing and fingerprints', () => {
  const groups = optionGroupsFor('latte', 'coffee');

  it('adds only the deltas of visible, selected choices', () => {
    const selection = {
      serve: ['serve-hot'],
      ice: ['ice-extra'],
      milk: ['milk-oat'],
      extras: ['extra-extra-shot'],
    };
    // The ice choice is hidden on a hot drink and free anyway; oat + a shot are
    // the only two that cost money.
    assert.equal(optionDeltaCents(groups, selection), 75 + 150);
    assert.equal(selectedChoices(groups, selection).some((choice) => choice.id === 'ice-extra'), false);
  });

  it('never lets a delta subtract from the price', () => {
    const negative: OptionGroup[] = [{
      id: 'refund',
      name: 'Refund',
      select: 'multi',
      required: false,
      maxChoices: 1,
      choices: [{ id: 'refund-all', name: 'Refund', priceDeltaCents: -500 }],
    }];
    assert.equal(optionDeltaCents(negative, { refund: ['refund-all'] }), 0);
  });

  it('fingerprints the same drink identically whatever order it was tapped in', () => {
    const forwards = { serve: ['serve-hot'], milk: ['milk-oat'], extras: ['extra-extra-shot', 'extra-boba-pearls'] };
    const backwards = { extras: ['extra-boba-pearls', 'extra-extra-shot'], milk: ['milk-oat'], serve: ['serve-hot'] };
    assert.equal(optionFingerprint(groups, forwards), optionFingerprint(groups, backwards));
  });

  it('fingerprints two different drinks apart', () => {
    assert.notEqual(
      optionFingerprint(groups, { serve: ['serve-hot'] }),
      optionFingerprint(groups, { serve: ['serve-iced'], ice: ['ice-regular'] }),
    );
  });
});
