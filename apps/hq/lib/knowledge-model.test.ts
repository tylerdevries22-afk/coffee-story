import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  knowledgeActionsFor,
  mapKnowledgeDocument,
  safeKnowledgeHref,
  transitionKnowledgeMetadata,
} from './knowledge-model';

const row = {
  id: 'document-1', title: 'Lift plan', summary: 'Critical lift sequence',
  external_ref: 'https://example.com/lift-plan', updated_at: '2026-09-04T08:00:00.000Z',
  metadata: { untouched: 'preserved', knowledge: {
    code: 'SAFE-009', documentType: 'safety_manual', version: '2.1', status: 'approved',
    owner: 'Safety', roleTargets: ['Superintendent'], locationIds: ['north'],
    requiredAcknowledgements: 4, project: 'Harbor House',
    tags: ['lift', 'crane'],
  } },
};

describe('knowledge document mapping', () => {
  it('maps versioning, targeting, and acknowledgement fields', () => {
    const document = mapKnowledgeDocument(row, [{ id: 'north', name: 'North region' }], {
      count: 1,
      acknowledgedByCurrentUser: true,
    });
    assert.ok(document);
    assert.equal(document.kind, 'safety_manual');
    assert.deepEqual(document.locationNames, ['North region']);
    assert.equal(document.acknowledgedByCurrentUser, true);
    assert.equal(document.acknowledgementCount, 1);
  });

  it('ignores catalog resources without knowledge metadata', () => {
    assert.equal(mapKnowledgeDocument({ ...row, metadata: {} }, []), null);
  });

  it('accepts only secure external document links', () => {
    assert.equal(safeKnowledgeHref('javascript:alert(1)'), null);
    assert.equal(safeKnowledgeHref('http://example.com'), null);
    assert.equal(safeKnowledgeHref('https://example.com/a'), 'https://example.com/a');
  });
});

describe('knowledge workflow transitions', () => {
  it('gives staff read acknowledgement without document management', () => {
    assert.deepEqual(knowledgeActionsFor({
      status: 'approved', acknowledgedByCurrentUser: false,
    }, false).map((action) => action.intent), ['acknowledge']);
    assert.deepEqual(knowledgeActionsFor({
      status: 'draft', acknowledgedByCurrentUser: false,
    }, false), []);
    assert.deepEqual(knowledgeActionsFor({
      status: 'approved', acknowledgedByCurrentUser: false,
    }, true).map((action) => action.intent), ['acknowledge', 'retire']);
  });

  it('moves a draft to review while preserving unrelated metadata', () => {
    const result = transitionKnowledgeMetadata({ untouched: true, knowledge: { status: 'draft' } }, 'submit_review', 'owner', 'now');
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.status, 'in_review');
    assert.equal(result.metadata.untouched, true);
  });

  it('records approval provenance only from review', () => {
    const rejected = transitionKnowledgeMetadata({ knowledge: { status: 'draft' } }, 'approve', 'owner', 'now');
    assert.equal(rejected.ok, false);
    const approved = transitionKnowledgeMetadata({ knowledge: { status: 'in_review' } }, 'approve', 'owner', 'now');
    assert.equal(approved.ok, true);
    if (!approved.ok) return;
    assert.deepEqual(approved.metadata.knowledge, {
      status: 'approved', approvedBy: 'owner', approvedAt: 'now',
    });
  });

  it('retires only an approved document without embedding acknowledgement identities', () => {
    const source = { knowledge: { status: 'approved', acknowledgedUserIds: ['legacy-user'] } };
    const result = transitionKnowledgeMetadata(source, 'retire', 'owner', 'now');
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.metadata.knowledge, {
      status: 'retired', retiredBy: 'owner', retiredAt: 'now',
    });
  });
});
