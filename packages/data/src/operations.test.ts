import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

<<<<<<< ours
<<<<<<< ours
import type { SupabaseClient } from '@supabase/supabase-js';

import type { OperationOccurrenceRow } from '@platform/schema';
import {
  cancelOperationOccurrence,
  claimOperationOccurrence,
  completeOperationOccurrence,
  fetchOperationQueue,
  OperationDataError,
  releaseOperationOccurrence,
  reportOperationIssue,
  resolveOperationIssue,
  subscribeToOperationQueue,
  type OperationDataErrorCode,
} from './operations';

const OPERATION_PROJECTION = [
  'id', 'brand_id', 'location_id', 'schedule_id', 'template_id', 'source',
  'materialization_key', 'template_snapshot', 'scheduled_for', 'due_at',
  'grace_minutes', 'status', 'claimed_by', 'claimed_at', 'claim_expires_at',
  'completed_at', 'completion_note', 'created_at', 'updated_at',
].join(',');

function occurrenceStatus(value: string): OperationOccurrenceRow['status'] {
  return value as OperationOccurrenceRow['status'];
}

function occurrence(overrides: Partial<OperationOccurrenceRow> = {}): OperationOccurrenceRow {
  return {
    id: 'occurrence-1',
    brand_id: 'brand-1',
    location_id: 'location-1',
    schedule_id: 'schedule-1',
    template_id: 'template-1',
    source: 'schedule',
    materialization_key: 'schedule-1:2026-08-29T10:00:00.000Z',
    template_snapshot: { steps: [] },
    scheduled_for: '2026-08-29T10:00:00.000Z',
    due_at: '2026-08-29T10:30:00.000Z',
    grace_minutes: 10,
    status: occurrenceStatus('scheduled'),
    claimed_by: null,
    claimed_at: null,
    claim_expires_at: null,
    completed_at: null,
    completion_note: '',
    created_at: '2026-08-29T09:00:00.000Z',
    updated_at: '2026-08-29T09:00:00.000Z',
    ...overrides,
  };
}

type QueueStep = readonly [method: string, ...arguments_: readonly unknown[]];

function queueClient(rows: readonly unknown[]): {
  client: SupabaseClient;
  table: () => string;
  steps: readonly QueueStep[];
  signals: readonly AbortSignal[];
} {
  let selectedTable = '';
  const steps: QueueStep[] = [];
  const signals: AbortSignal[] = [];
  type QueueQuery = {
    select(columns: string): QueueQuery;
    eq(column: string, value: unknown): QueueQuery;
    lte(column: string, value: unknown): QueueQuery;
    in(column: string, values: readonly unknown[]): QueueQuery;
    order(column: string): QueueQuery;
    abortSignal(signal: AbortSignal): QueueQuery;
    returns<T>(): Promise<{ data: T; error: null }>;
  };
  const query: QueueQuery = {
    select: (columns) => { steps.push(['select', columns]); return query; },
    eq: (column, value) => { steps.push(['eq', column, value]); return query; },
    lte: (column, value) => { steps.push(['lte', column, value]); return query; },
    in: (column, values) => { steps.push(['in', column, values]); return query; },
    order: (column) => { steps.push(['order', column]); return query; },
    abortSignal: (signal) => { signals.push(signal); return query; },
    returns: async <T>() => ({ data: rows as unknown as T, error: null }),
  };
  const structuralClient = {
    from: (table: string) => { selectedTable = table; return query; },
  };
  return {
    client: structuralClient as unknown as SupabaseClient,
    table: () => selectedTable,
    steps,
    signals,
  };
}

type ApiError = { code?: string; message: string };
type ApiResult = { data: unknown; error: ApiError | null };
type RpcOutcome = ApiResult | { throws: unknown };
type RpcCall = { functionName: string; arguments_: Readonly<Record<string, unknown>> };

