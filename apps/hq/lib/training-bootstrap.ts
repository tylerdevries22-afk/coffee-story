import {
  normalizeTrainingManifest,
  scoreTrainingQuiz,
  slugify,
  TRAINING_TRACK_ORDER,
  type TenantTrainingProfile,
  type TrainingManifest,
  type TrainingModule,
  type TrainingSource,
} from '@platform/domain';

export type { TenantTrainingProfile, TrainingManifest } from '@platform/domain';

export const TRAINING_PIPELINE_VERSION = '2.0.0';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isSafePublicHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
    if (/^(?:10|127|169\.254|192\.168)\./.test(host)) return false;
    const private172 = /^172\.(\d{1,3})\./.exec(host);
    if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return false;
    return host.length > 3;
  } catch {
    return false;
  }
}

function cleanList(values: string[] | undefined): string[] | undefined {
  if (!values) return undefined;
  const unique = [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
  return unique.length > 0 ? unique : undefined;
}

export function normalizeTrainingProfile(profile: TenantTrainingProfile): TenantTrainingProfile {
  const normalized: TenantTrainingProfile = {
    businessName: profile.businessName.trim(),
    industry: profile.industry.trim(),
    locale: profile.locale.trim() || 'en-US',
  };
  const templateKey = profile.templateKey?.trim();
  if (templateKey) normalized.templateKey = templateKey;
  if (Number.isInteger(profile.templateVersion) && (profile.templateVersion ?? 0) > 0) normalized.templateVersion = profile.templateVersion;
  const website = profile.website?.trim();
  if (website) normalized.website = website;
  const products = cleanList(profile.products);
  if (products) normalized.products = products;
  const services = cleanList(profile.services);
  if (services) normalized.services = services;
  const complianceTopics = cleanList(profile.complianceTopics);
  if (complianceTopics) normalized.complianceTopics = complianceTopics;
  const brandVoice = profile.brandVoice?.trim();
  if (brandVoice) normalized.brandVoice = brandVoice;
  return normalized;
}

/** The shape a stored template key has to hold, for both writers below. */
const TEMPLATE_KEY = /^[a-z0-9][a-z0-9-]{1,79}$/;

export function validateTrainingProfile(profile: TenantTrainingProfile): string[] {
  const issues: string[] = [];
  if (profile.businessName.trim().length < 2) issues.push('businessName must contain at least 2 characters');
  if (profile.industry.trim().length < 2) issues.push('industry must contain at least 2 characters');
  if (!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(profile.locale.trim())) issues.push('locale must resemble en or en-US');
  if (profile.website && !isSafePublicHttpsUrl(profile.website.trim())) issues.push('website must use public HTTPS');
  if (profile.templateKey && !TEMPLATE_KEY.test(profile.templateKey)) issues.push('templateKey must use lowercase letters, numbers, and single hyphens');
  if (profile.templateVersion !== undefined && (!Number.isInteger(profile.templateVersion) || profile.templateVersion < 1)) issues.push('templateVersion must be a positive integer');
  return issues;
}

export function trainingProfileFromBrandConfig(config: unknown): TenantTrainingProfile | null {
  if (!config || typeof config !== 'object') return null;
  const training = (config as { training?: unknown }).training;
  if (!training || typeof training !== 'object') return null;
  const profile = (training as { profile?: unknown }).profile;
  if (!profile || typeof profile !== 'object') return null;
  const source = profile as Record<string, unknown>;
  if (typeof source.businessName !== 'string' || typeof source.industry !== 'string' || typeof source.locale !== 'string') return null;
  const candidate = normalizeTrainingProfile(source as TenantTrainingProfile);
  return validateTrainingProfile(candidate).length === 0 ? candidate : null;
}

export function resolveTenantTrainingProfile(businessName: string, config: unknown): TenantTrainingProfile {
  const configured = trainingProfileFromBrandConfig(config);
  if (configured) return configured;
  const trainingConfig = config && typeof config === 'object' ? (config as { business?: unknown }).business : null;
  const fields = trainingConfig && typeof trainingConfig === 'object' ? trainingConfig as Record<string, unknown> : {};
  const website = typeof fields.website === 'string' && isSafePublicHttpsUrl(fields.website) ? fields.website : undefined;
  const industry = typeof fields.industry === 'string' && fields.industry.trim().length >= 2
    ? fields.industry.trim()
    : 'Business operations and customer service';
  const locale = typeof fields.locale === 'string' && /^[a-z]{2}(?:-[A-Z]{2})?$/.test(fields.locale) ? fields.locale : 'en-US';
  // Every tenant gets a template key of its own, derived the same way. This
  // used to name one shop outright -- so the first tenant reused its published
  // template and every tenant after it silently regenerated from scratch.
  // Guarded against the same shape validateTrainingProfile enforces, so a
  // name that slugs to something too short cannot produce a profile that fails
  // its own validator.
  const derived = slugify(businessName, 80);
  const templateKey = TEMPLATE_KEY.test(derived) ? derived : undefined;
  return normalizeTrainingProfile({ businessName, industry, locale, website, templateKey });
}

export function validateTrainingManifest(manifest: TrainingManifest): string[] {
  const issues: string[] = [];
  const normalized = normalizeTrainingManifest(manifest);
  if (manifest.schemaVersion !== 1 && manifest.schemaVersion !== 2) issues.push('training schema version must be 1 or 2');
  if (manifest.sources.length < 3) issues.push('at least 3 research sources are required');
  if (manifest.sources.length > 12) issues.push('no more than 12 research sources are allowed');
  if (manifest.modules.length < (manifest.schemaVersion === 2 ? TRAINING_TRACK_ORDER.length : 2)) issues.push(manifest.schemaVersion === 2 ? 'all five core training tracks are required' : 'at least 2 training modules are required');
  if (manifest.modules.length > 16) issues.push('no more than 16 training modules are allowed');
  manifest.sources.forEach((source, index) => {
    if (!isSafePublicHttpsUrl(source.url)) issues.push(`source ${index + 1} must use public HTTPS`);
  });
  const sourceUrls = new Set(manifest.sources.map((source) => source.url));
  const mediaCount = manifest.modules.reduce(
    (total, module) => total + module.lessons.reduce((lessonTotal, lesson) => lessonTotal + lesson.media.length, 0),
    0,
  );
  if (mediaCount > 24) issues.push('no more than 24 media resources are allowed');
  const moduleSlugs = new Set<string>();
  const trackKeys = new Set<string>();
  normalized.modules.forEach((module, moduleIndex) => {
    if (!SLUG.test(module.slug)) issues.push(`module ${moduleIndex + 1} has an invalid slug`);
    if (moduleSlugs.has(module.slug)) issues.push(`module ${module.slug} is duplicated`);
    moduleSlugs.add(module.slug);
    if (!module.trackKey) issues.push(`module ${module.slug} needs a track key`);
    else if (module.trackKey !== 'custom' && !TRAINING_TRACK_ORDER.includes(module.trackKey)) issues.push(`module ${module.slug} has an invalid track key`);
    else if (module.trackKey !== 'custom' && trackKeys.has(module.trackKey)) issues.push(`track ${module.trackKey} is duplicated`);
    else if (module.trackKey) trackKeys.add(module.trackKey);
    if (module.sortOrder !== undefined && (!Number.isInteger(module.sortOrder) || module.sortOrder < 0)) issues.push(`module ${module.slug} has an invalid sort order`);
    if (module.icon.url && !isSafePublicHttpsUrl(module.icon.url)) {
      issues.push(`module ${module.slug} icon must use public HTTPS`);
    }
    if (module.lessons.length > 12) issues.push(`module ${module.slug} has too many lessons`);
    const lessonSlugs = new Set<string>();
    module.lessons.forEach((lesson, lessonIndex) => {
      if (!SLUG.test(lesson.slug)) issues.push(`lesson ${module.slug}/${lessonIndex + 1} has an invalid slug`);
      if (lessonSlugs.has(lesson.slug)) issues.push(`lesson ${module.slug}/${lesson.slug} is duplicated`);
      lessonSlugs.add(lesson.slug);
      if (lesson.content.trim().length < 80) issues.push(`lesson ${module.slug}/${lesson.slug} needs substantive content`);
      if (lesson.sourceUrls.length === 0) issues.push(`lesson ${module.slug}/${lesson.slug} needs a source citation`);
      lesson.sourceUrls.forEach((url) => {
        if (!sourceUrls.has(url)) issues.push(`lesson ${module.slug}/${lesson.slug} cites an unknown source`);
        if (!isSafePublicHttpsUrl(url)) issues.push(`lesson ${module.slug}/${lesson.slug} has an unsafe source URL`);
      });
      if (lesson.menuItemSlugs && (!Array.isArray(lesson.menuItemSlugs) || lesson.menuItemSlugs.some((slug) => !SLUG.test(slug)))) issues.push(`lesson ${module.slug}/${lesson.slug} has invalid menu references`);
      if (lesson.quiz.length < 2) issues.push(`lesson ${module.slug}/${lesson.slug} needs at least 2 quiz questions`);
      lesson.quiz.forEach((question, questionIndex) => {
        if (question.choices.length < 2 || !Number.isInteger(question.correctChoice)
          || (question.correctChoice ?? -1) < 0 || (question.correctChoice ?? question.choices.length) >= question.choices.length) {
          issues.push(`question ${module.slug}/${lesson.slug}/${questionIndex + 1} has invalid choices`);
        }
      });
      lesson.media.forEach((media, mediaIndex) => {
        if (!isSafePublicHttpsUrl(media.url)) issues.push(`media ${module.slug}/${lesson.slug}/${mediaIndex + 1} must use public HTTPS`);
        if (!sourceUrls.has(media.url)) issues.push(`media ${module.slug}/${lesson.slug}/${mediaIndex + 1} needs a matching source record`);
        if (media.rightsNote.trim().length < 12) issues.push(`media ${module.slug}/${lesson.slug}/${mediaIndex + 1} needs a specific rights note`);
      });
    });
  });
  if (manifest.schemaVersion === 2) for (const required of TRAINING_TRACK_ORDER) if (!trackKeys.has(required)) issues.push(`missing core track ${required}`);
  return issues;
}

/**
 * Applies researched tenant overlays without throwing away reusable franchise
 * lessons. Matching lesson slugs are intentionally replaced by the researched
 * copy; untouched template lessons remain available to every tenant.
 */
export function mergeTrainingTemplate(
  template: TrainingManifest | null,
  generated: { sources: TrainingSource[]; modules: TrainingModule[] },
  profile: TenantTrainingProfile,
): TrainingManifest {
  const generatedManifest = normalizeTrainingManifest({
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    tenant: profile,
    ...generated,
  });
  if (!template) return generatedManifest;

  const generatedByTrack = new Map(
    generatedManifest.modules
      .filter((module) => module.trackKey !== 'custom')
      .map((module) => [module.trackKey ?? module.slug, module]),
  );
  const generatedCustomBySlug = new Map(
    generatedManifest.modules
      .filter((module) => module.trackKey === 'custom')
      .map((module) => [module.slug, module]),
  );
  const mergedTemplateModules = template.modules.map((templateModule) => {
    const generatedModule = templateModule.trackKey === 'custom'
      ? generatedCustomBySlug.get(templateModule.slug)
      : generatedByTrack.get(templateModule.trackKey ?? templateModule.slug);
    if (!generatedModule) return templateModule;
    const generatedLessonSlugs = new Set(generatedModule.lessons.map((lesson) => lesson.slug));
    return {
      ...templateModule,
      ...generatedModule,
      lessons: [
        ...generatedModule.lessons,
        ...templateModule.lessons.filter((lesson) => !generatedLessonSlugs.has(lesson.slug)),
      ],
    };
  });
  const templateSlugs = new Set(template.modules.map((module) => module.slug));
  const newCustomModules = generatedManifest.modules.filter(
    (module) => module.trackKey === 'custom' && !templateSlugs.has(module.slug),
  );
  const sourceByUrl = new Map([...template.sources, ...generatedManifest.sources].map((source) => [source.url, source]));
  return normalizeTrainingManifest({
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    tenant: { ...template.tenant, ...profile },
    sources: [...sourceByUrl.values()],
    modules: [...mergedTemplateModules, ...newCustomModules],
  });
}

export type TrainingAnswerKey = Record<string, Record<string, number[]>>;

export function prepareTrainingRelease(manifest: TrainingManifest): { publicManifest: TrainingManifest; answerKey: TrainingAnswerKey } {
  const answerKey: TrainingAnswerKey = {};
  const modules = manifest.modules.map((module) => {
    const lessonKeys: Record<string, number[]> = {};
    const lessons = module.lessons.map((lesson) => {
      lessonKeys[lesson.slug] = lesson.quiz.map((question) => question.correctChoice ?? -1);
      const quiz = lesson.quiz.map(({ correctChoice: _correctChoice, ...question }) => question);
      return { ...lesson, quiz };
    });
    answerKey[module.slug] = lessonKeys;
    return { ...module, lessons };
  });
  return { publicManifest: { ...manifest, modules }, answerKey };
}

export { scoreTrainingQuiz };
