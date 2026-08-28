'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';

import { validateOperationRetention } from '@platform/domain';

import { currentSession, hasRole } from '@/lib/auth';
import { serverClient } from '@/lib/supabase-server';

async function managerContext() {
  const [session, client] = await Promise.all([currentSession(), serverClient()]);
  if (!session || !client || !hasRole(session, 'location_manager')) {
    throw new Error('Operations manager access is required.');
  }
  const feature = await client.from('brands').select('operations').eq('id', session.brandId)
    .maybeSingle<{ operations: boolean }>();
  if (feature.error || !feature.data?.operations) throw new Error('Operations are not enabled for this tenant.');
  return { session, client };
}

function requiredFormText(formData: FormData, key: string): string {
  const value = formData.get(key);
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} is required.`);
  return value.trim();
}

function boundedInteger(formData: FormData, key: string, minimum: number, maximum: number): number {
  const value = Number(formData.get(key));
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${key} is invalid.`);
  }
  return value;
}

export async function createManualOperation(formData: FormData): Promise<void> {
  const { client } = await managerContext();
  const locationId = requiredFormText(formData, 'locationId');
  const templateId = requiredFormText(formData, 'templateId');
  const dueWindowMinutes = boundedInteger(formData, 'dueWindowMinutes', 1, 1_440);
  const result = await client.rpc('create_manual_operation_occurrence', {
    target_location: locationId, target_template: templateId, target_action_id: randomUUID(),
    target_scheduled_for: new Date().toISOString(), target_due_window_minutes: dueWindowMinutes,
  });
  if (result.error) throw new Error('The manual operation could not be created.');
  revalidatePath('/operations');
}

export async function createOperationSchedule(formData: FormData): Promise<void> {
  const { session, client } = await managerContext();
  const scheduleKey = requiredFormText(formData, 'scheduleKey');
  const locationId = requiredFormText(formData, 'locationId');
  const templateId = requiredFormText(formData, 'templateId');
  const localStartTime = requiredFormText(formData, 'localStartTime');
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(scheduleKey)
    || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(localStartTime)) {
    throw new Error('Schedule key or start time is invalid.');
  }
  const location = await client.from('locations').select('timezone').eq('brand_id', session.brandId)
    .eq('id', locationId).maybeSingle<{ timezone: string }>();
  if (location.error || !location.data) throw new Error('The schedule location is not available.');
  const recurrence = formData.get('recurrence') === 'weekly' ? 'weekly' : 'daily';
  const weekdays = recurrence === 'daily' ? [1, 2, 3, 4, 5, 6, 7]
    : formData.getAll('weekday').map(Number).filter((day) => Number.isInteger(day) && day >= 1 && day <= 7);
  if (weekdays.length === 0 || new Set(weekdays).size !== weekdays.length) {
    throw new Error('Select valid, unique weekdays.');
  }
  const result = await client.from('operation_schedules').insert({
    brand_id: session.brandId, location_id: locationId, template_id: templateId,
    timezone: location.data.timezone, recurrence_rule: recurrence, local_start_time: localStartTime,
    due_window_minutes: boundedInteger(formData, 'dueWindowMinutes', 1, 1_440),
    grace_minutes: boundedInteger(formData, 'graceMinutes', 0, 1_440),
    active_from: new Date().toISOString().slice(0, 10), schedule_key: scheduleKey,
    schedule_kind: 'fixed_time', weekdays, managed_by_config: false,
  }).select('id').maybeSingle();
  if (result.error || !result.data) throw new Error('The schedule could not be created.');
  revalidatePath('/operations/schedules');
}

export async function toggleOperationSchedule(formData: FormData): Promise<void> {
  const { session, client } = await managerContext();
  const scheduleId = requiredFormText(formData, 'scheduleId');
  const enabled = formData.get('enabled') === 'true';
  const result = await client.from('operation_schedules').update({ is_enabled: enabled })
    .eq('brand_id', session.brandId).eq('id', scheduleId).select('id').maybeSingle();
  if (result.error || !result.data) throw new Error('The schedule could not be updated.');
  revalidatePath('/operations');
  revalidatePath('/operations/schedules');
}

export async function waiveOperation(formData: FormData): Promise<void> {
  const { client } = await managerContext();
  const occurrenceId = requiredFormText(formData, 'occurrenceId');
  const reason = requiredFormText(formData, 'reason');
  const result = await client.rpc('cancel_operation_occurrence', {
    target_occurrence: occurrenceId, target_action_id: randomUUID(), target_reason: reason,
  });
  if (result.error) throw new Error('The operation could not be cancelled.');
  revalidatePath('/operations');
  revalidatePath('/operations/history');
}

export async function resolveOperationIssue(formData: FormData): Promise<void> {
  const { client } = await managerContext();
  const issueId = requiredFormText(formData, 'issueId');
  const resolution = requiredFormText(formData, 'resolution');
  const result = await client.rpc('update_operation_issue', {
    target_issue: issueId, target_action_id: randomUUID(), target_status: 'resolved',
    target_resolution: resolution,
  });
  if (result.error) throw new Error('The issue could not be resolved.');
  revalidatePath('/operations');
  revalidatePath('/operations/history');
}

export async function saveOperationRetention(formData: FormData): Promise<void> {
  const { session, client } = await managerContext();
  if (!hasRole(session, 'brand_owner')) throw new Error('Brand owner access is required.');
  const policy = {
    evidenceDays: Number(formData.get('evidenceDays')),
    issueDays: Number(formData.get('issueDays')),
    actorIdentityDays: Number(formData.get('actorIdentityDays')),
  };
  if (validateOperationRetention(policy).length > 0) throw new Error('Retention values are invalid.');
  const result = await client.from('operation_retention_policies').upsert({
    brand_id: session.brandId, evidence_days: policy.evidenceDays,
    issue_days: policy.issueDays, actor_identity_days: policy.actorIdentityDays,
  }, { onConflict: 'brand_id' });
  if (result.error) throw new Error('Retention settings could not be saved.');
  revalidatePath('/operations/retention');
}
