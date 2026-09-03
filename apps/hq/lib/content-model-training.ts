import {
  isCoreTrainingTrack,
  liftTrainingManifest,
  normalizeTrainingManifest,
  TRAINING_TRACK_ORDER,
} from '@platform/domain';

import { isRecord, SLUG } from './content-guards';
import type { TenantTrainingProfile, TrainingAnswerKey, TrainingManifest } from './training-bootstrap';

/**
 * Validates a draft arriving from the browser and hands back the canonical
 * manifest. It is not a type guard because the payload may be an older schema
 * spelling than the one the rest of HQ works in, and the caller must go on to
 * edit what came back rather than the shape that was posted.
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

/** Answer keys are filed by track slug, which is why the slug is the identity. */
export function restoreTrainingAnswers(
  manifest: TrainingManifest,
  answerKey: TrainingAnswerKey,
): TrainingManifest {
  return {
    ...manifest,
    tracks: manifest.tracks.map((track) => ({
      ...track,
      lessons: track.lessons.map((lesson) => ({
        ...lesson,
        quiz: lesson.quiz.map((question, index) => ({
          ...question,
          correctChoice: answerKey[track.slug]?.[lesson.slug]?.[index],
        })),
      })),
    })),
  };
}

export function validateTrainingDraft(manifest: TrainingManifest): string[] {
  const issues: string[] = [];
  if (![1, 2, 3].includes(manifest.schemaVersion)) issues.push('Training schema version must be 1, 2, or 3.');
  const normalized = normalizeTrainingManifest(manifest);
  if (normalized.tracks.length > 16) issues.push('Training can contain no more than 16 tracks.');
  if (manifest.sources.length > 12) issues.push('Training can contain no more than 12 sources.');
  const slugs = new Set<string>();
  for (const track of manifest.tracks) {
    if (!SLUG.test(track.slug)) issues.push(`Track “${track.title || 'Untitled'}” needs a valid slug.`);
    if (slugs.has(track.slug)) issues.push(`Track “${track.slug}” is used twice.`);
    slugs.add(track.slug);
    if (track.lessons.length > 12) issues.push(`Track “${track.title || track.slug}” has more than 12 lessons.`);
    for (const lesson of track.lessons) {
      if (!SLUG.test(lesson.slug)) issues.push(`Lesson “${lesson.title || 'Untitled'}” needs a valid slug.`);
      if (lesson.media.length > 4) issues.push(`Lesson “${lesson.title || lesson.slug}” has more than 4 media items.`);
      if (lesson.quiz.length > 20) issues.push(`Lesson “${lesson.title || lesson.slug}” has more than 20 quiz questions.`);
    }
  }
  for (const track of TRAINING_TRACK_ORDER) if (!slugs.has(track)) issues.push(`Training needs a ${track} track.`);
  if (new TextEncoder().encode(JSON.stringify(manifest)).byteLength > 1_500_000) {
    issues.push('Training content cannot exceed 1.5 MB.');
  }
  return issues;
}

export function starterTrainingManifest(profile: TenantTrainingProfile): TrainingManifest {
  const icons: Record<string, string> = {
    knowledge: 'book-open', skills: 'wrench', service: 'star', safety: 'lock', operations: 'briefcase',
  };
  return {
    schemaVersion: 3,
    generatedAt: new Date(0).toISOString(),
    tenant: profile,
    sources: [],
    tracks: TRAINING_TRACK_ORDER.map((slug, sortOrder) => ({
      slug,
      sortOrder,
      title: slug.charAt(0).toUpperCase() + slug.slice(1),
      summary: `Add the ${slug} every operator needs for this business.`,
      icon: { symbol: icons[slug] ?? slug, prompt: `Simple monochrome ${slug} line icon` },
      lessons: [],
    })),
  };
}

/** The artwork a track shows before a tenant uploads its own. */
export function trainingTrackArtworkUrl(track: { slug: string; icon: { url?: string } }): string | undefined {
  if (track.icon.url) return track.icon.url;
  return isCoreTrainingTrack(track.slug) ? `/api/demo-media/training/${track.slug}` : undefined;
}
