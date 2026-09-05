import assert from 'node:assert/strict';
import test from 'node:test';

import { installedModuleKeys } from '@platform/module-kit';

import coffeeModules from '@/tenants/coffee-story/modules.json';
import juniperModules from '@/tenants/juniper-base-demo/modules.json';
import stillpointModules from '@/tenants/stillpoint-builders/modules.json';

import { clientExperienceForModules } from './client-experience';

test('Coffee Story keeps its existing customer navigation vocabulary', () => {
  assert.deepEqual(clientExperienceForModules(installedModuleKeys(coffeeModules)).tabLabels, {
    home: 'Home', gift: 'Gift', book: 'Order', rewards: 'Rewards', more: 'Profile',
  });
});

test('Stillpoint exposes project, document, and payment destinations', () => {
  const experience = clientExperienceForModules(installedModuleKeys(stillpointModules));
  assert.equal(experience.kind, 'construction');
  assert.deepEqual(experience.tabLabels, {
    home: 'Home', gift: 'Documents', book: 'Project', rewards: 'Payments', more: 'More',
  });
  assert.doesNotMatch(Object.values(experience.tabLabels).join(' '), /gift|order|reward|menu/i);
});

test('a catalog-only general tenant gets a neutral Base App experience', () => {
  const experience = clientExperienceForModules(installedModuleKeys(juniperModules));
  assert.equal(experience.kind, 'base');
  assert.deepEqual(experience.tabs, ['home', 'book', 'more']);
  assert.deepEqual(experience.tabLabels, {
    home: 'Home', gift: 'Resources', book: 'Catalog', rewards: 'Activity', more: 'Profile',
  });
  assert.doesNotMatch(Object.values(experience.tabLabels).join(' '), /coffee|gift|order|reward|menu/i);
});
