import type {
  TenantTrainingProfile,
  TrainingAnswerKey,
  TrainingManifest,
} from './training-bootstrap';
import { liftTrainingManifest, normalizeTrainingManifest, slugify, TRAINING_TRACK_ORDER, type TrainingTrackKey } from '@platform/domain';

export type ContentMenuSize = {
  slug: string;
  label: string;
  priceCents: number;
};

export type ContentOptionGroup = {
  id: string;
  name: string;
  select: 'single' | 'multi';
  required: boolean;
  maxChoices: number;
  dependsOn?: { groupId: string; choiceIds: string[] };
  choices: { id: string; name: string; priceDeltaCents: number }[];
};

export type ContentMenu = {
  id: string;
  name: string;
  isPublished: boolean;
  draftVersion: number;
  publishedVersion: number | null;
  updatedAt: string | null;
};

export type ContentCategory = {
  id: string;
  title: string;
  tagline: string;
  slug: string;
  parentId: string | null;
  imageUrl: string | null;
  audience: 'public' | 'staff' | 'manager' | 'owner';
  archived: boolean;
  sortOrder: number;
  mediaVersions: ContentMediaVersion[];
};

export type ContentMenuItem = {
  id: string;
  name: string;
  slug: string;
  description: string;
  categoryId: string;
  basePriceCents: number;
  sizes: ContentMenuSize[];
  optionGroups: ContentOptionGroup[];
  imageUrl: string | null;
  audience: 'public' | 'staff' | 'manager' | 'owner';
  isListed: boolean;
  is86d: boolean;
  sortOrder: number;
  updatedAt: string | null;
  mediaVersions: ContentMediaVersion[];
};

export type ContentMediaVersion = {
  id: string;
  url: string;
  createdAt: string;
  entityKey?: string;
  slot?: string;
};

export type ContentCatalogResource = {
  id: string;
  kind: 'material' | 'specification' | 'procedure' | 'recipe' | 'knowledge' | 'skill' | 'training_module' | 'training_lesson';
  slug: string;
  title: string;
  summary: string;
  audience: 'public' | 'staff' | 'manager' | 'owner';
  externalRef: string | null;
  imageUrl: string | null;
  mediaVersions: ContentMediaVersion[];
};

export type ContentCatalogPlacement = {
  id: string;
  nodeId: string;
  parentId: string | null;
  sortOrder: number;
  isPrimary: boolean;
};

export type ContentCatalogRelation = {
  id: string;
  sourceId: string;
  targetId: string;
  kind: 'requires' | 'follows' | 'teaches' | 'develops' | 'covers' | 'prerequisite' | 'related' | 'substitute';
};

export type TrainingReleaseEditor = {
  id: string | null;
  version: number;
  status: 'empty' | 'draft' | 'published';
  manifest: TrainingManifest;
  updatedAt: string | null;
};

export type TrainingAutomationRun = {
  id: string;
  status: string;
  stage: string;
  progress: number;
  createdAt: string;
} | null;

export type ContentWorkspaceData = {
  menu: ContentMenu;
  categories: ContentCategory[];
  items: ContentMenuItem[];
  catalogResources: ContentCatalogResource[];
  catalogRelations: ContentCatalogRelation[];
  catalogPlacements: ContentCatalogPlacement[];
  training: TrainingReleaseEditor;
  trainingMediaVersions: ContentMediaVersion[];
  trainingProfile: TenantTrainingProfile;
  automationRun: TrainingAutomationRun;
};

export type MenuItemDraft = Omit<ContentMenuItem, 'id' | 'updatedAt' | 'mediaVersions'> & { id: string | null };

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isContentMenuSize(value: unknown): value is ContentMenuSize {
  return isRecord(value) && typeof value.slug === 'string' && typeof value.label === 'string'
    && typeof value.priceCents === 'number';
}

function isContentOptionGroup(value: unknown): value is ContentOptionGroup {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string'
      || (value.select !== 'single' && value.select !== 'multi') || typeof value.required !== 'boolean'
      || typeof value.maxChoices !== 'number' || !Array.isArray(value.choices)) return false;
  const dependency = value.dependsOn;
  const dependencyValid = dependency === undefined || (isRecord(dependency)
    && typeof dependency.groupId === 'string' && Array.isArray(dependency.choiceIds)
    && dependency.choiceIds.every((choice) => typeof choice === 'string'));
  return dependencyValid && value.choices.every((choice) => isRecord(choice)
    && typeof choice.id === 'string' && typeof choice.name === 'string'
    && typeof choice.priceDeltaCents === 'number');
}

function isSafePublicHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    if (!host || host === 'localhost' || host === '::1' || host === '0.0.0.0'
        || host.endsWith('.local') || host.endsWith('.internal')) return false;
    if (/^(?:0|10|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])|127|169\.254|192\.168)\./.test(host)) return false;
    const private172 = /^172\.(\d{1,3})\./.exec(host);
    return !(private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31);
  } catch {
    return false;
  }
}

export function imageExtensionFor(type: string, bytes: Uint8Array): 'jpg' | 'png' | 'webp' | null {
  const jpeg = type === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = type === 'image/png'
    && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value);
  const webp = type === 'image/webp'
    && new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF'
    && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP';
  return jpeg ? 'jpg' : png ? 'png' : webp ? 'webp' : null;
}

export function isMenuItemDraft(value: unknown): value is MenuItemDraft {
  if (!isRecord(value)) return false;
  return (value.id === null || typeof value.id === 'string')
    && typeof value.name === 'string'
    && typeof value.slug === 'string'
    && typeof value.description === 'string'
    && typeof value.categoryId === 'string'
    && typeof value.basePriceCents === 'number'
    && Array.isArray(value.sizes) && value.sizes.every(isContentMenuSize)
    && Array.isArray(value.optionGroups) && value.optionGroups.every(isContentOptionGroup)
    && (value.imageUrl === null || typeof value.imageUrl === 'string')
    && ['public', 'staff', 'manager', 'owner'].includes(value.audience as string)
    && typeof value.isListed === 'boolean'
    && typeof value.is86d === 'boolean'
    && typeof value.sortOrder === 'number';
}

/**
 * Validates a draft arriving from the browser and hands back the canonical
 * manifest. It is not a type guard because the payload may be an older schema
 * spelling than the one the rest of HQ works in, and the caller must edit what
 * came back rather than the shape that was posted.
 */
export function parseTrainingDraftPayload(value: unknown): TrainingManifest | null {
  if (!isRecord(value) || !isRecord(value.tenant) || !Array.isArray(value.sources)) return null;
  const tenant = value.tenant;
  if (typeof tenant.businessName !== 'string' || typeof tenant.industry !== 'string' || typeof tenant.locale !== 'string') return null;
  const sourcesValid = value.sources.every((source) => isRecord(source)
    && ['title', 'url', 'publisher', 'accessedAt'].every((key) => typeof source[key] === 'string'));
  const nodes = value.schemaVersion === 3 ? value.tracks : value.modules;
  if (!sourcesValid || !Array.isArray(nodes) || !nodes.every(isTrackPayload)) return null;
  return liftTrainingManifest(value);
}

function isTrackPayload(value: unknown): boolean {
  return isRecord(value)
    && typeof value.slug === 'string' && typeof value.title === 'string' && typeof value.summary === 'string'
    && (value.trackKey === undefined || ['knowledge', 'skills', 'service', 'safety', 'operations', 'custom'].includes(value.trackKey as string))
    && (value.sortOrder === undefined || typeof value.sortOrder === 'number')
    && isRecord(value.icon) && typeof value.icon.symbol === 'string' && typeof value.icon.prompt === 'string'
    && (value.icon.url === undefined || typeof value.icon.url === 'string')
    && Array.isArray(value.lessons) && value.lessons.every((lesson) => isLessonPayload(lesson));
}

