import { createClient } from '@supabase/supabase-js';
import { normalizeTrainingManifest, type TenantTrainingProfile, type TrainingManifest, type TrainingModule, type TrainingSource } from '@platform/domain';
import { FatalError, sleep } from 'workflow';

import {
  normalizeTrainingProfile,
  prepareTrainingRelease,
  mergeTrainingTemplate,
  TRAINING_PIPELINE_VERSION,
  validateTrainingManifest,
} from '../lib/training-bootstrap';
import { verifyPublicResource } from '../lib/public-resource-verifier';

type BootstrapInput = {
  brandId: string;
  runId: string;
  profile: TenantTrainingProfile;
};

type GeneratedCurriculum = {
  sources: TrainingSource[];
  modules: TrainingModule[];
};

type ResponsesPayload = {
  id?: string;
  status?: string;
  error?: { message?: string };
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
};

const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['sources', 'modules'],
  properties: {
    sources: {
      type: 'array', minItems: 3, maxItems: 12,
      items: { type: 'object', additionalProperties: false, required: ['title', 'url', 'publisher', 'accessedAt'], properties: {
        title: { type: 'string' }, url: { type: 'string' }, publisher: { type: 'string' }, accessedAt: { type: 'string' },
      } },
    },
    modules: {
      type: 'array', minItems: 5, maxItems: 16,
      items: { type: 'object', additionalProperties: false, required: ['slug', 'trackKey', 'sortOrder', 'title', 'summary', 'icon', 'lessons'], properties: {
        slug: { type: 'string' }, trackKey: { type: 'string', enum: ['knowledge', 'skills', 'service', 'safety', 'operations', 'custom'] }, sortOrder: { type: 'integer', minimum: 0 }, title: { type: 'string' }, summary: { type: 'string' },
        icon: { type: 'object', additionalProperties: false, required: ['symbol', 'prompt'], properties: {
          symbol: { type: 'string' }, prompt: { type: 'string' },
        } },
        lessons: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'object', additionalProperties: false, required: ['slug', 'title', 'objective', 'content', 'estimatedMinutes', 'sourceUrls', 'media', 'quiz'], properties: {
          slug: { type: 'string' }, title: { type: 'string' }, objective: { type: 'string' }, content: { type: 'string' }, estimatedMinutes: { type: 'integer', minimum: 1, maximum: 90 },
          sourceUrls: { type: 'array', minItems: 1, items: { type: 'string' } },
          menuItemSlugs: { type: 'array', items: { type: 'string' } },
          media: { type: 'array', maxItems: 4, items: { type: 'object', additionalProperties: false, required: ['kind', 'url', 'title', 'rightsNote'], properties: {
            kind: { type: 'string', enum: ['image', 'video'] }, url: { type: 'string' }, title: { type: 'string' }, rightsNote: { type: 'string' },
          } } },
          quiz: { type: 'array', minItems: 2, items: { type: 'object', additionalProperties: false, required: ['prompt', 'choices', 'correctChoice', 'explanation'], properties: {
            prompt: { type: 'string' }, choices: { type: 'array', minItems: 2, maxItems: 5, items: { type: 'string' } }, correctChoice: { type: 'integer', minimum: 0 }, explanation: { type: 'string' },
          } } },
        } } },
      } },
    },
  },
} as const;

const EVALUATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['approved', 'issues'],
  properties: {
    approved: { type: 'boolean' },
    issues: { type: 'array', items: { type: 'string' } },
  },
} as const;

function database() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new FatalError('Training automation database is not configured.');
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
    global: { fetch: (input, init) => fetchWithRetry(input, init ?? {}) },
  });
}

async function loadTemplate(profile: TenantTrainingProfile): Promise<TrainingManifest | null> {
  if (!profile.templateKey) return null;
  const query = database().from('training_templates').select('manifest')
    .eq('template_key', profile.templateKey).eq('status', 'published');
  const result = Number.isInteger(profile.templateVersion) && (profile.templateVersion ?? 0) > 0
    ? await query.eq('version', profile.templateVersion).maybeSingle<{ manifest: unknown }>()
    : await query.order('version', { ascending: false }).limit(1).maybeSingle<{ manifest: unknown }>();
  if (result.error || !result.data?.manifest || typeof result.data.manifest !== 'object') return null;
  const value = result.data.manifest as Partial<TrainingManifest>;
  if (!Array.isArray(value.modules) || !Array.isArray(value.sources) || !value.tenant) return null;
  return normalizeTrainingManifest(value as TrainingManifest);
}

async function updateRun(brandId: string, runId: string, values: Record<string, unknown>): Promise<void> {
  'use step';
  const result = await database().from('training_bootstrap_runs').update(values).eq('id', runId).eq('brand_id', brandId);
  if (result.error) throw new Error(`Training run update failed: ${result.error.code}`);
}

async function fetchWithRetry(url: RequestInfo | URL, init: RequestInit): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (response.ok || (response.status < 500 && response.status !== 429)) return response;
      lastError = new Error(`Research provider returned ${response.status}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Research provider request failed');
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError ?? new Error('Research provider request failed');
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
        { role: 'user', content: `Build a complete tenant curriculum for this profile: ${JSON.stringify(profile)}. Return one module for each required track in this order: Knowledge, Skills, Service, Safety, Operations; add custom modules only when useful. Include concise, practical lessons, scenario-based quizzes, and verified publisher-hosted media where useful. Every lesson must cite exact source URLs supporting its claims. Icon symbols must be portable semantic names and prompts must describe a simple monochrome line icon. Use menuItemSlugs only when a lesson directly explains a tenant menu item.` },
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
    ...manifest.modules.flatMap((module) => module.lessons.flatMap((lesson) => lesson.media.map((media) => media.url))),
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
