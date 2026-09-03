/**
 * Training content: tracks, lessons, quizzes, and the release manifest that
 * publishes them. Nothing here is a capability module from
 * `@platform/module-kit` -- all of this content belongs to the single
 * `workforce-training` capability, and the word "module" is no longer used
 * for any of it. `docs/ARCHITECTURE.md` ("Vocabulary") pins that down; the
 * one string the two sides still share is `'operations'`, a track slug below
 * and half of the unrelated `workforce-operations` capability key.
 *
 * A track's `slug` is its whole identity. It is what `track_slug` stores in
 * training_lesson_progress, training_quiz_attempts and
 * training_competency_awards, what keys the answer key, what the operator URL
 * carries, and what `award_operation_competency` matches the manifest on. A
 * track used to carry a second `trackKey` beside it for grouping; the two
 * disagreed for anything HQ authored, nothing that persists ever read the
 * second one, and it is gone.
 */
export const TRAINING_TRACK_ORDER = ['knowledge', 'skills', 'service', 'safety', 'operations'] as const;

/** The five tracks every tenant gets. Any other slug is a tenant's own track. */
export type TrainingTrackKey = (typeof TRAINING_TRACK_ORDER)[number];

export function isCoreTrainingTrack(slug: string): slug is TrainingTrackKey {
  return (TRAINING_TRACK_ORDER as readonly string[]).includes(slug);
}

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

export type TrainingTrack = {
  slug: string;
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
  tracks: TrainingTrack[];
};

/** Stable ordering shared by HQ and every operator build; custom tracks last. */
export function trainingTrackIndex(slug: string): number {
  const index = TRAINING_TRACK_ORDER.indexOf(slug as TrainingTrackKey);
  return index >= 0 ? index : TRAINING_TRACK_ORDER.length;
}

/**
 * Fills in what a stored release is allowed to leave out and guarantees the
 * five core tracks exist, so every surface can render the same rail without
 * checking for holes. Portable slugs are never rewritten: a slug is the key
 * a member's progress rows and competency awards are already filed under.
 */
export function normalizeTrainingManifest(manifest: TrainingManifest): TrainingManifest {
  const tracks = manifest.tracks.map((track, index) => ({ ...track, sortOrder: track.sortOrder ?? index }));
  const present = new Set(tracks.map((track) => track.slug));
  TRAINING_TRACK_ORDER.forEach((slug, index) => {
    if (present.has(slug)) return;
    tracks.push({
      slug,
      sortOrder: index,
      title: slug.charAt(0).toUpperCase() + slug.slice(1),
      summary: `No ${slug} lessons have been published yet.`,
      icon: { symbol: slug, prompt: `Simple monochrome ${slug} line icon` },
      lessons: [],
    });
  });
  tracks.sort((left, right) => {
    const trackOrder = trainingTrackIndex(left.slug) - trainingTrackIndex(right.slug);
    return trackOrder || (left.sortOrder ?? 0) - (right.sortOrder ?? 0);
  });
  return { ...manifest, schemaVersion: 3, tracks };
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
