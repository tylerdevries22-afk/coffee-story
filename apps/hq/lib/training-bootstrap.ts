import {
  normalizeTrainingManifest,
  scoreTrainingQuiz,
  TRAINING_TRACK_ORDER,
  type TenantTrainingProfile,
  type TrainingManifest,
  type TrainingSource,
  type TrainingTrack,
} from '@platform/domain';

import { isSafePublicHttpsUrl } from './training-profile';

export type { TenantTrainingProfile, TrainingManifest } from '@platform/domain';
export {
  normalizeTrainingProfile,
  resolveTenantTrainingProfile,
  trainingProfileFromBrandConfig,
  validateTrainingProfile,
} from './training-profile';

export const TRAINING_PIPELINE_VERSION = '2.0.0';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function validateTrainingManifest(manifest: TrainingManifest): string[] {
  const issues: string[] = [];
  const normalized = normalizeTrainingManifest(manifest);
  if (![1, 2, 3].includes(manifest.schemaVersion)) issues.push('training schema version must be 1, 2, or 3');
  if (manifest.sources.length < 3) issues.push('at least 3 research sources are required');
  if (manifest.sources.length > 12) issues.push('no more than 12 research sources are allowed');
  if (manifest.tracks.length < TRAINING_TRACK_ORDER.length) issues.push('all five core training tracks are required');
  if (manifest.tracks.length > 16) issues.push('no more than 16 training tracks are allowed');
  manifest.sources.forEach((source, index) => {
    if (!isSafePublicHttpsUrl(source.url)) issues.push(`source ${index + 1} must use public HTTPS`);
  });
  const mediaCount = manifest.tracks.reduce(
    (total, track) => total + track.lessons.reduce((lessonTotal, lesson) => lessonTotal + lesson.media.length, 0),
    0,
  );
  if (mediaCount > 24) issues.push('no more than 24 media resources are allowed');
  const sourceUrls = new Set(manifest.sources.map((source) => source.url));
  const slugs = new Set<string>();
  normalized.tracks.forEach((track, index) => {
    if (!SLUG.test(track.slug)) issues.push(`track ${index + 1} has an invalid slug`);
    if (slugs.has(track.slug)) issues.push(`track ${track.slug} is duplicated`);
    slugs.add(track.slug);
    if (track.sortOrder !== undefined && (!Number.isInteger(track.sortOrder) || track.sortOrder < 0)) issues.push(`track ${track.slug} has an invalid sort order`);
    if (track.icon.url && !isSafePublicHttpsUrl(track.icon.url)) issues.push(`track ${track.slug} icon must use public HTTPS`);
    if (track.lessons.length > 12) issues.push(`track ${track.slug} has too many lessons`);
    issues.push(...lessonIssues(track, sourceUrls));
  });
  for (const required of TRAINING_TRACK_ORDER) if (!slugs.has(required)) issues.push(`missing core track ${required}`);
  return issues;
}

function lessonIssues(track: TrainingTrack, sourceUrls: ReadonlySet<string>): string[] {
  const issues: string[] = [];
  const lessonSlugs = new Set<string>();
  track.lessons.forEach((lesson, lessonIndex) => {
    if (!SLUG.test(lesson.slug)) issues.push(`lesson ${track.slug}/${lessonIndex + 1} has an invalid slug`);
    if (lessonSlugs.has(lesson.slug)) issues.push(`lesson ${track.slug}/${lesson.slug} is duplicated`);
    lessonSlugs.add(lesson.slug);
    if (lesson.content.trim().length < 80) issues.push(`lesson ${track.slug}/${lesson.slug} needs substantive content`);
    if (lesson.sourceUrls.length === 0) issues.push(`lesson ${track.slug}/${lesson.slug} needs a source citation`);
    lesson.sourceUrls.forEach((url) => {
      if (!sourceUrls.has(url)) issues.push(`lesson ${track.slug}/${lesson.slug} cites an unknown source`);
      if (!isSafePublicHttpsUrl(url)) issues.push(`lesson ${track.slug}/${lesson.slug} has an unsafe source URL`);
    });
    if (lesson.menuItemSlugs && (!Array.isArray(lesson.menuItemSlugs) || lesson.menuItemSlugs.some((slug) => !SLUG.test(slug)))) issues.push(`lesson ${track.slug}/${lesson.slug} has invalid menu references`);
    if (lesson.quiz.length < 2) issues.push(`lesson ${track.slug}/${lesson.slug} needs at least 2 quiz questions`);
    lesson.quiz.forEach((question, questionIndex) => {
      if (question.choices.length < 2 || !Number.isInteger(question.correctChoice)
        || (question.correctChoice ?? -1) < 0 || (question.correctChoice ?? question.choices.length) >= question.choices.length) {
        issues.push(`question ${track.slug}/${lesson.slug}/${questionIndex + 1} has invalid choices`);
      }
    });
    lesson.media.forEach((media, mediaIndex) => {
      if (!isSafePublicHttpsUrl(media.url)) issues.push(`media ${track.slug}/${lesson.slug}/${mediaIndex + 1} must use public HTTPS`);
      if (!sourceUrls.has(media.url)) issues.push(`media ${track.slug}/${lesson.slug}/${mediaIndex + 1} needs a matching source record`);
      if (media.rightsNote.trim().length < 12) issues.push(`media ${track.slug}/${lesson.slug}/${mediaIndex + 1} needs a specific rights note`);
    });
  });
  return issues;
}

