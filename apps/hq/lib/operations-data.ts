import {
  operationDisplayStatus,
  operationMetrics,
  type OperationDisplayStatus,
  type OperationMetrics,
  type OperationStatus,
} from '@platform/domain';

import { currentSession, hasRole } from './auth';
import { serverClient } from './supabase-server';

export type OperationsTemplateSummary = {
  id: string; key: string; revision: number; title: string; locationId: string | null;
  estimatedMinutes: number; active: boolean; managedByConfig: boolean;
};

export type OperationsScheduleSummary = {
  id: string; key: string; locationId: string; locationName: string; templateTitle: string;
  recurrence: 'daily' | 'weekly'; weekdays: number[]; localStartTime: string | null;
  scheduleKind: 'fixed_time' | 'opening_offset' | 'closing_offset' | 'open_interval';
  dueWindowMinutes: number; graceMinutes: number; enabled: boolean;
};

export type OperationsOccurrenceSummary = {
  id: string; locationId: string; locationName: string; title: string;
  status: OperationDisplayStatus; persistedStatus: OperationStatus;
  scheduledFor: string; dueAt: string; graceMinutes: number;
  claimedBy: string | null; completedAt: string | null; completionNote: string;
};

export type OperationsIssueSummary = {
  id: string; occurrenceId: string; category: string; severity: 'low' | 'normal' | 'high' | 'urgent';
  status: 'open' | 'acknowledged' | 'resolved' | 'dismissed'; createdAt: string;
};

export type OperationsWorkspace = {
  enabled: boolean;
  canEditBrandDefaults: boolean;
  locations: { id: string; name: string; timezone: string }[];
  templates: OperationsTemplateSummary[];
  schedules: OperationsScheduleSummary[];
  occurrences: OperationsOccurrenceSummary[];
  issues: OperationsIssueSummary[];
  metrics: OperationMetrics;
  retention: { evidenceDays: number; issueDays: number; actorIdentityDays: number };
};

type TemplateRow = {
  id: string; template_key: string; revision: number; title: string; location_id: string | null;
  estimated_minutes: number; is_active: boolean; managed_by_config: boolean;
};
type ScheduleRow = {
  id: string; schedule_key: string; location_id: string; template_id: string;
  recurrence_rule: 'daily' | 'weekly'; weekdays: number[]; local_start_time: string | null;
  schedule_kind: OperationsScheduleSummary['scheduleKind'];
  due_window_minutes: number; grace_minutes: number; is_enabled: boolean;
};
type OccurrenceRow = {
  id: string; location_id: string; template_snapshot: unknown; status: OperationStatus;
  scheduled_for: string; due_at: string; grace_minutes: number; claimed_by: string | null;
  completed_at: string | null; completion_note: string;
};
type IssueRow = {
  id: string; occurrence_id: string; category: string; severity: OperationsIssueSummary['severity'];
  status: OperationsIssueSummary['status']; created_at: string;
};

function snapshotTitle(snapshot: unknown): string {
  if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) return 'Untitled operation';
  const title = (snapshot as Record<string, unknown>).title;
  return typeof title === 'string' && title.trim() ? title : 'Untitled operation';
}

function metricsOf(rows: readonly OperationsOccurrenceSummary[]): OperationMetrics {
  return operationMetrics(rows.map((row) => ({
    id: row.id, status: row.persistedStatus, scheduledFor: row.scheduledFor, dueAt: row.dueAt,
    graceMinutes: row.graceMinutes, claimedBy: row.claimedBy,
    completedAt: row.completedAt,
  })));
}

function demoWorkspace(): OperationsWorkspace {
  const now = Date.now();
  const instant = (minutes: number) => new Date(now + minutes * 60_000).toISOString();
  const occurrences: OperationsOccurrenceSummary[] = [
    { id: 'demo-due', locationId: 'loc-downtown', locationName: 'Downtown', title: 'Opening readiness',
      status: 'scheduled', persistedStatus: 'scheduled', scheduledFor: instant(-5), dueAt: instant(25), graceMinutes: 10,
      claimedBy: null, completedAt: null, completionNote: '' },
    { id: 'demo-complete', locationId: 'loc-downtown', locationName: 'Downtown', title: 'Safety walk',
      status: 'completed', persistedStatus: 'completed', scheduledFor: instant(-90), dueAt: instant(-60), graceMinutes: 10,
      claimedBy: 'demo-member', completedAt: instant(-65), completionNote: '' },
  ];
  return {
    enabled: true, canEditBrandDefaults: true,
    locations: [{ id: 'loc-downtown', name: 'Downtown', timezone: 'America/Denver' }],
    templates: [{ id: 'demo-template', key: 'opening-readiness', revision: 1,
      title: 'Opening readiness', locationId: null, estimatedMinutes: 12,
      active: true, managedByConfig: true }],
    schedules: [{ id: 'demo-schedule', key: 'weekday-opening', locationId: 'loc-downtown',
      locationName: 'Downtown', templateTitle: 'Opening readiness', recurrence: 'weekly',
      weekdays: [1, 2, 3, 4, 5], localStartTime: '07:45:00', scheduleKind: 'fixed_time', dueWindowMinutes: 30,
      graceMinutes: 10, enabled: true }],
    occurrences, issues: [], metrics: metricsOf(occurrences),
    retention: { evidenceDays: 365, issueDays: 730, actorIdentityDays: 365 },
  };
}

