import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MAX_ENTRY_NODES, entryNodesFromCategories } from '../kiosk-flow';
import { CATEGORIES } from './menu.fixture';

const FALLBACK = entryNodesFromCategories(CATEGORIES);

describe('entryNodesFromCategories', () => {
  it('anchors the constellation by giving the first category the hero slot', () => {
    assert.deepEqual(FALLBACK.map((node) => node.emphasis), ['hero', 'standard', 'standard']);
    assert.deepEqual(FALLBACK[0]?.target, { kind: 'category', categoryId: 'coffee' });
  });

  it('skips a category missing an id or a title rather than emitting a blank circle', () => {
    const nodes = entryNodesFromCategories([
      { id: '', title: 'Nameless' },
      { id: 'tea', title: '   ' },
      { id: 'sweets', title: 'Sweets' },
    ]);
    assert.deepEqual(nodes.map((node) => node.id), ['sweets']);
  });

  it('caps the first screen so a long menu cannot make it unreadable', () => {
    const many = Array.from({ length: 30 }, (_, index) => ({ id: `c${index}`, title: `C${index}` }));
    assert.equal(entryNodesFromCategories(many).length, MAX_ENTRY_NODES);
  });

  it('turns the published catalog hierarchy into bounded kiosk groups', () => {
    const nodes = entryNodesFromCategories([
      { id: 'services', title: 'Services', aliases: [], parentId: null, hasItems: false },
      { id: 'exterior', title: 'Exterior', aliases: [], parentId: 'services', hasItems: true },
      { id: 'roofing', title: 'Roofing', aliases: [], parentId: 'exterior', hasItems: true },
    ]);
    assert.equal(nodes[0]?.target.kind, 'group');
    const exterior = nodes[0]?.target.kind === 'group' ? nodes[0].target.nodes[0] : null;
    assert.equal(exterior?.target.kind, 'group');
  });
});
