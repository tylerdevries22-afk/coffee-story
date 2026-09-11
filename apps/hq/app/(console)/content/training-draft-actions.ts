'use server';

import { randomUUID } from 'node:crypto';

import { liftTrainingManifest } from '@platform/domain';
import { revalidatePath } from 'next/cache';

import { parseTrainingDraftPayload, validateTrainingDraft } from '@/lib/content-model';
import {
  prepareTrainingRelease,
  validateTrainingManifest,
  type TrainingManifest,
} from '@/lib/training-bootstrap';

import {
  UUID,
  isFailure,
  managerContext,
  retryWrite,
  type Failure,
} from './actions-shared';

export async function saveTrainingDraft(
  input: unknown,
  expectedUpdatedAt: string | null,
): Promise<Failure | { ok: true; releaseId: string; version: number; updatedAt: string; persisted: boolean }> {
  const manifest = parseTrainingDraftPayload(input);
  if (!manifest) return { ok: false, error: 'The training draft payload is invalid.' };
  const draft = { ...manifest, generatedAt: new Date().toISOString() };
  const issues = validateTrainingDraft(draft);
  if (issues.length > 0) return { ok: false, error: issues.join(' ') };
  const context = await managerContext('content.training.save');
  if (isFailure(context)) return context;
  if (!context) {
    return { ok: true, persisted: false, releaseId: `preview-${randomUUID()}`, version: 1, updatedAt: draft.generatedAt };
  }
  const menuSlugs = await context.privileged.from('menu_items').select('slug').eq('brand_id', context.brandId).returns<{ slug: string }[]>();
  if (menuSlugs.error) return { ok: false, error: 'The tenant menu could not be checked for training links.' };
  const knownMenuSlugs = new Set((menuSlugs.data ?? []).map((item) => item.slug));
  const missingMenuLinks = draft.tracks.flatMap((track) => track.lessons.flatMap((lesson) => (lesson.menuItemSlugs ?? []).filter((slug) => !knownMenuSlugs.has(slug)).map((slug) => `${track.slug}/${lesson.slug}: ${slug}`)));
  if (missingMenuLinks.length > 0) return { ok: false, error: `Training links reference missing menu items: ${missingMenuLinks.slice(0, 5).join(', ')}` };
  const prepared = prepareTrainingRelease(draft);
  const existing = await context.privileged.from('training_releases')
    .select('id, version, updated_at').eq('brand_id', context.brandId).eq('status', 'draft')
    .maybeSingle<{ id: string; version: number; updated_at: string }>();
  if (existing.error) return { ok: false, error: 'The training draft could not be loaded.' };

  let saved;
  if (existing.data) {
    const existingDraft = existing.data;
    if (!expectedUpdatedAt || existingDraft.updated_at !== expectedUpdatedAt) {
      return { ok: false, error: 'This training draft changed in another session. Reload before saving.' };
    }
    saved = await retryWrite(() => context.privileged.from('training_releases').update({
      manifest: prepared.publicManifest,
      answer_key: prepared.answerKey,
      template_key: prepared.publicManifest.tenant.templateKey ?? null,
      template_version: prepared.publicManifest.tenant.templateVersion ?? null,
      updated_by: context.brandUserId,
    }).eq('id', existingDraft.id).eq('brand_id', context.brandId).eq('updated_at', existingDraft.updated_at)
      .select('id, version, updated_at').maybeSingle<{ id: string; version: number; updated_at: string }>());
  } else {
    const latest = await context.privileged.from('training_releases').select('version')
      .eq('brand_id', context.brandId).order('version', { ascending: false }).limit(1)
      .maybeSingle<{ version: number }>();
    if (latest.error) return { ok: false, error: 'The training version could not be allocated.' };
    saved = await retryWrite(() => context.privileged.from('training_releases').insert({
      id: randomUUID(), brand_id: context.brandId, version: (latest.data?.version ?? 0) + 1,
      status: 'draft', manifest: prepared.publicManifest, answer_key: prepared.answerKey,
      template_key: prepared.publicManifest.tenant.templateKey ?? null,
      template_version: prepared.publicManifest.tenant.templateVersion ?? null,
      created_by: context.brandUserId, updated_by: context.brandUserId,
    }).select('id, version, updated_at').single<{ id: string; version: number; updated_at: string }>());
  }
  if (saved.error || !saved.data) {
    return { ok: false, error: saved.error?.code === '23505' ? 'Another draft was created. Reload to continue.' : 'The training draft could not be saved.' };
  }
  revalidatePath('/content');
  revalidatePath('/training');
  return { ok: true, persisted: true, releaseId: saved.data.id, version: saved.data.version, updatedAt: saved.data.updated_at };
}
export async function publishTrainingDraft(
  releaseId: string,
  expectedUpdatedAt: string | null,
): Promise<Failure | { ok: true; version: number; persisted: boolean }> {
  const context = await managerContext('content.training.publish');
  if (isFailure(context)) return context;
  if (!context) return { ok: true, version: 1, persisted: false };
  if (!UUID.test(releaseId) || !expectedUpdatedAt) return { ok: false, error: 'Reload the training draft before publishing.' };
  const release = await context.privileged.from('training_releases')
    .select('version, manifest, answer_key, updated_at').eq('id', releaseId)
    .eq('brand_id', context.brandId).eq('status', 'draft')
    .maybeSingle<{ version: number; manifest: TrainingManifest; answer_key: ReturnType<typeof prepareTrainingRelease>['answerKey']; updated_at: string }>();
  if (release.error || !release.data) return { ok: false, error: 'Save a training draft before publishing.' };
  if (expectedUpdatedAt && expectedUpdatedAt !== release.data.updated_at) {
    return { ok: false, error: 'This training draft changed in another session. Reload before publishing.' };
  }
  const stored = liftTrainingManifest(release.data.manifest);
  if (!stored) return { ok: false, error: 'The saved training draft is unreadable. Reload and save it again.' };
  const authoring = restoreAnswersForPublish(stored, release.data.answer_key);
  const issues = validateTrainingManifest(authoring);
  if (issues.length > 0) return { ok: false, error: `Publishing is blocked: ${issues.join('; ')}` };
  const menuSlugs = await context.privileged.from('menu_items').select('slug').eq('brand_id', context.brandId).returns<{ slug: string }[]>();
  if (menuSlugs.error) return { ok: false, error: 'The tenant menu could not be checked for training links.' };
  const knownMenuSlugs = new Set((menuSlugs.data ?? []).map((item) => item.slug));
  const missingMenuLinks = authoring.tracks.flatMap((track) => track.lessons.flatMap((lesson) => (lesson.menuItemSlugs ?? []).filter((slug) => !knownMenuSlugs.has(slug)).map((slug) => `${track.slug}/${lesson.slug}: ${slug}`)));
  if (missingMenuLinks.length > 0) return { ok: false, error: `Publishing is blocked by missing menu links: ${missingMenuLinks.slice(0, 5).join(', ')}` };
  const published = await context.privileged.rpc('publish_manual_training_release', {
    target_brand: context.brandId,
    target_release: releaseId,
    target_editor: context.brandUserId,
    expected_updated_at: release.data.updated_at,
  });
  if (published.error) return { ok: false, error: 'The training release could not be published atomically.' };
  revalidatePath('/content');
  revalidatePath('/training');
  return { ok: true, persisted: true, version: release.data.version };
}
function restoreAnswersForPublish(
  manifest: TrainingManifest,
  answerKey: ReturnType<typeof prepareTrainingRelease>['answerKey'],
): TrainingManifest {
  return {
    ...manifest,
    tracks: manifest.tracks.map((track) => ({
      ...track,
      lessons: track.lessons.map((lesson) => ({
        ...lesson,
        quiz: lesson.quiz.map((question, index) => ({
          ...question, correctChoice: answerKey[track.slug]?.[lesson.slug]?.[index],
        })),
      })),
    })),
  };
}