function rpcClient(outcomes: readonly RpcOutcome[]): {
  client: SupabaseClient;
  calls: readonly RpcCall[];
  signals: readonly AbortSignal[];
} {
  const calls: RpcCall[] = [];
  const signals: AbortSignal[] = [];
  let nextOutcome = 0;
  const structuralClient = {
    rpc: (functionName: string, arguments_: Readonly<Record<string, unknown>>) => {
      const outcome = outcomes[nextOutcome];
      nextOutcome += 1;
      calls.push({ functionName, arguments_ });
      return {
        abortSignal: async (signal: AbortSignal): Promise<ApiResult> => {
          signals.push(signal);
          if (!outcome) throw new Error(`Missing fake response for ${functionName}.`);
          if ('throws' in outcome) throw outcome.throws;
          return outcome;
        },
      };
    },
  };
  return { client: structuralClient as unknown as SupabaseClient, calls, signals };
}

async function expectDataError(
  promise: Promise<unknown>,
  code: OperationDataErrorCode,
  retryable: boolean,
  message: RegExp,
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof OperationDataError);
    assert.equal(error.name, 'OperationDataError');
    assert.equal(error.code, code);
    assert.equal(error.retryable, retryable);
    assert.match(error.message, message);
    return true;
  });
}

describe('OperationDataError', () => {
  it('retains its structured code, retry policy, and public error name', () => {
    const error = new OperationDataError('conflict', 'The operation changed.', false);
    assert.equal(error.name, 'OperationDataError');
    assert.equal(error.code, 'conflict');
    assert.equal(error.retryable, false);
    assert.equal(error.message, 'The operation changed.');
    assert.ok(error instanceof Error);
  });
});

describe('fetchOperationQueue', () => {
  it('uses the exact projection, tenant/location boundary, queue window, and stable ordering', async () => {
    const fake = queueClient([occurrence()]);

    const rows = await fetchOperationQueue(
      fake.client, 'brand-1', 'location-1', '2026-08-30T00:00:00.000Z',
    );

    assert.deepEqual(rows, [occurrence()]);
    assert.equal(fake.table(), 'operation_occurrences');
    assert.deepEqual(fake.steps, [
      ['select', OPERATION_PROJECTION],
      ['eq', 'brand_id', 'brand-1'],
      ['eq', 'location_id', 'location-1'],
      ['lte', 'scheduled_for', '2026-08-30T00:00:00.000Z'],
      ['in', 'status', ['scheduled', 'claimed']],
      ['order', 'scheduled_for'],
    ]);
    assert.equal(fake.signals.length, 1);
    assert.ok(fake.signals[0] instanceof AbortSignal);
  });

  it('rejects malformed rows instead of trusting a successful transport response', async () => {
    const fake = queueClient([{ id: 'occurrence-1', brand_id: 'brand-1', status: 'scheduled' }]);
    await expectDataError(
      fetchOperationQueue(fake.client, 'brand-1', 'location-1', '2026-08-30T00:00:00.000Z'),
      'unknown', false, /invalid response/i,
    );
  });
});