function emptyWorkspace(enabled: boolean, owner: boolean): OperationsWorkspace {
  return {
    enabled, canEditBrandDefaults: owner, locations: [], templates: [], schedules: [], occurrences: [], issues: [],
    metrics: metricsOf([]), retention: { evidenceDays: 365, issueDays: 730, actorIdentityDays: 365 },
  };
}

export async function loadOperationsWorkspace(): Promise<OperationsWorkspace> {
  const [session, client] = await Promise.all([currentSession(), serverClient()]);
  if (!client) return demoWorkspace();
  if (!session || !hasRole(session, 'location_manager')) return emptyWorkspace(false, false);
  const brandId = session.brandId;
  const brand = await client.from('brands').select('operations').eq('id', brandId)
    .maybeSingle<{ operations: boolean }>();
  if (brand.error || !brand.data?.operations) return emptyWorkspace(false, hasRole(session, 'brand_owner'));
  const since = new Date(Date.now() - 31 * 24 * 60 * 60 * 1_000).toISOString();
  const [locations, templates, schedules, occurrences, issues, retention] = await Promise.all([
    client.from('locations').select('id,name,timezone').eq('brand_id', brandId)
      .returns<{ id: string; name: string; timezone: string }[]>(),
    client.from('operation_task_templates').select('id,template_key,revision,title,location_id,estimated_minutes,is_active,managed_by_config').eq('brand_id', brandId).order('title').returns<TemplateRow[]>(),
    client.from('operation_schedules').select('id,schedule_key,location_id,template_id,recurrence_rule,weekdays,local_start_time,schedule_kind,due_window_minutes,grace_minutes,is_enabled').eq('brand_id', brandId).order('local_start_time').returns<ScheduleRow[]>(),
    client.from('operation_occurrences').select('id,location_id,template_snapshot,status,scheduled_for,due_at,grace_minutes,claimed_by,completed_at,completion_note').eq('brand_id', brandId).gte('scheduled_for', since).order('scheduled_for', { ascending: false }).limit(500).returns<OccurrenceRow[]>(),
    client.from('operation_issues').select('id,occurrence_id,category,severity,status,created_at').eq('brand_id', brandId).order('created_at', { ascending: false }).limit(200).returns<IssueRow[]>(),
    client.from('operation_retention_policies').select('evidence_days,issue_days,actor_identity_days').eq('brand_id', brandId).maybeSingle<{ evidence_days: number; issue_days: number; actor_identity_days: number }>(),
  ]);
  const failed = [locations, templates, schedules, occurrences, issues].find((result) => result.error);
  if (failed?.error) throw new Error('The operations workspace could not be loaded.');
  const names = new Map((locations.data ?? []).map((row) => [row.id, row.name]));
  const templateNames = new Map((templates.data ?? []).map((row) => [row.id, row.title]));
  const occurrenceRows = (occurrences.data ?? []).map((row) => ({
    id: row.id, locationId: row.location_id, locationName: names.get(row.location_id) ?? 'Location',
    title: snapshotTitle(row.template_snapshot),
    status: operationDisplayStatus({ id: row.id, status: row.status,
      scheduledFor: row.scheduled_for, dueAt: row.due_at, graceMinutes: row.grace_minutes,
      claimedBy: row.claimed_by, completedAt: row.completed_at }, new Date()),
    persistedStatus: row.status, scheduledFor: row.scheduled_for,
    dueAt: row.due_at, graceMinutes: row.grace_minutes, claimedBy: row.claimed_by,
    completedAt: row.completed_at, completionNote: row.completion_note,
  }));
  return {
    enabled: true, canEditBrandDefaults: hasRole(session, 'brand_owner'),
    locations: locations.data ?? [],
    templates: (templates.data ?? []).map((row) => ({ id: row.id, key: row.template_key,
      revision: row.revision, title: row.title, locationId: row.location_id,
      estimatedMinutes: row.estimated_minutes, active: row.is_active, managedByConfig: row.managed_by_config })),
    schedules: (schedules.data ?? []).map((row) => ({ id: row.id, key: row.schedule_key,
      locationId: row.location_id, locationName: names.get(row.location_id) ?? 'Location',
      templateTitle: templateNames.get(row.template_id) ?? 'Template', recurrence: row.recurrence_rule,
      weekdays: row.weekdays, localStartTime: row.local_start_time, scheduleKind: row.schedule_kind,
      dueWindowMinutes: row.due_window_minutes, graceMinutes: row.grace_minutes, enabled: row.is_enabled })),
    occurrences: occurrenceRows,
    issues: (issues.data ?? []).map((row) => ({ id: row.id, occurrenceId: row.occurrence_id,
      category: row.category, severity: row.severity, status: row.status, createdAt: row.created_at })),
    metrics: metricsOf(occurrenceRows),
    retention: retention.data ? { evidenceDays: retention.data.evidence_days,
      issueDays: retention.data.issue_days, actorIdentityDays: retention.data.actor_identity_days }
      : { evidenceDays: 365, issueDays: 730, actorIdentityDays: 365 },
  };
}
