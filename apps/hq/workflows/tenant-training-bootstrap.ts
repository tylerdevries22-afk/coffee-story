import { type TenantTrainingProfile, type TrainingManifest } from '@platform/domain';
import { FatalError, sleep } from 'workflow';

import {
  normalizeTrainingProfile,
  prepareTrainingRelease,
  mergeTrainingTemplate,
  TRAINING_PIPELINE_VERSION,
  validateTrainingManifest,
} from '../lib/training-bootstrap';
import { verifyPublicResource } from '../lib/public-resource-verifier';
import {
  EVALUATION_SCHEMA,
  RESEARCH_INSTRUCTION,
  RESPONSE_SCHEMA,
  type GeneratedCurriculum,
  type ResponsesPayload,
} from './tenant-training-schema';
import { database, fetchWithRetry, loadTemplate } from './tenant-training-store';

type BootstrapInput = {
  brandId: string;
  runId: string;
  profile: TenantTrainingProfile;
};

async function updateRun(brandId: string, runId: string, values: Record<string, unknown>): Promise<void> {
  'use step';
  const result = await database().from('training_bootstrap_runs').update(values).eq('id', runId).eq('brand_id', brandId);
  if (result.error) throw new Error(`Training run update failed: ${result.error.code}`);
}

async function startResearch(profile: TenantTrainingProfile, runId: string): Promise<string> {
  'use step';
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_RESEARCH_MODEL;
  if (!apiKey || !model) throw new FatalError('OPENAI_API_KEY and OPENAI_RESEARCH_MODEL are required.');

  const response = await fetchWithRetry('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `training-research-${runId}`,
    },
    body: JSON.stringify({
      model,
      background: true,
      tools: [{ type: 'web_search' }],
      input: [
        { role: 'system', content: 'You are a franchise training architect. Research authoritative and current sources. Produce safe, practical, role-neutral operator training. Use only HTTPS media links and include a plain-language rights note. Never claim legal certification.' },
        { role: 'user', content: `Build a complete tenant curriculum for this profile: ${JSON.stringify(profile)}. ${RESEARCH_INSTRUCTION}` },
      ],
      text: { format: { type: 'json_schema', name: 'tenant_training_curriculum', strict: true, schema: RESPONSE_SCHEMA } },
    }),
  });
  if (!response.ok) throw new Error(`Research provider rejected the request (${response.status}).`);
  const payload = await response.json() as ResponsesPayload;
  if (!payload.id) throw new Error('Research provider returned no response id.');
  return payload.id;
}