function isLessonPayload(value: unknown): boolean {
  if (!isRecord(value) || !['slug', 'title', 'objective', 'content'].every((key) => typeof value[key] === 'string')
      || typeof value.estimatedMinutes !== 'number' || !Array.isArray(value.sourceUrls)
      || !value.sourceUrls.every((url) => typeof url === 'string') || !Array.isArray(value.media)
      || !Array.isArray(value.quiz)) return false;
  const mediaValid = value.media.every((media) => isRecord(media)
    && (media.kind === 'image' || media.kind === 'video')
    && ['url', 'title', 'rightsNote'].every((key) => typeof media[key] === 'string'));
  const quizValid = value.quiz.every((question) => isRecord(question)
    && typeof question.prompt === 'string' && typeof question.explanation === 'string'
    && (question.correctChoice === undefined || typeof question.correctChoice === 'number')
    && Array.isArray(question.choices) && question.choices.every((choice) => typeof choice === 'string'));
  const menuReferencesValid = value.menuItemSlugs === undefined
    || (Array.isArray(value.menuItemSlugs) && value.menuItemSlugs.every((slug) => typeof slug === 'string' && SLUG.test(slug)));
  return mediaValid && quizValid && menuReferencesValid;
}

export function slugFromLabel(label: string): string {
  return slugify(label, 80);
}

export function validateMenuItemDraft(
  draft: MenuItemDraft,
  categoryIds: ReadonlySet<string>,
): string[] {
  const issues: string[] = [];
  if (draft.name.trim().length < 2 || draft.name.trim().length > 120) {
    issues.push('Name must contain 2–120 characters.');
  }
  if (!SLUG.test(draft.slug) || draft.slug.length > 80) {
    issues.push('Slug must use lowercase letters, numbers, and single hyphens.');
  }
  if (draft.description.trim().length > 600) {
    issues.push('Description cannot exceed 600 characters.');
  }
  if (!categoryIds.has(draft.categoryId)) issues.push('Choose a category from this menu.');
  if (!Number.isInteger(draft.basePriceCents) || draft.basePriceCents < 0 || draft.basePriceCents > 1_000_000) {
    issues.push('Price must be between $0.00 and $10,000.00.');
  }
  const sizeSlugs = new Set<string>();
  if (draft.sizes.length > 12) issues.push('A menu item can contain no more than 12 sizes.');
  for (const size of draft.sizes) {
    if (!SLUG.test(size.slug) || sizeSlugs.has(size.slug)) issues.push('Every size needs a unique portable slug.');
    sizeSlugs.add(size.slug);
    if (size.label.trim().length < 1 || size.label.trim().length > 50) issues.push('Every size needs a label of 1–50 characters.');
    if (!Number.isInteger(size.priceCents) || size.priceCents < 0 || size.priceCents > 1_000_000) issues.push('Every size price must be between $0.00 and $10,000.00.');
  }
  const groupIds = new Set<string>();
  const choiceIds = new Set<string>();
  const choicesByGroup = new Map<string, Set<string>>();
  if (draft.optionGroups.length > 20) issues.push('A menu item can contain no more than 20 option groups.');
  for (const group of draft.optionGroups) {
    if (!SLUG.test(group.id) || groupIds.has(group.id)) issues.push('Every option group needs a unique portable key.');
    const parentChoices = group.dependsOn ? choicesByGroup.get(group.dependsOn.groupId) : undefined;
    if (group.dependsOn && (!parentChoices || group.dependsOn.choiceIds.length < 1
        || group.dependsOn.choiceIds.some((choice) => !parentChoices.has(choice)))) {
      issues.push('Option display conditions must reference an earlier group and its choices.');
    }
    groupIds.add(group.id);
    if (group.name.trim().length < 1 || group.name.trim().length > 80) issues.push('Every option group needs a name of 1–80 characters.');
    if (!Number.isInteger(group.maxChoices) || group.maxChoices < 1 || group.maxChoices > 30
        || (group.select === 'single' && group.maxChoices !== 1)) issues.push('Option limits must match their selection type.');
    if (group.choices.length < 1 || group.choices.length > 40) issues.push('Every option group needs 1–40 choices.');
    const currentChoices = new Set<string>();
    for (const choice of group.choices) {
      if (!SLUG.test(choice.id) || choiceIds.has(choice.id)) issues.push('Every option choice needs a unique portable key.');
      choiceIds.add(choice.id);
      currentChoices.add(choice.id);
      if (choice.name.trim().length < 1 || choice.name.trim().length > 80) issues.push('Every option choice needs a name of 1–80 characters.');
      if (!Number.isInteger(choice.priceDeltaCents) || choice.priceDeltaCents < 0 || choice.priceDeltaCents > 1_000_000) issues.push('Option prices must be between $0.00 and $10,000.00.');
    }
    choicesByGroup.set(group.id, currentChoices);
  }
  if (new TextEncoder().encode(JSON.stringify(draft.optionGroups)).byteLength > 100_000) {
    issues.push('Menu options cannot exceed 100 KB.');
  }
  if (!Number.isInteger(draft.sortOrder) || draft.sortOrder < 0 || draft.sortOrder > 100_000) {
    issues.push('Sort order must be a whole number between 0 and 100,000.');
  }
  if (draft.imageUrl && (!isSafePublicHttpsUrl(draft.imageUrl) || draft.imageUrl.length > 2_048)) {
    issues.push('Image URL must use public HTTPS and be at most 2,048 characters.');
  }
  return issues;
}