describe('operation actions', () => {
  it('propagates every action id and mutation payload without renaming fields', async () => {
    const claimed = occurrence({ status: 'claimed', claimed_by: 'member-1' });
    const completed = occurrence({ status: 'completed', claimed_by: 'member-1',
      completed_at: '2026-08-29T10:20:00.000Z' });
    const cancelled = occurrence({ status: 'cancelled' });
    const released = occurrence({ status: occurrenceStatus('scheduled') });
    const issue = { id: 'issue-1', occurrence_id: 'occurrence-1', category: 'supplies',
      severity: 'high', status: 'open', step_key: 'stock' } as const;
    const resolvedIssue = { ...issue, status: 'resolved' } as const;
    const completionIssues = [{
      category: 'supplies', severity: 'high', description: 'Low stock.', stepKey: 'stock',
    }] as const;
    const fake = rpcClient([
      { data: claimed, error: null },
      { data: completed, error: null },
      { data: issue, error: null },
      { data: resolvedIssue, error: null },
      { data: cancelled, error: null },
      { data: released, error: null },
    ]);

    assert.equal((await claimOperationOccurrence(fake.client, 'occurrence-1', 'claim-action')).status, 'claimed');
    assert.equal((await completeOperationOccurrence(fake.client, 'occurrence-1', 'complete-action',
      { stock: false, count: 3 }, 'Restock requested.', completionIssues)).status, 'completed');
    assert.deepEqual(await reportOperationIssue(fake.client, {
      occurrenceId: 'occurrence-1', actionId: 'issue-action', category: 'supplies',
      severity: 'high', description: 'Low stock.', stepKey: 'stock',
    }), issue);
    assert.deepEqual(await resolveOperationIssue(
      fake.client, 'issue-1', 'resolve-action', 'Stock replenished.',
    ), resolvedIssue);
    assert.equal((await cancelOperationOccurrence(
      fake.client, 'occurrence-1', 'cancel-action', 'Location closed.',
    )).status, 'cancelled');
    assert.equal((await releaseOperationOccurrence(
      fake.client, 'occurrence-1', 'release-action',
    )).status, 'scheduled');

    assert.deepEqual(fake.calls, [
      { functionName: 'claim_operation_occurrence', arguments_: {
        target_occurrence: 'occurrence-1', target_action_id: 'claim-action',
      } },
      { functionName: 'complete_operation_occurrence', arguments_: {
        target_occurrence: 'occurrence-1', target_action_id: 'complete-action',
        target_responses: { stock: false, count: 3 }, target_note: 'Restock requested.',
        target_issues: completionIssues,
      } },
      { functionName: 'report_operation_issue', arguments_: {
        target_occurrence: 'occurrence-1', target_action_id: 'issue-action',
        target_category: 'supplies', target_severity: 'high',
        target_description: 'Low stock.', target_step_key: 'stock',
      } },
      { functionName: 'resolve_operation_issue', arguments_: {
        target_issue: 'issue-1', target_action_id: 'resolve-action',
        target_resolution: 'Stock replenished.',
      } },
      { functionName: 'cancel_operation_occurrence', arguments_: {
        target_occurrence: 'occurrence-1', target_action_id: 'cancel-action',
        target_reason: 'Location closed.',
      } },
      { functionName: 'release_operation_occurrence', arguments_: {
        target_occurrence: 'occurrence-1', target_action_id: 'release-action',
      } },
    ]);
    assert.equal(fake.signals.length, 6);
    assert.ok(fake.signals.every((signal) => signal instanceof AbortSignal));
  });

  it('defaults atomic completion notes and issues to empty payloads', async () => {
    const fake = rpcClient([{ data: occurrence({ status: 'completed' }), error: null }]);

    await completeOperationOccurrence(
      fake.client, 'occurrence-1', 'complete-defaults', { confirmed: true },
    );

    assert.deepEqual(fake.calls, [{
      functionName: 'complete_operation_occurrence',
      arguments_: {
        target_occurrence: 'occurrence-1', target_action_id: 'complete-defaults',
        target_responses: { confirmed: true }, target_note: '', target_issues: [],
      },
    }]);
  });

  it('retries a transient database result with the same idempotency key', async () => {
    const fake = rpcClient([
      { data: null, error: { code: '40001', message: 'serialization failure' } },
      { data: occurrence({ status: 'claimed' }), error: null },
    ]);

    const result = await claimOperationOccurrence(fake.client, 'occurrence-1', 'stable-action');

    assert.equal(result.status, 'claimed');
    assert.equal(fake.calls.length, 2);
    assert.deepEqual(fake.calls[0], fake.calls[1]);
    assert.deepEqual(fake.calls[0]?.arguments_, {
      target_occurrence: 'occurrence-1', target_action_id: 'stable-action',
    });
    assert.equal(fake.signals.length, 2);
  });

  it('retries a transient transport exception and preserves the completion action id', async () => {
    const fake = rpcClient([
      { throws: new TypeError('connection reset') },
      { data: occurrence({ status: 'completed' }), error: null },
    ]);

    const result = await completeOperationOccurrence(
      fake.client, 'occurrence-1', 'complete-retry', { final: true },
    );

    assert.equal(result.status, 'completed');
    assert.equal(fake.calls.length, 2);
    assert.deepEqual(fake.calls[0], fake.calls[1]);
    assert.equal(fake.calls[1]?.arguments_.target_action_id, 'complete-retry');
    assert.deepEqual(fake.calls[1]?.arguments_.target_issues, []);
  });

  it('normalizes non-retryable service errors and never repeats their actions', async () => {
    const cases: readonly {
      error: ApiError;
      expectedCode: OperationDataErrorCode;
      expectedMessage: RegExp;
    }[] = [
      { error: { message: 'operation_occurrence_not_accessible' },
        expectedCode: 'forbidden', expectedMessage: /no longer have access/i },
      { error: { message: 'operation_eligibility_required' },
        expectedCode: 'ineligible', expectedMessage: /training or role/i },
      { error: { message: 'operation_action_id_conflict' },
        expectedCode: 'conflict', expectedMessage: /changed/i },
      { error: { code: '22023', message: 'operation_responses_invalid' },
        expectedCode: 'invalid', expectedMessage: /review the operation/i },
      { error: { code: '23505', message: 'unexpected constraint' },
        expectedCode: 'unknown', expectedMessage: /could not be saved/i },
    ];

    for (const [index, testCase] of cases.entries()) {
      const fake = rpcClient([{ data: null, error: testCase.error }]);
      await expectDataError(
        cancelOperationOccurrence(fake.client, 'occurrence-1', `action-${index}`, 'Reason'),
        testCase.expectedCode, false, testCase.expectedMessage,
      );
      assert.equal(fake.calls.length, 1);
    }
  });

  it('rejects missing identifiers before issuing an RPC', async () => {
    const fake = rpcClient([]);
    await expectDataError(
      claimOperationOccurrence(fake.client, 'occurrence-1', '  '),
      'invalid', false, /action is required/i,
    );
    await expectDataError(
      resolveOperationIssue(fake.client, ' ', 'resolve-action', 'Resolved.'),
      'invalid', false, /issue is required/i,
    );
    await expectDataError(
      releaseOperationOccurrence(fake.client, 'occurrence-1', ''),
      'invalid', false, /action is required/i,
    );
    assert.equal(fake.calls.length, 0);
  });

  it('rejects malformed operation and issue responses', async () => {
    const malformedOperation = rpcClient([{
      data: { id: 'occurrence-1', brand_id: 'brand-1', location_id: 'location-1', status: 'invented' },
      error: null,
    }]);
    await expectDataError(
      claimOperationOccurrence(malformedOperation.client, 'occurrence-1', 'claim-action'),
      'unknown', false, /invalid response/i,
    );

    const malformedIssue = rpcClient([{ data: { id: 'issue-1' }, error: null }]);
    await expectDataError(reportOperationIssue(malformedIssue.client, {
      occurrenceId: 'occurrence-1', actionId: 'issue-action', category: 'supplies',
      severity: 'normal', description: 'Missing stock.',
    }), 'unknown', false, /invalid issue/i);

    const malformedResolution = rpcClient([{ data: { id: 'issue-1' }, error: null }]);
    await expectDataError(resolveOperationIssue(
      malformedResolution.client, 'issue-1', 'resolve-action', 'Resolved.',
    ), 'unknown', false, /invalid issue/i);

    const malformedRelease = rpcClient([{ data: { id: 'occurrence-1', status: 'scheduled' }, error: null }]);
    await expectDataError(releaseOperationOccurrence(
      malformedRelease.client, 'occurrence-1', 'release-action',
    ), 'unknown', false, /invalid response/i);
  });
});

