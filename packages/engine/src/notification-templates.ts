/**
 * What a notification says, separate from how it is delivered.
 *
 * Split out of notifications.ts when adding tenant-overridable bodies pushed
 * that file past the 200-line cap. The seam is a real one rather than a line
 * count: wording is a brand decision and transports are infrastructure, and
 * only this half has to care that a tenant may have rewritten a sentence.
 */

export type BrandMessageContext = {
  appName: string;
  pointsName: string;
};

export const TEMPLATES = {
  order_ready: {
    title: '{appName}',
    // Mirrors `orderReadyMessage` in the UI copy dictionary. Deliberately
    // vertical-neutral: a shop that wants to say "while it's hot" writes that
    // in its own dictionary, and a tenant selling something that is not food
    // must never be sent a sentence about hot drinks.
    body: 'Order {shortCode} is ready for pickup.',
  },
  drop_live: {
    title: '{appName}',
    body: '{dropTitle} just dropped. It’s gone when it’s gone.',
  },
  points_earned: {
    title: '{appName}',
    body: 'You earned {points} {pointsName}. {pointsToNext} to your next reward.',
  },
  task_due: {
    title: '{appName}',
    body: '{taskTitle} is ready to claim at {locationName}.',
  },
  task_overdue: {
    title: '{appName}',
    body: '{taskTitle} is overdue at {locationName}.',
  },
  task_issue_reported: {
    title: '{appName}',
    body: 'An issue was reported for {taskTitle} at {locationName}.',
  },
} as const;

export type TemplateKey = keyof typeof TEMPLATES;

/**
 * Bodies a tenant has rewritten, keyed like TEMPLATES and carrying the same
 * `{placeholders}`.
 *
 * An argument rather than a dictionary lookup because packages/engine may not
 * depend on packages/ui: the caller already loads the brand row to build
 * `BrandMessageContext`, so it reads the matching copy keys off the same row
 * and passes them here. Anything absent falls back to the neutral default.
 */
export type BrandTemplateBodies = Partial<Record<TemplateKey, string>>;

export function renderTemplate(
  key: TemplateKey,
  context: BrandMessageContext & Record<string, string | number>,
  bodies: BrandTemplateBodies = {},
): { title: string; body: string } {
  const fill = (template: string) =>
    template.replace(/\{(\w+)\}/g, (whole, name: string) =>
      name in context ? String(context[name as keyof typeof context]) : whole,
    );
  const template = TEMPLATES[key];
  return { title: fill(template.title), body: fill(bodies[key] ?? template.body) };
}
