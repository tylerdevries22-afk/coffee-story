import type { TrainingManifest } from '@platform/domain';

import {
  authenticate,
  corsPreflight,
  jsonError,
  jsonWithCors,
  notConfigured,
  parseJsonBody,
  serverEnv,
  serviceDb,
} from '../../../../lib/api-auth';
import { scoreTrainingQuiz } from '../../../../lib/training-bootstrap';
import type { TrainingAnswerKey } from '../../../../lib/training-bootstrap';

type ProgressBody = {
  attemptId?: string;
  releaseId?: string;
  moduleSlug?: string;
  lessonSlug?: string;
  answers?: number[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function OPTIONS(): Response {
  return corsPreflight();
}

export async function POST(request: Request): Promise<Response> {
  const env = serverEnv();
  if (!env) return notConfigured();
  const db = serviceDb(env);
  const auth = await authenticate(request, db);
  if (auth instanceof Response) return auth;
  if (!auth.claims.role) return jsonError(403, 'forbidden', 'Training progress is available to tenant staff only.');
  const body = await parseJsonBody<ProgressBody>(request);
  if (body instanceof Response) return body;
  if (!body.attemptId || !UUID.test(body.attemptId) || !body.releaseId || !UUID.test(body.releaseId)
    || !body.moduleSlug || !SLUG.test(body.moduleSlug) || !body.lessonSlug || !SLUG.test(body.lessonSlug)
    || !Array.isArray(body.answers) || body.answers.some((answer) => !Number.isInteger(answer) || answer < 0)) {
    return jsonError(400, 'invalid_attempt', 'The quiz attempt is incomplete or invalid.');
  }
  const release = await db.from('training_releases').select('manifest, answer_key').eq('id', body.releaseId).eq('brand_id', auth.claims.brand_id).eq('status', 'published').maybeSingle<{ manifest: unknown; answer_key: unknown }>();
  if (release.error) return jsonError(500, 'training_lookup_failed', 'Could not load the training release.');
  const rawManifest = release.data?.manifest;
  if (!rawManifest || typeof rawManifest !== 'object' || !Array.isArray((rawManifest as Partial<TrainingManifest>).modules)) {
    return jsonError(500, 'invalid_release', 'The published training release is invalid.');
  }
  const manifest = rawManifest as TrainingManifest;
  const module = manifest.modules.find((candidate) => candidate.slug === body.moduleSlug);
  const lesson = module?.lessons.find((candidate) => candidate.slug === body.lessonSlug);
  if (!lesson) return jsonError(404, 'lesson_not_found', 'That lesson is not in the published tenant release.');
  const answerKey = release.data?.answer_key as TrainingAnswerKey | undefined;
  const correctChoices = answerKey?.[body.moduleSlug]?.[body.lessonSlug];
  if (!correctChoices || correctChoices.length !== lesson.quiz.length || correctChoices.some((choice) => !Number.isInteger(choice))) {
    return jsonError(500, 'invalid_answer_key', 'The published lesson answer key is invalid.');
  }
  const score = scoreTrainingQuiz(lesson.quiz.map((question, index) => ({ ...question, correctChoice: correctChoices[index] })), body.answers);
  const member = await db.from('brand_users').select('id').eq('brand_id', auth.claims.brand_id).eq('user_id', auth.userId).single<{ id: string }>();
  if (member.error) return jsonError(403, 'no_membership', 'Your tenant membership is not active.');
  const attempts = await db.from('training_quiz_attempts')
    .select('id, created_at')
    .eq('brand_id', auth.claims.brand_id)
    .eq('release_id', body.releaseId)
    .eq('brand_user_id', member.data.id)
    .eq('module_slug', body.moduleSlug)
    .eq('lesson_slug', body.lessonSlug)
    .order('created_at', { ascending: false })
    .limit(5)
    .returns<{ id: string; created_at: string }[]>();
  if (attempts.error) return jsonError(500, 'attempt_lookup_failed', 'Could not check quiz attempts.');
  const isReplay = attempts.data?.some((attempt) => attempt.id === body.attemptId) ?? false;
  if (!isReplay && (attempts.data?.length ?? 0) >= 5) {
    return jsonError(429, 'attempt_limit_reached', 'This lesson has reached its five-attempt limit.');
  }
  const latestAttemptAt = attempts.data?.[0]?.created_at;
  if (!isReplay && latestAttemptAt && Date.now() - new Date(latestAttemptAt).getTime() < 10_000) {
    return jsonError(429, 'attempt_rate_limited', 'Wait a few seconds before submitting another attempt.');
  }

  const attempt = await db.from('training_quiz_attempts').insert({
    id: body.attemptId,
    brand_id: auth.claims.brand_id,
    release_id: body.releaseId,
    brand_user_id: member.data.id,
    module_slug: body.moduleSlug,
    lesson_slug: body.lessonSlug,
    answers: body.answers,
    score: score.score,
    passed: score.passed,
  });
  if (attempt.error?.message.includes('training_attempt_limit_reached')) {
    return jsonError(429, 'attempt_limit_reached', 'This lesson has reached its five-attempt limit.');
  }
  if (attempt.error?.message.includes('training_attempt_rate_limited')) {
    return jsonError(429, 'attempt_rate_limited', 'Wait a few seconds before submitting another attempt.');
  }
  if (attempt.error && attempt.error.code !== '23505') return jsonError(500, 'attempt_save_failed', 'Could not save the quiz attempt.');
  let effectiveScore = score;
  const idempotent = attempt.error?.code === '23505';
  if (idempotent) {
    const prior = await db.from('training_quiz_attempts').select('score, passed').eq('id', body.attemptId).eq('brand_id', auth.claims.brand_id).eq('brand_user_id', member.data.id).maybeSingle<{ score: number; passed: boolean }>();
    if (!prior.data) return jsonError(409, 'attempt_conflict', 'That attempt id is already in use.');
    effectiveScore = prior.data;
  }

  const previous = await db.from('training_lesson_progress').select('attempt_count, status, score').eq('brand_id', auth.claims.brand_id).eq('release_id', body.releaseId).eq('brand_user_id', member.data.id).eq('module_slug', body.moduleSlug).eq('lesson_slug', body.lessonSlug).maybeSingle<{ attempt_count: number; status: string; score: number | null }>();
  if (previous.error) return jsonError(500, 'progress_lookup_failed', 'Could not load lesson progress.');
  const completed = previous.data?.status === 'completed' || effectiveScore.passed;
  const progress = await db.from('training_lesson_progress').upsert({
    brand_id: auth.claims.brand_id,
    release_id: body.releaseId,
    brand_user_id: member.data.id,
    module_slug: body.moduleSlug,
    lesson_slug: body.lessonSlug,
    status: completed ? 'completed' : 'in_progress',
    score: Math.max(previous.data?.score ?? 0, effectiveScore.score),
    attempt_count: (previous.data?.attempt_count ?? 0) + (previous.data && idempotent ? 0 : 1),
    completed_at: completed ? new Date().toISOString() : null,
  }, { onConflict: 'brand_id,release_id,brand_user_id,module_slug,lesson_slug' });
  if (progress.error) return jsonError(500, 'progress_save_failed', 'Could not save lesson progress.');
  return jsonWithCors({ ...effectiveScore, idempotent });
}
