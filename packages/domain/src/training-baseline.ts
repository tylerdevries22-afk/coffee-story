import type {
  TenantTrainingProfile,
  TrainingLesson,
  TrainingManifest,
  TrainingModule,
  TrainingTrackKey,
} from './training';
import { slugify } from './slug';

const SOURCES = [
  { title: 'Coffee standards', url: 'https://sca.coffee/research/coffee-standards', publisher: 'Specialty Coffee Association', accessedAt: '2026-08-26' },
  { title: 'FDA Food Code', url: 'https://www.fda.gov/food/retail-food-protection/fda-food-code', publisher: 'U.S. Food and Drug Administration', accessedAt: '2026-08-26' },
  { title: 'Restaurant safety', url: 'https://www.osha.gov/etools/young-workers-restaurant-safety', publisher: 'Occupational Safety and Health Administration', accessedAt: '2026-08-26' },
  { title: 'Safe and effective disinfectant use', url: 'https://www.epa.gov/pesticide-registration/selected-epa-registered-disinfectants', publisher: 'U.S. Environmental Protection Agency', accessedAt: '2026-08-27' },
] as const;

type LessonSeed = {
  slug: string;
  title: string;
  objective: string;
  sourceUrl: string;
  menuItemSlugs?: string[];
  content?: string;
  grantsCompetencyKeys?: string[];
  competencyValidityDays?: number;
};

const TRACKS: { key: TrainingTrackKey; title: string; summary: string; symbol: string; lessons: LessonSeed[] }[] = [
  {
    key: 'knowledge', title: 'Knowledge', summary: 'Products, standards, and guest-ready explanations.', symbol: 'book-open', lessons: [
      { slug: 'menu-fluency', title: 'Tell the {brand} menu', objective: 'Explain the menu in a clear, guest-ready way', sourceUrl: SOURCES[0].url, menuItemSlugs: ['espresso', 'latte', 'cold-brew'] },
      { slug: 'flavor-and-allergen-guidance', title: 'Flavor and allergen guidance', objective: 'Handle flavor questions and allergy concerns safely', sourceUrl: SOURCES[1].url },
      { slug: 'quality-standard', title: 'Recognize the quality standard', objective: 'Describe what a consistent {brand} beverage looks and tastes like', sourceUrl: SOURCES[0].url },
    ],
  },
  {
    key: 'skills', title: 'Skills', summary: 'Repeatable beverage execution and station habits.', symbol: 'wrench', lessons: [
      { slug: 'espresso-execution', title: 'Execute an espresso recipe', objective: 'Follow the approved espresso recipe and check the result', sourceUrl: SOURCES[0].url, menuItemSlugs: ['espresso', 'americano'] },
      { slug: 'milk-and-beverage-prep', title: 'Prepare milk and beverages', objective: 'Steam, pour, and finish beverages consistently', sourceUrl: SOURCES[0].url, menuItemSlugs: ['latte', 'cappuccino'] },
      { slug: 'station-setup-and-close', title: 'Set up and close the station', objective: 'Prepare a clean station and leave it ready for the next shift', sourceUrl: SOURCES[2].url },
    ],
  },
  {
    key: 'service', title: 'Service', summary: 'Warm, accurate, and calm guest interactions.', symbol: 'star', lessons: [
      { slug: 'welcome-and-order-accuracy', title: 'Welcome and capture an accurate order', objective: 'Greet every guest and confirm the order before payment', sourceUrl: SOURCES[2].url },
      { slug: 'customization-and-pickup', title: 'Handle customizations and pickup', objective: 'Repeat modifications and complete a confident handoff', sourceUrl: SOURCES[1].url, menuItemSlugs: ['latte', 'mocha'] },
      { slug: 'recovery-and-escalation', title: 'Recover and escalate well', objective: 'Resolve a service miss and involve a lead at the right time', sourceUrl: SOURCES[2].url },
    ],
  },
  {
    key: 'safety', title: 'Safety', summary: 'Food, equipment, chemical, and incident safety.', symbol: 'lock', lessons: [
      { slug: 'food-and-allergen-safety', title: 'Protect food and allergen safety', objective: 'Use safe handling and clear allergen communication', sourceUrl: SOURCES[1].url },
      { slug: 'equipment-and-heat-safety', title: 'Work safely around equipment and heat', objective: 'Prevent burns, electrical incidents, and unsafe equipment use', sourceUrl: SOURCES[2].url },
      {
        slug: 'chemicals-and-incidents',
        title: 'Handle chemicals, restroom sanitation, and incidents',
        objective: 'Use labeled products safely while completing a restroom sanitation round and reporting an incident immediately',
        sourceUrl: SOURCES[3].url,
        content: 'Wear the PPE named by the tenant procedure, keep products in labeled containers, and never mix cleaning products. Follow the product label for approved surfaces, application method, pre-cleaning, dilution, and contact time; the treated surface must remain visibly wet for the full label contact time. Use temporary service signage, work from cleaner areas toward dirtier areas, and wash hands after removing gloves. Stop and escalate a spill, exposure, blockage, broken fixture, or other unsafe condition rather than improvising a chemical response.',
        grantsCompetencyKeys: ['restroom-sanitation'],
        competencyValidityDays: 365,
      },
    ],
  },
  {
    key: 'operations', title: 'Operations', summary: 'Opening, inventory, records, and shift handoff.', symbol: 'briefcase', lessons: [
      { slug: 'open-close-and-handoff', title: 'Open, close, and hand off', objective: 'Complete the shift checklist and leave useful notes', sourceUrl: SOURCES[2].url },
      { slug: 'inventory-and-availability', title: 'Manage inventory and availability', objective: 'Spot low stock early and follow the approved 86 workflow', sourceUrl: SOURCES[1].url },
      { slug: 'cash-privacy-and-escalation', title: 'Protect cash, privacy, and records', objective: 'Keep operational records secure and escalate exceptions', sourceUrl: SOURCES[2].url },
    ],
  },
];

