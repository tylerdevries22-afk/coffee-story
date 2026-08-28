import {
  ApiError,
  fetchWithRetry,
  newIdempotencyKey,
  resolveApiUrl,
  throwForResponse,
} from '@platform/api-client';

import type { OperationIntent, OperationIntentIssue } from './offline-intents';
import {
  parseOperatorQueue,
  type OperatorNotification,
  type OperatorQueueSnapshot,
  type OperatorTaskOccurrence,
} from './model';
import { liveConfigFromEnv } from '@/lib/runtime-config';
import { supabase } from '@/lib/supabase';

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

async function operationRequest(
  path: string,
  method: Method,
  body?: unknown,
  idempotencyKey?: string,
): Promise<unknown> {
  const config = liveConfigFromEnv();
  const session = await supabase?.auth.getSession();
  const token = session?.data.session?.access_token;
  if (!token) throw new ApiError(401, 'unauthorized', 'Sign in before using shift tasks.');
  if (typeof config.apiUrl !== 'string') {
    throw new ApiError(503, 'configuration_missing', 'The operations service is not configured.');
  }
  const url = resolveApiUrl(path, {
    baseUrl: config.apiUrl,
    allowedHost: typeof config.allowedApiHost === 'string' ? config.allowedApiHost : undefined,
    developmentMode: true,
  });
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['Idempotency-Key'] = idempotencyKey ?? newIdempotencyKey();
  const response = await fetchWithRetry(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) await throwForResponse(response);
  if (response.status === 204) return null;
  return response.json() as Promise<unknown>;
}

function queryPath(locationId: string, from: string, to: string): string {
  const query = new URLSearchParams({ locationId, from, to });
  return `/api/operations/queue?${query.toString()}`;
}

/** Loads the caller-filtered occurrence queue and validates the response boundary. */
export async function loadOperatorQueue(
  locationId: string,
  from: string,
  to: string,
): Promise<OperatorQueueSnapshot> {
  return parseOperatorQueue(await operationRequest(queryPath(locationId, from, to), 'GET'));
}

function occurrencePath(occurrenceId: string, action: 'claim' | 'release' | 'complete' | 'waive'): string {
  return `/api/operations/occurrences/${encodeURIComponent(occurrenceId)}/${action}`;
}

function completionBody(intent: Extract<OperationIntent, { kind: 'complete' }>) {
  return {
    actionId: intent.actionId,
    responses: intent.responses,
    note: intent.note,
    issues: intent.issues,
  };
}

/** Replays one durable intent. The server remains authoritative for transitions. */
export async function submitOperationIntent(intent: OperationIntent): Promise<unknown> {
  if (intent.kind === 'claim') {
    return operationRequest(
      occurrencePath(intent.occurrenceId, 'claim'), 'POST', { actionId: intent.actionId }, intent.actionId,
    );
  }
  if (intent.kind === 'release') {
    return operationRequest(
      occurrencePath(intent.occurrenceId, 'release'), 'POST', { actionId: intent.actionId }, intent.actionId,
    );
  }
  if (intent.kind === 'complete') {
    return operationRequest(
      occurrencePath(intent.occurrenceId, 'complete'), 'POST', completionBody(intent), intent.actionId,
    );
  }
  if (intent.kind === 'report_issue') {
    return operationRequest('/api/operations/issues', 'POST', {
      actionId: intent.actionId,
      occurrenceId: intent.occurrenceId,
      locationId: intent.locationId,
      category: intent.category,
      severity: intent.severity,
      description: intent.description,
      stepKey: intent.stepKey,
    }, intent.actionId);
  }
  return operationRequest(
    occurrencePath(intent.occurrenceId, 'waive'),
    'POST',
    { reason: intent.reason },
    intent.actionId,
  );
}

function notificationFromUnknown(value: unknown): OperatorNotification | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = row.id;
  const occurrenceId = row.occurrenceId ?? row.occurrence_id;
  const title = row.title;
  const body = row.body;
  const createdAt = row.createdAt ?? row.created_at;
  const readAt = row.readAt ?? row.read_at;
  if (typeof id !== 'string' || typeof occurrenceId !== 'string' || typeof title !== 'string'
    || typeof body !== 'string' || typeof createdAt !== 'string') return null;
  return {
    id,
    occurrenceId,
    title,
    body,
    createdAt,
    readAt: typeof readAt === 'string' ? readAt : null,
  };
}

/** Loads persisted operations notifications; malformed rows are omitted. */
export async function loadOperationNotifications(): Promise<readonly OperatorNotification[]> {
  const response = await operationRequest('/api/operations/notifications', 'GET');
  const record = response && typeof response === 'object' && !Array.isArray(response)
    ? response as Record<string, unknown>
    : null;
  const rows = Array.isArray(record?.notifications) ? record.notifications : [];
  return rows.map(notificationFromUnknown).filter((item): item is OperatorNotification => item !== null);
}

export async function markOperationNotificationsRead(ids: readonly string[]): Promise<void> {
  await operationRequest('/api/operations/notifications', 'PATCH', { ids });
}

export async function registerOperationDeviceToken(
  token: string,
  platform: 'ios' | 'android',
): Promise<void> {
  await operationRequest('/api/operations/device-tokens', 'POST', { token, platform });
}

export async function unregisterOperationDeviceToken(token: string): Promise<void> {
  await operationRequest('/api/operations/device-tokens', 'DELETE', { token });
}

export type CompletionDraft = {
  responses: Readonly<Record<string, boolean | number | string>>;
  note: string;
  issues: readonly OperationIntentIssue[];
};

export function taskFromMutationResponse(value: unknown): OperatorTaskOccurrence | null {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  const parsed = parseOperatorQueue({ occurrences: record?.occurrence ? [record.occurrence] : [] });
  return parsed.occurrences[0] ?? null;
}