/**
 * Applies researched tenant overlays without throwing away reusable franchise
 * lessons. Matching lesson slugs are intentionally replaced by the researched
 * copy; untouched template lessons remain available to every tenant.
 *
 * Matching is by track slug alone. It used to branch on `trackKey` and fall
 * back to the slug, which meant a researched track and a template track could
 * both claim the same core track and one of them would be dropped.
 */
export function mergeTrainingTemplate(
  template: TrainingManifest | null,
  generated: { sources: TrainingSource[]; tracks: TrainingTrack[] },
  profile: TenantTrainingProfile,
): TrainingManifest {
  const generatedManifest = normalizeTrainingManifest({
    schemaVersion: 3,
    generatedAt: new Date().toISOString(),
    tenant: profile,
    ...generated,
  });
  if (!template) return generatedManifest;

  const generatedBySlug = new Map(generatedManifest.tracks.map((track) => [track.slug, track]));
  const mergedTemplateTracks = template.tracks.map((templateTrack) => {
    const generatedTrack = generatedBySlug.get(templateTrack.slug);
    if (!generatedTrack) return templateTrack;
    const generatedLessonSlugs = new Set(generatedTrack.lessons.map((lesson) => lesson.slug));
    return {
      ...templateTrack,
      ...generatedTrack,
      lessons: [
        ...generatedTrack.lessons,
        ...templateTrack.lessons.filter((lesson) => !generatedLessonSlugs.has(lesson.slug)),
      ],
    };
  });
  const templateSlugs = new Set(template.tracks.map((track) => track.slug));
  const newTracks = generatedManifest.tracks.filter((track) => !templateSlugs.has(track.slug));
  const sourceByUrl = new Map([...template.sources, ...generatedManifest.sources].map((source) => [source.url, source]));
  return normalizeTrainingManifest({
    schemaVersion: 3,
    generatedAt: new Date().toISOString(),
    tenant: { ...template.tenant, ...profile },
    sources: [...sourceByUrl.values()],
    tracks: [...mergedTemplateTracks, ...newTracks],
  });
}

/** Answer keys are filed by track slug; the published manifest carries none. */
export type TrainingAnswerKey = Record<string, Record<string, number[]>>;

export function prepareTrainingRelease(manifest: TrainingManifest): { publicManifest: TrainingManifest; answerKey: TrainingAnswerKey } {
  const answerKey: TrainingAnswerKey = {};
  const tracks = manifest.tracks.map((track) => {
    const lessonKeys: Record<string, number[]> = {};
    const lessons = track.lessons.map((lesson) => {
      lessonKeys[lesson.slug] = lesson.quiz.map((question) => question.correctChoice ?? -1);
      const quiz = lesson.quiz.map(({ correctChoice: _correctChoice, ...question }) => question);
      return { ...lesson, quiz };
    });
    answerKey[track.slug] = lessonKeys;
    return { ...track, lessons };
  });
  return { publicManifest: { ...manifest, tracks }, answerKey };
}

export { scoreTrainingQuiz };