type RealtimeStatus = 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED';

function realtimeClient(): {
  client: SupabaseClient;
  channelName: () => string;
  event: () => string;
  filter: () => Readonly<Record<string, unknown>>;
  emitChange: () => void;
  emitStatus: (status: RealtimeStatus) => void;
  removedChannels: readonly unknown[];
  channel: unknown;
} {
  let selectedChannel = '';
  let selectedEvent = '';
  let selectedFilter: Readonly<Record<string, unknown>> = {};
  let changeHandler: (() => void) | undefined;
  let statusHandler: ((status: RealtimeStatus) => void) | undefined;
  const removedChannels: unknown[] = [];
  type FakeChannel = {
    on(event: string, filter: Readonly<Record<string, unknown>>, handler: () => void): FakeChannel;
    subscribe(handler: (status: RealtimeStatus) => void): FakeChannel;
  };
  const channel: FakeChannel = {
    on: (event, filter, handler) => {
      selectedEvent = event;
      selectedFilter = filter;
      changeHandler = handler;
      return channel;
    },
    subscribe: (handler) => { statusHandler = handler; return channel; },
  };
  const structuralClient = {
    channel: (name: string) => { selectedChannel = name; return channel; },
    removeChannel: async (removed: unknown) => { removedChannels.push(removed); return 'ok'; },
  };
  return {
    client: structuralClient as unknown as SupabaseClient,
    channelName: () => selectedChannel,
    event: () => selectedEvent,
    filter: () => selectedFilter,
    emitChange: () => {
      assert.ok(changeHandler, 'postgres_changes handler was not registered');
      changeHandler();
    },
    emitStatus: (status) => {
      assert.ok(statusHandler, 'subscription status handler was not registered');
      statusHandler(status);
    },
    removedChannels,
    channel,
  };
}

