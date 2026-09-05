import type { KnowledgeDocument, KnowledgeLocation } from './knowledge-model';

export const STILLPOINT_KNOWLEDGE_LOCATIONS: readonly KnowledgeLocation[] = [
  { id: 'stillpoint-builders-1', name: 'Denver Regional Office' },
  { id: 'stillpoint-builders-2', name: 'Colorado Springs Field Office' },
];

export const STILLPOINT_KNOWLEDGE_DOCUMENTS: readonly KnowledgeDocument[] = [
  {
    id: 'sp-safety-001', code: 'SAFE-001', title: 'Fall protection field manual',
    summary: 'Required controls, inspection sequence, and rescue plan for work above six feet.',
    kind: 'safety_manual', version: '4.2', status: 'approved', updatedAt: '2026-08-29T14:30:00.000Z',
    owner: 'Safety & Risk', roles: ['Superintendent', 'Foreperson', 'Field crew'],
    locationIds: ['stillpoint-builders-1', 'stillpoint-builders-2'], locationNames: ['Denver Regional Office', 'Colorado Springs Field Office'],
    requiredAcknowledgements: 46, acknowledgementCount: 41, acknowledgedByCurrentUser: false,
    externalHref: 'https://www.osha.gov/fall-protection', project: null, tags: ['fall protection', 'PPE'],
  },
  {
    id: 'sp-sop-014', code: 'SOP-014', title: 'Daily site startup and closeout',
    summary: 'Opening inspection, trade coordination, photo record, security, and end-of-day handoff.',
    kind: 'sop', version: '2.7', status: 'approved', updatedAt: '2026-09-01T12:00:00.000Z',
    owner: 'Field Operations', roles: ['Superintendent', 'Project engineer'],
    locationIds: ['stillpoint-builders-1', 'stillpoint-builders-2'], locationNames: ['Denver Regional Office', 'Colorado Springs Field Office'],
    requiredAcknowledgements: 18, acknowledgementCount: 18, acknowledgedByCurrentUser: true,
    externalHref: null, project: null, tags: ['daily log', 'closeout'],
  },
  {
    id: 'sp-std-008', code: 'STD-008', title: 'Concrete placement standard',
    summary: 'Pre-pour readiness, testing cadence, weather limits, and placement quality requirements.',
    kind: 'project_standard', version: '3.1', status: 'in_review', updatedAt: '2026-09-03T16:45:00.000Z',
    owner: 'Quality Systems', roles: ['Project manager', 'Superintendent'],
    locationIds: ['stillpoint-builders-2'], locationNames: ['Colorado Springs Field Office'],
    requiredAcknowledgements: 12, acknowledgementCount: 0, acknowledgedByCurrentUser: false,
    externalHref: null, project: 'Harbor House', tags: ['concrete', 'quality'],
  },
  {
    id: 'sp-doc-021', code: 'PRJ-021', title: 'Harbor House logistics plan',
    summary: 'Approved access, crane picks, laydown zones, delivery windows, and neighborhood constraints.',
    kind: 'project_document', version: '1.6', status: 'approved', updatedAt: '2026-09-02T18:20:00.000Z',
    owner: 'Harbor House Team', roles: ['Project manager', 'Superintendent', 'Trade partner'],
    locationIds: ['stillpoint-builders-2'], locationNames: ['Colorado Springs Field Office'],
    requiredAcknowledgements: 23, acknowledgementCount: 19, acknowledgedByCurrentUser: false,
    externalHref: null, project: 'Harbor House', tags: ['logistics', 'delivery'],
  },
  {
    id: 'sp-sop-031', code: 'SOP-031', title: 'Subcontractor onboarding',
    summary: 'Insurance, safety orientation, directory setup, and project access checks before mobilization.',
    kind: 'sop', version: '1.1', status: 'draft', updatedAt: '2026-09-04T08:10:00.000Z',
    owner: 'Project Controls', roles: ['Project manager', 'Project engineer'],
    locationIds: ['stillpoint-builders-1'], locationNames: ['Denver Regional Office'],
    requiredAcknowledgements: 0, acknowledgementCount: 0, acknowledgedByCurrentUser: false,
    externalHref: null, project: null, tags: ['onboarding', 'compliance'],
  },
];

export function demoKnowledgeForBrand(brandId: string): {
  readonly documents: readonly KnowledgeDocument[];
  readonly locations: readonly KnowledgeLocation[];
} | null {
  return brandId === 'stillpoint-builders'
    ? { documents: STILLPOINT_KNOWLEDGE_DOCUMENTS, locations: STILLPOINT_KNOWLEDGE_LOCATIONS }
    : null;
}

export function demoKnowledgeDocument(brandId: string, resourceId: string): KnowledgeDocument | null {
  return demoKnowledgeForBrand(brandId)?.documents.find((item) => item.id === resourceId) ?? null;
}

export function demoKnowledgeMetadata(document: KnowledgeDocument): Record<string, unknown> {
  return {
    knowledge: {
      code: document.code,
      documentType: document.kind,
      version: document.version,
      status: document.status,
      owner: document.owner,
      roleTargets: document.roles,
      locationIds: document.locationIds,
      requiredAcknowledgements: document.requiredAcknowledgements,
      project: document.project,
      tags: document.tags,
    },
  };
}