async function pollResearch(responseId: string): Promise<GeneratedCurriculum | null> {
  'use step';
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new FatalError('OPENAI_API_KEY is required.');
  const response = await fetchWithRetry(`https://api.openai.com/v1/responses/${encodeURIComponent(responseId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) throw new Error(`Research status request failed (${response.status}).`);
  const payload = await response.json() as ResponsesPayload;
  if (payload.status === 'failed' || payload.status === 'cancelled') {
    throw new Error(payload.error?.message ?? `Research ended with status ${payload.status}.`);
  }
  if (payload.status !== 'completed') return null;
  const text = payload.output?.flatMap((item) => item.content ?? []).find((item) => item.type === 'output_text')?.text;
  if (!text) throw new Error('Research provider returned no curriculum.');
  return JSON.parse(text) as GeneratedCurriculum;
}

async function independentlyEvaluate(manifest: TrainingManifest, runId: string): Promise<string[]> {
  'use step';
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_EVALUATION_MODEL ?? process.env.OPENAI_RESEARCH_MODEL;
  if (!apiKey || !model) throw new FatalError('Training evaluation model is not configured.');
  const response = await fetchWithRetry('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `training-evaluation-${runId}`,
    },
    body: JSON.stringify({
      model,
      tools: [{ type: 'web_search' }],
      input: [
        { role: 'system', content: 'Act as an independent training release reviewer. Reject unsupported factual claims, unsafe instructions, invented credentials, inaccessible citations, mismatched media, vague rights notes, or quizzes whose answer is not taught. Return concise issues.' },
        { role: 'user', content: JSON.stringify(manifest) },
      ],
      text: { format: { type: 'json_schema', name: 'training_release_evaluation', strict: true, schema: EVALUATION_SCHEMA } },
    }),
  });
  if (!response.ok) throw new Error(`Evaluation provider rejected the request (${response.status}).`);
  const payload = await response.json() as ResponsesPayload;
  const text = payload.output?.flatMap((item) => item.content ?? []).find((item) => item.type === 'output_text')?.text;
  if (!text) throw new Error('Evaluation provider returned no decision.');
  const evaluation = JSON.parse(text) as { approved: boolean; issues: string[] };
  return evaluation.approved ? [] : evaluation.issues;
}

async function verifyResources(manifest: TrainingManifest): Promise<string[]> {
  'use step';
  const urls = [...new Set([
    ...manifest.sources.map((source) => source.url),
    ...manifest.tracks.flatMap((track) => track.lessons.flatMap((lesson) => lesson.media.map((media) => media.url))),
  ])];
  const results = await Promise.all(urls.map(async (url) => {
    try {
      await verifyPublicResource(url);
      return null;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'verification failed';
      return `${url}: ${reason}`;
    }
  }));
  return results.filter((issue): issue is string => Boolean(issue));
}

async function publishManifest(input: BootstrapInput, manifest: TrainingManifest): Promise<string> {
  'use step';
  const prepared = prepareTrainingRelease(manifest);
  const release = await database().rpc('publish_training_release', {
    target_brand: input.brandId,
    target_run: input.runId,
    release_manifest: prepared.publicManifest,
    release_answer_key: prepared.answerKey,
  });
  if (release.error) throw new Error(`Training release publish failed: ${release.error.code}`);
  if (typeof release.data !== 'string') throw new Error('Training release publish returned no id.');
  return release.data;
}

export async function bootstrapTenantTraining(input: BootstrapInput): Promise<{ releaseId: string }> {
  'use workflow';
  let qualityIssues: string[] = [];
  try {
    const profile = normalizeTrainingProfile(input.profile);
    await updateRun(input.brandId, input.runId, { status: 'researching', stage: 'deep_research', progress: 10, started_at: new Date().toISOString() });
    const responseId = await startResearch(profile, input.runId);
    await updateRun(input.brandId, input.runId, { stage: 'deep_research', progress: 20, error_detail: { responseId } });
    let generated: GeneratedCurriculum | null = null;
    for (let poll = 0; poll < 90 && !generated; poll += 1) {
      if (poll > 0) await sleep('10s');
      generated = await pollResearch(responseId);
    }
    if (!generated) throw new Error('Research did not complete within 15 minutes.');
    const manifest = mergeTrainingTemplate(await loadTemplate(profile), generated, profile);
    await updateRun(input.brandId, input.runId, { status: 'validating', stage: 'quality_gates', progress: 80 });
    qualityIssues = validateTrainingManifest(manifest);
    if (qualityIssues.length > 0) {
      throw new FatalError(`Training quality gates failed (${qualityIssues.length} issues).`);
    }
    await updateRun(input.brandId, input.runId, { stage: 'resource_verification', progress: 85 });
    qualityIssues = await verifyResources(manifest);
    if (qualityIssues.length > 0) {
      throw new FatalError(`Resource verification failed (${qualityIssues.length} issues).`);
    }
    await updateRun(input.brandId, input.runId, { stage: 'independent_review', progress: 90 });
    qualityIssues = await independentlyEvaluate(manifest, input.runId);
    if (qualityIssues.length > 0) {
      throw new FatalError(`Independent review failed (${qualityIssues.length} issues).`);
    }
    const releaseId = await publishManifest(input, manifest);
    await updateRun(input.brandId, input.runId, { status: 'published', stage: 'complete', progress: 100, finished_at: new Date().toISOString(), error_detail: { pipelineVersion: TRAINING_PIPELINE_VERSION } });
    return { releaseId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Training pipeline failed.';
    const qualityFailure = qualityIssues.length > 0;
    await updateRun(input.brandId, input.runId, {
      status: 'failed',
      stage: qualityFailure ? 'quality_gates' : 'pipeline',
      error_code: qualityFailure ? 'quality_gate_failed' : 'pipeline_failed',
      error_detail: qualityFailure ? { issues: qualityIssues } : { message },
      finished_at: new Date().toISOString(),
    });
    throw error;
  }
}
