/**
 * The shapes the content workspace passes between its server actions and its
 * client editors. Validation lives beside the thing it validates --
 * `content-model-menu` for the catalog, `content-model-training` for training
 * releases -- and both are re-exported here so a caller has one import.
 */
import type { TenantTrainingProfile, TrainingManifest } from './training-bootstrap';

export { imageExtensionFor, slugFromLabel } from './content-guards';
export { isMenuItemDraft, validateMenuItemDraft } from './content-model-menu';
export {
  parseTrainingDraftPayload,
  restoreTrainingAnswers,
  starterTrainingManifest,
  trainingTrackArtworkUrl,
  validateTrainingDraft,
} from './content-model-training';

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

export function contentCounts(data: ContentWorkspaceData): {
  listedItems: number;
  lessons: number;
  media: number;
} {
  const lessons = data.training.manifest.tracks.flatMap((track) => track.lessons);
  return {
    listedItems: data.items.filter((item) => item.isListed).length,
    lessons: lessons.length,
    media: data.items.filter((item) => item.imageUrl).length
      + lessons.reduce((total, lesson) => total + lesson.media.length, 0),
  };
}
