/**
 * Training content: tracks, modules, lessons, quizzes, and the release
 * manifest that publishes them.
 *
 * "Module" here is a group of lessons, never a capability module from
 * `@platform/module-kit` -- all of this content belongs to the single
 * `workforce-training` capability. The distinction matters because the two
 * vocabularies share a string: `'operations'` is a track key below and also
 * half of the `workforce-operations` module key, and the two are unrelated.
 * `docs/ARCHITECTURE.md` ("Vocabulary") pins both down.
 */
export const TRAINING_TRACK_ORDER = ['knowledge', 'skills', 'service', 'safety', 'operations'] as const;

export type TrainingTrackKey = (typeof TRAINING_TRACK_ORDER)[number] | 'custom';

export type TenantTrainingProfile = {
  businessName: string;
  industry: string;
  locale: string;
  /** Reusable franchise template selected for this tenant. */
  templateKey?: string;
  templateVersion?: number;
  website?: string;
  products?: string[];
  services?: string[];
  complianceTopics?: string[];
  brandVoice?: string;
};

export type TrainingSource = { title: string; url: string; publisher: string; accessedAt: string };

export type TrainingQuizQuestion = {
  prompt: string;
  choices: string[];
  /** Present only inside the generation pipeline; stripped before publication. */
  correctChoice?: number;
  explanation: string;
};

export type TrainingLesson = {
  slug: string;
  title: string;
  objective: string;
  content: string;
  estimatedMinutes: number;
  /** Source URLs that directly support this lesson's operational claims. */
  sourceUrls: string[];
  /** Optional links into the tenant's published menu tree. */
  menuItemSlugs?: string[];
  media: { kind: 'image' | 'video'; url: string; title: string; rightsNote: string }[];
  quiz: TrainingQuizQuestion[];
  /** Stable competency keys awarded when this lesson is passed. */
  grantsCompetencyKeys?: string[];
  /** Validity of awarded competencies; tenant config may override it. */
  competencyValidityDays?: number;
};

export type TrainingModule = {
  slug: string;
  trackKey?: TrainingTrackKey;
  sortOrder?: number;
  title: string;
  summary: string;
  icon: { symbol: string; prompt: string; url?: string };
  lessons: TrainingLesson[];
};

/**
 * Only a stored release ever carries an older version. `liftTrainingManifest`
 * is the one reader that accepts every one of them, and it hands the rest of
 * the codebase a single current shape.
 */
export type TrainingSchemaVersion = 1 | 2 | 3;

export type TrainingManifest = {
  schemaVersion: TrainingSchemaVersion;
  generatedAt: string;
  tenant: TenantTrainingProfile;
  sources: TrainingSource[];
  modules: TrainingModule[];
};

/** Stable ordering shared by HQ and every operator build. */
export function trainingTrackIndex(trackKey: TrainingTrackKey | undefined): number {
  const index = trackKey ? TRAINING_TRACK_ORDER.indexOf(trackKey as (typeof TRAINING_TRACK_ORDER)[number]) : -1;
  return index >= 0 ? index : TRAINING_TRACK_ORDER.length;
}

/**
 * Upgrades the original release contract without rewriting historical rows.
 * v1 modules are inferred from their portable slug/title and remain valid for
 * reads while HQ saves the next draft as v2.
 */
export function normalizeTrainingManifest(manifest: TrainingManifest): TrainingManifest {
  const modules = [...manifest.modules]
    .map((module, index) => {
      const inferred = module.trackKey ?? inferTrainingTrackKey(module.slug, module.title);
      return { ...module, trackKey: inferred, sortOrder: module.sortOrder ?? index };
    });
  const existingTracks = new Set(modules.map((module) => module.trackKey));
  TRAINING_TRACK_ORDER.forEach((trackKey, index) => {
    if (existingTracks.has(trackKey)) return;
    modules.push({
      slug: trackKey,
      trackKey,
      sortOrder: index,
      title: trackKey.charAt(0).toUpperCase() + trackKey.slice(1),
      summary: `No ${trackKey} lessons have been published yet.`,
      icon: { symbol: trackKey, prompt: `Simple monochrome ${trackKey} line icon` },
      lessons: [],
    });
  });
  modules.sort((left, right) => {
    const trackOrder = trainingTrackIndex(left.trackKey) - trainingTrackIndex(right.trackKey);
    return trackOrder || (left.sortOrder ?? 0) - (right.sortOrder ?? 0);
  });
  return { ...manifest, schemaVersion: 2, modules };
}

/** Scores a completed quiz without exposing answer keys in a published release. */
export function scoreTrainingQuiz(
  questions: readonly TrainingQuizQuestion[],
  answers: readonly number[],
): { score: number; passed: boolean } {
  if (questions.length === 0 || answers.length !== questions.length) return { score: 0, passed: false };
  const correct = questions.reduce((total, question, index) => total + (answers[index] === question.correctChoice ? 1 : 0), 0);
  const score = Math.round((correct / questions.length) * 100);
  return { score, passed: score >= 80 };
}

function inferTrainingTrackKey(slug: string, title: string): TrainingTrackKey {
  const value = `${slug} ${title}`.toLowerCase();
  if (value.includes('skill')) return 'skills';
  if (value.includes('service')) return 'service';
  if (value.includes('safety')) return 'safety';
  if (value.includes('operation')) return 'operations';
  if (value.includes('knowledge')) return 'knowledge';
  return 'custom';
}
