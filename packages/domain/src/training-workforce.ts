import type { AppRole } from './domain';
import type { TenantTrainingProfile, TrainingLesson, TrainingManifest } from './training';

export type TrainingTrade = 'project_manager' | 'superintendent' | 'foreman' | 'field_crew' | 'subcontractor' | 'barista' | 'shift_lead' | 'field_supervisor';
export type TrainingAssignmentStatus = 'not_started' | 'in_progress' | 'complete';
export type CertificationStatus = 'current' | 'expiring' | 'expired';

export type TrainingAssignment = {
  trackSlug: string;
  lessonSlug: string;
  role: AppRole;
  trade: TrainingTrade;
  status: TrainingAssignmentStatus;
  score?: number;
  completedAt?: string;
  signedOffAt?: string;
  signedOffBy?: string;
  certificationExpiresAt?: string;
};

export type TrainingReminder = {
  kind: 'overdue' | 'expiring' | 'sign_off';
  title: string;
  detail: string;
  trackSlug: string;
  lessonSlug: string;
};

export type TrainingCompletionReport = {
  total: number;
  completed: number;
  percent: number;
  signOffRequired: number;
  certifications: { current: number; expiring: number; expired: number };
};

export function isConstructionTrainingProfile(
  profile: Pick<TenantTrainingProfile, 'industry' | 'templateKey'> | null | undefined,
): boolean {
  if (!profile) return false;
  const templateKey = profile.templateKey?.trim().toLowerCase() ?? '';
  if (templateKey === 'construction' || templateKey.endsWith('-construction')) return true;
  return /\b(construction|renovation|contracting)\b/i.test(profile.industry);
}

export function constructionTrainingManifest(profile: TenantTrainingProfile): TrainingManifest {
  const businessName = profile.businessName.trim() || 'business';
  const lesson = (trackSlug: string, slug: string, title: string): TrainingLesson => ({ slug, title, objective: `Apply ${title.toLowerCase()} on ${businessName} projects`, content: `Follow the approved ${businessName} field procedure, document the result, and escalate unsafe or out-of-scope work to the site lead.`, estimatedMinutes: 12, sourceUrls: [], media: [], quiz: [{ prompt: 'What is the correct first step?', choices: ['Follow the approved procedure', 'Guess', 'Skip the check'], correctChoice: 0, explanation: 'The approved procedure is the source of truth.' }], grantsCompetencyKeys: trackSlug === 'safety' ? ['site-safety'] : undefined, competencyValidityDays: trackSlug === 'safety' ? 365 : undefined });
  const tenant = { ...profile, businessName, templateKey: profile.templateKey ?? 'construction' };
  return { schemaVersion: 3, generatedAt: new Date().toISOString(), tenant, sources: [], tracks: [
    { slug: 'safety', title: 'Site safety', summary: 'Jobsite controls, hazards, and incident response.', icon: { symbol: 'hard-hat', prompt: 'hard hat' }, lessons: [lesson('safety', 'jobsite-safety', 'Jobsite safety orientation'), lesson('safety', 'incident-response', 'Incident response and reporting')] },
    { slug: 'operations', title: 'Project operations', summary: 'Daily logs, handoffs, and quality controls.', icon: { symbol: 'briefcase', prompt: 'briefcase' }, lessons: [lesson('operations', 'daily-log-and-handoff', 'Daily log and handoff'), lesson('operations', 'quality-control', 'Quality control walkthrough')] },
    { slug: 'field-skills', title: 'Field skills', summary: 'Trade-ready execution for active projects.', icon: { symbol: 'wrench', prompt: 'wrench' }, lessons: [lesson('field-skills', 'pre-task-plan', 'Pre-task planning')] },
  ] };
}

export function lessonsForPath(manifest: TrainingManifest, role: AppRole, trade: TrainingTrade): TrainingLesson[] {
  const required = ['project_manager', 'superintendent', 'foreman', 'field_crew', 'subcontractor'].includes(trade) ? ['field-skills', 'operations', 'safety'] : trade === 'field_supervisor' ? ['operations', 'safety'] : trade === 'shift_lead' ? ['service', 'operations', 'safety'] : ['knowledge', 'skills', 'service', 'safety'];
  return manifest.tracks.filter((track) => required.includes(track.slug)).flatMap((track) => track.lessons).filter((lesson) => {
    if (['project_manager', 'superintendent', 'foreman', 'field_crew', 'subcontractor'].includes(trade)) return true;
    if (trade === 'field_supervisor') return lesson.slug.includes('handoff') || lesson.slug.includes('incident') || lesson.slug.includes('escalation');
    return role !== 'admin' || lesson.slug !== 'cash-privacy-and-escalation';
  });
}

function certificationStatus(expiresAt: string | undefined, now: Date): CertificationStatus | null {
  if (!expiresAt) return null;
  const expires = new Date(expiresAt).getTime();
  if (Number.isNaN(expires) || expires <= now.getTime()) return 'expired';
  return expires - now.getTime() <= 30 * 86400000 ? 'expiring' : 'current';
}

export function completionReport(assignments: readonly TrainingAssignment[], now = new Date()): TrainingCompletionReport {
  const completed = assignments.filter((item) => item.status === 'complete').length;
  const certifications = { current: 0, expiring: 0, expired: 0 };
  for (const assignment of assignments) { const status = certificationStatus(assignment.certificationExpiresAt, now); if (status) certifications[status] += 1; }
  return { total: assignments.length, completed, percent: assignments.length ? Math.round((completed / assignments.length) * 100) : 0, signOffRequired: assignments.filter((item) => item.status === 'complete' && !item.signedOffAt).length, certifications };
}

export function remindersFor(assignments: readonly TrainingAssignment[], now = new Date()): TrainingReminder[] {
  return assignments.flatMap((item) => {
    const reminders: TrainingReminder[] = [];
    if (item.status !== 'complete') reminders.push({ kind: 'overdue', title: 'Training assigned', detail: `${item.trade.replace('_', ' ')} path needs completion`, trackSlug: item.trackSlug, lessonSlug: item.lessonSlug });
    if (item.status === 'complete' && !item.signedOffAt) reminders.push({ kind: 'sign_off', title: 'Supervisor sign-off needed', detail: 'A field supervisor should verify this lesson', trackSlug: item.trackSlug, lessonSlug: item.lessonSlug });
    if (certificationStatus(item.certificationExpiresAt, now) === 'expiring') reminders.push({ kind: 'expiring', title: 'Certification expires soon', detail: 'Schedule a refresher before the certification lapses', trackSlug: item.trackSlug, lessonSlug: item.lessonSlug });
    return reminders;
  });
}