describe('subscribeToOperationQueue', () => {
  it('reconciles after SUBSCRIBED and changes, reports reconnectable errors, and removes its channel', () => {
    const fake = realtimeClient();
    let reconciliations = 0;
    const errors: OperationDataError[] = [];

    const unsubscribe = subscribeToOperationQueue(
      fake.client, 'location-1', () => { reconciliations += 1; }, (error) => errors.push(error),
    );

    assert.equal(fake.channelName(), 'operations-location-1');
    assert.equal(fake.event(), 'postgres_changes');
    assert.deepEqual(fake.filter(), {
      event: '*', schema: 'public', table: 'operations_change_signals',
      filter: 'location_id=eq.location-1',
    });
    assert.equal(reconciliations, 0);

    fake.emitStatus('SUBSCRIBED');
    fake.emitChange();
    fake.emitStatus('CHANNEL_ERROR');
    fake.emitStatus('TIMED_OUT');
    fake.emitStatus('CLOSED');

    assert.equal(reconciliations, 2);
    assert.equal(errors.length, 2);
    for (const error of errors) {
      assert.ok(error instanceof OperationDataError);
      assert.equal(error.code, 'network');
      assert.equal(error.retryable, true);
      assert.match(error.message, /reconnecting/i);
    }

    unsubscribe();
    assert.deepEqual(fake.removedChannels, [fake.channel]);
=======
=======
>>>>>>> theirs
import { fetchOperationQueue } from './operations';

describe('operation data', () => {
  it('applies both tenant and location filters', async () => {
    const filters: [string, unknown][] = [];
    const query: any = {
      select: () => query, eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      lte: () => query, in: () => query, order: () => query, abortSignal: () => query,
      returns: async () => ({ data: [], error: null }),
    };
    await fetchOperationQueue({ from: () => query } as any, 'brand-1', 'location-1', '2026-08-29T00:00:00Z');
    assert.deepEqual(filters, [['brand_id', 'brand-1'], ['location_id', 'location-1']]);
<<<<<<< ours
>>>>>>> theirs
=======
>>>>>>> theirs
  });
});