/**
 * The tenant's own name, wherever a lesson has to say one.
 *
 * These seeds are the shared starting template every tenant is bootstrapped
 * from, so they carry a placeholder rather than a brand. They used to carry
 * "Coffee Story" outright, which meant the manifest generated for the second
 * shop on the platform would have told its staff to follow the first shop's
 * procedure -- named, in writing, in a lesson they are marked complete on.
 */
function branded(text: string, businessName: string): string {
  return text.replace(/\{brand\}/g, businessName);
}

function lesson(seed: LessonSeed, businessName: string): TrainingLesson {
  const objective = branded(seed.objective, businessName);
  return {
    slug: seed.slug,
    title: branded(seed.title, businessName),
    objective,
    content: seed.content ?? `${objective}. Follow the current ${businessName} procedure, verify the result against the station standard, and pause to ask a shift lead whenever equipment, ingredients, guest needs, or local requirements fall outside the documented process. Record the handoff so the next operator can continue safely and consistently.`,
    estimatedMinutes: 8,
    sourceUrls: [seed.sourceUrl],
    ...(seed.menuItemSlugs ? { menuItemSlugs: seed.menuItemSlugs } : {}),
    media: [],
    quiz: [
      { prompt: `What is the safest first step for ${branded(seed.title, businessName).toLowerCase()}?`, choices: ['Follow the approved procedure', 'Guess from memory', 'Skip the check'], correctChoice: 0, explanation: 'The approved procedure is the tenant source of truth.' },
      { prompt: 'What should you do when the situation is not covered?', choices: ['Continue anyway', 'Ask a shift lead', 'Hide the issue'], correctChoice: 1, explanation: 'Escalation protects guests, operators, and the business.' },
    ],
    ...(seed.grantsCompetencyKeys ? { grantsCompetencyKeys: seed.grantsCompetencyKeys } : {}),
    ...(seed.competencyValidityDays ? { competencyValidityDays: seed.competencyValidityDays } : {}),
  };
}

/**
 * The starting manifest a tenant is bootstrapped from.
 *
 * The template key defaults to the tenant's own slug rather than to one
 * shop's. `slugify('Coffee Story')` is `coffee-story`, so the first tenant's
 * published templates keep resolving; every tenant after it now gets a key of
 * its own instead of reading the first one's lessons.
 *
 * The version is deliberately left unset. It used to default to 1, which
 * pinned every lookup to the first version ever published -- so a template
 * republished at version 2 was written, stored, and never read. Absent, the
 * lookup takes the highest published version, and a brand config that wants a
 * specific one still says so.
 */
export function cafeTrainingManifest(profile: TenantTrainingProfile): TrainingManifest {
  // A plain noun, not an invented brand: it has to read correctly in the
  // sentences above ("Tell the shop menu"), and a nameless tenant is a
  // misconfiguration the lesson body should not paper over with a fake name.
  const businessName = profile.businessName.trim() || 'shop';
  const tenant = { ...profile, templateKey: profile.templateKey ?? slugify(businessName) };
  const modules: TrainingModule[] = TRACKS.map((track, sortOrder) => ({
    slug: track.key,
    trackKey: track.key,
    sortOrder,
    title: track.title,
    summary: track.summary,
    icon: { symbol: track.symbol, prompt: `Simple monochrome ${track.title.toLowerCase()} line icon` },
    lessons: track.lessons.map((seed) => lesson(seed, businessName)),
  }));
  return { schemaVersion: 2, generatedAt: new Date().toISOString(), tenant, sources: [...SOURCES], modules };
}

export const trainingTemplateTrackKeys = TRACKS.map((track) => track.key);
