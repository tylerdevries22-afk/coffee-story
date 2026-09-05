export const KNOWLEDGE_KINDS = [
  'sop',
  'safety_manual',
  'project_standard',
  'project_document',
] as const;

export const KNOWLEDGE_STATUSES = ['draft', 'in_review', 'approved', 'retired'] as const;
export const KNOWLEDGE_MANAGEMENT_INTENTS = ['submit_review', 'approve', 'retire'] as const;
export const KNOWLEDGE_INTENTS = [...KNOWLEDGE_MANAGEMENT_INTENTS, 'acknowledge'] as const;

export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];
export type KnowledgeStatus = (typeof KNOWLEDGE_STATUSES)[number];
export type KnowledgeIntent = (typeof KNOWLEDGE_INTENTS)[number];
export type KnowledgeManagementIntent = (typeof KNOWLEDGE_MANAGEMENT_INTENTS)[number];
export type KnowledgeLocation = { readonly id: string; readonly name: string };

export type KnowledgeDocument = {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly summary: string;
  readonly kind: KnowledgeKind;
  readonly version: string;
  readonly status: KnowledgeStatus;
  readonly updatedAt: string;
  readonly owner: string;
  readonly roles: readonly string[];
  readonly locationIds: readonly string[];
  readonly locationNames: readonly string[];
  readonly requiredAcknowledgements: number;
  readonly acknowledgementCount: number;
  readonly acknowledgedByCurrentUser: boolean;
  readonly externalHref: string | null;
  readonly project: string | null;
  readonly tags: readonly string[];
};

export type KnowledgeWorkspace = {
  readonly enabled: boolean;
  readonly canManage: boolean;
  readonly tenantName: string;
  readonly source: 'demo' | 'live';
  readonly locationId: string | null;
  readonly locations: readonly KnowledgeLocation[];
  readonly documents: readonly KnowledgeDocument[];
};

export type KnowledgeAvailableAction = {
  readonly intent: KnowledgeIntent;
  readonly label: string;
};

export function knowledgeActionsFor(
  document: Pick<KnowledgeDocument, 'status' | 'acknowledgedByCurrentUser'>,
  canManage: boolean,
): readonly KnowledgeAvailableAction[] {
  if (document.status === 'draft') {
    return canManage ? [{ intent: 'submit_review', label: 'Submit for review' }] : [];
  }
  if (document.status === 'in_review') {
    return canManage ? [{ intent: 'approve', label: 'Approve version' }] : [];
  }
  if (document.status !== 'approved') return [];
  return [
    ...(!document.acknowledgedByCurrentUser
      ? [{ intent: 'acknowledge' as const, label: 'Acknowledge document' }]
      : []),
    ...(canManage ? [{ intent: 'retire' as const, label: 'Retire version' }] : []),
  ];
}

export type KnowledgeMetadata = Record<string, unknown> & {
  knowledge?: Record<string, unknown>;
};

type CatalogKnowledgeRow = {
  readonly id: string;
  readonly title: string;
  readonly summary: string | null;
  readonly external_ref: string | null;
  readonly metadata: unknown;
  readonly updated_at: string;
};

export type KnowledgeAcknowledgementSummary = {
  readonly count: number;
  readonly acknowledgedByCurrentUser: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const text = (value: unknown, fallback = ''): string =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

const strings = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
  : [];

const integer = (value: unknown): number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;

const member = <T extends readonly string[]>(value: unknown, values: T): value is T[number] =>
  typeof value === 'string' && values.includes(value);

export function safeKnowledgeHref(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function mapKnowledgeDocument(
  row: CatalogKnowledgeRow,
  locations: readonly KnowledgeLocation[],
  acknowledgements: KnowledgeAcknowledgementSummary = {
    count: 0,
    acknowledgedByCurrentUser: false,
  },
): KnowledgeDocument | null {
  if (!isRecord(row.metadata) || !isRecord(row.metadata.knowledge)) return null;
  const metadata = row.metadata.knowledge;
  const kind = member(metadata.documentType, KNOWLEDGE_KINDS) ? metadata.documentType : null;
  if (!kind) return null;
  const locationIds = strings(metadata.locationIds);
  return {
    id: row.id,
    code: text(metadata.code, 'UNTITLED'),
    title: row.title,
    summary: row.summary ?? '',
    kind,
    version: text(metadata.version, '1.0'),
    status: member(metadata.status, KNOWLEDGE_STATUSES) ? metadata.status : 'draft',
    updatedAt: row.updated_at,
    owner: text(metadata.owner, 'Unassigned'),
    roles: strings(metadata.roleTargets),
    locationIds,
    locationNames: locationIds.map((id) => locations.find((item) => item.id === id)?.name ?? id),
    requiredAcknowledgements: integer(metadata.requiredAcknowledgements),
    acknowledgementCount: acknowledgements.count,
    acknowledgedByCurrentUser: acknowledgements.acknowledgedByCurrentUser,
    externalHref: safeKnowledgeHref(row.external_ref),
    project: text(metadata.project) || null,
    tags: strings(metadata.tags),
  };
}

export type KnowledgeTransitionResult =
  | { readonly ok: true; readonly metadata: KnowledgeMetadata; readonly status: KnowledgeStatus }
  | { readonly ok: false; readonly message: string };

export function transitionKnowledgeMetadata(
  source: unknown,
  intent: KnowledgeManagementIntent,
  actorId: string,
  now: string,
): KnowledgeTransitionResult {
  const root: KnowledgeMetadata = isRecord(source) ? { ...source } : {};
  const current = isRecord(root.knowledge) ? { ...root.knowledge } : null;
  if (!current) return { ok: false, message: 'This resource is not a knowledge document.' };
  const status: KnowledgeStatus = member(current.status, KNOWLEDGE_STATUSES) ? current.status : 'draft';
  if (intent === 'submit_review' && status !== 'draft') {
    return { ok: false, message: 'Only draft documents can be submitted for review.' };
  }
  if (intent === 'approve' && status !== 'in_review') {
    return { ok: false, message: 'Only documents in review can be approved.' };
  }
  if (intent === 'retire' && status !== 'approved') {
    return { ok: false, message: 'Only approved documents can be retired.' };
  }
  const nextStatus = intent === 'submit_review'
    ? 'in_review'
    : intent === 'approve'
      ? 'approved'
      : 'retired';
  root.knowledge = {
    ...current,
    status: nextStatus,
    ...(intent === 'approve' ? { approvedBy: actorId, approvedAt: now } : {}),
    ...(intent === 'retire' ? { retiredBy: actorId, retiredAt: now } : {}),
  };
  delete root.knowledge.acknowledgedUserIds;
  return { ok: true, metadata: root, status: nextStatus };
}
