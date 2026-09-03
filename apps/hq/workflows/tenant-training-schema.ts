import type { TrainingSource, TrainingTrack } from '@platform/domain';

/**
 * The contracts the research provider is held to. They live apart from the
 * workflow because they are the shape of an external answer, not a step: the
 * provider is asked for strict JSON schema output, so anything these two miss
 * arrives as a type assertion nobody checked.
 */
export type GeneratedCurriculum = {
  sources: TrainingSource[];
  tracks: TrainingTrack[];
};

export type ResponsesPayload = {
  id?: string;
  status?: string;
  error?: { message?: string };
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
};

// No `trackKey`: a track's slug is its key, and asking a model for a second
// one only produced a value that could disagree with the first.
export const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['sources', 'tracks'],
  properties: {
    sources: {
      type: 'array', minItems: 3, maxItems: 12,
      items: { type: 'object', additionalProperties: false, required: ['title', 'url', 'publisher', 'accessedAt'], properties: {
        title: { type: 'string' }, url: { type: 'string' }, publisher: { type: 'string' }, accessedAt: { type: 'string' },
      } },
    },
    tracks: {
      type: 'array', minItems: 5, maxItems: 16,
      items: { type: 'object', additionalProperties: false, required: ['slug', 'sortOrder', 'title', 'summary', 'icon', 'lessons'], properties: {
        slug: { type: 'string' }, sortOrder: { type: 'integer', minimum: 0 }, title: { type: 'string' }, summary: { type: 'string' },
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

export const EVALUATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['approved', 'issues'],
  properties: {
    approved: { type: 'boolean' },
    issues: { type: 'array', items: { type: 'string' } },
  },
} as const;

/** The instruction the research model is given, phrased in the same vocabulary. */
export const RESEARCH_INSTRUCTION = 'Return one track for each required core track, with these exact slugs and in this order: knowledge, skills, service, safety, operations; add a track of the tenant\'s own only when useful, and give it a descriptive slug. Include concise, practical lessons, scenario-based quizzes, and verified publisher-hosted media where useful. Every lesson must cite exact source URLs supporting its claims. Icon symbols must be portable semantic names and prompts must describe a simple monochrome line icon. Use menuItemSlugs only when a lesson directly explains a tenant menu item.';