export function restoreTrainingAnswers(
  manifest: TrainingManifest,
  answerKey: TrainingAnswerKey,
): TrainingManifest {
  return {
    ...manifest,
    modules: manifest.modules.map((module) => ({
      ...module,
      lessons: module.lessons.map((lesson) => ({
        ...lesson,
        quiz: lesson.quiz.map((question, index) => ({
          ...question,
          correctChoice: answerKey[module.slug]?.[lesson.slug]?.[index],
        })),
      })),
    })),
  };
}

export function validateTrainingDraft(manifest: TrainingManifest): string[] {
  const issues: string[] = [];
  if (![1, 2, 3].includes(manifest.schemaVersion)) issues.push('Training schema version must be 1, 2, or 3.');
  const normalized = normalizeTrainingManifest(manifest);
  if (normalized.modules.length > 16) issues.push('Training can contain no more than 16 modules.');
  if (manifest.sources.length > 12) issues.push('Training can contain no more than 12 sources.');
  for (const module of manifest.modules) {
    if (!SLUG.test(module.slug)) issues.push(`Module “${module.title || 'Untitled'}” needs a valid slug.`);
    if (module.lessons.length > 12) issues.push(`Module “${module.title || module.slug}” has more than 12 lessons.`);
    for (const lesson of module.lessons) {
      if (!SLUG.test(lesson.slug)) issues.push(`Lesson “${lesson.title || 'Untitled'}” needs a valid slug.`);
      if (lesson.media.length > 4) issues.push(`Lesson “${lesson.title || lesson.slug}” has more than 4 media items.`);
      if (lesson.quiz.length > 20) issues.push(`Lesson “${lesson.title || lesson.slug}” has more than 20 quiz questions.`);
    }
  }
  const trackKeys = new Set(normalized.modules.map((module) => module.trackKey).filter((key): key is TrainingTrackKey => Boolean(key)));
  for (const track of TRAINING_TRACK_ORDER) if (!trackKeys.has(track)) issues.push(`Training needs a ${track} module.`);
  if (new TextEncoder().encode(JSON.stringify(manifest)).byteLength > 1_500_000) {
    issues.push('Training content cannot exceed 1.5 MB.');
  }
  return issues;
}

export function starterTrainingManifest(profile: TenantTrainingProfile): TrainingManifest {
  const icons: Record<(typeof TRAINING_TRACK_ORDER)[number], string> = {
    knowledge: 'book-open', skills: 'wrench', service: 'star', safety: 'lock', operations: 'briefcase',
  };
  return {
    schemaVersion: 2,
    generatedAt: new Date(0).toISOString(),
    tenant: profile,
    sources: [],
    modules: TRAINING_TRACK_ORDER.map((trackKey, sortOrder) => ({
      slug: trackKey,
      trackKey,
      sortOrder,
      title: trackKey.charAt(0).toUpperCase() + trackKey.slice(1),
      summary: `Add the ${trackKey} every operator needs for this business.`,
      icon: { symbol: icons[trackKey], prompt: `Simple monochrome ${trackKey} line icon` },
      lessons: [],
    })),
  };
}

export function contentCounts(data: ContentWorkspaceData): {
  listedItems: number;
  lessons: number;
  media: number;
} {
  const lessons = data.training.manifest.modules.flatMap((module) => module.lessons);
  return {
    listedItems: data.items.filter((item) => item.isListed).length,
    lessons: lessons.length,
    media: data.items.filter((item) => item.imageUrl).length
      + lessons.reduce((total, lesson) => total + lesson.media.length, 0),
  };
}
