import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  agreementTerms,
  enrollmentResponseInput,
  franchiseConsentReadiness,
  submitEnrollmentResponse,
} from './franchise-enrollment';
import { loadPendingEnrollments } from './franchise-enrollment-data';

const BRAND = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NETWORK = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function responseForm(decision: 'accept' | 'reject'): FormData {
  const form = new FormData();
  form.set('brandId', BRAND);
  form.set('networkId', NETWORK);
  form.set('decision', decision);
  return form;
}

describe('franchise enrollment response', () => {
  it('parses and submits an acceptance with the tenant-bound identifiers', async () => {
    const input = enrollmentResponseInput(responseForm('accept'))!;
    const calls: unknown[] = [];
    const outcome = await submitEnrollmentResponse(async (args) => {
      calls.push(args);
      return { data: 'active', error: null };
    }, input);

    assert.equal(outcome, 'accepted');
    assert.deepEqual(calls, [{ p_accept: true, p_brand_id: BRAND, p_network_id: NETWORK }]);
  });

  it('parses and submits a rejection without converting it into acceptance', async () => {
    const input = enrollmentResponseInput(responseForm('reject'))!;
    const calls: unknown[] = [];
    const outcome = await submitEnrollmentResponse(async (args) => {
      calls.push(args);
      return { data: 'rejected', error: null };
    }, input);

    assert.equal(outcome, 'rejected');
    assert.deepEqual(calls, [{ p_accept: false, p_brand_id: BRAND, p_network_id: NETWORK }]);
  });

  it('rejects malformed decisions and treats a missing pending agreement as stale', async () => {
    const malformed = responseForm('accept');
    malformed.set('decision', 'approve');
    assert.equal(enrollmentResponseInput(malformed), null);
    assert.equal(await submitEnrollmentResponse(async () => ({
      data: null,
      error: { code: '23503' },
    }), enrollmentResponseInput(responseForm('accept'))!), 'stale');
  });
});

describe('franchise consent readiness', () => {
  it('passes only when both membership and agreement are active', () => {
    assert.deepEqual(franchiseConsentReadiness(
      'franchisee',
      [{ networkId: NETWORK, status: 'active' }],
      [{ networkId: NETWORK, status: 'active' }],
    ), {
      required: true,
      ready: true,
      status: 'passed',
      evidence: 'Membership: active · Agreement: active',
    });
    assert.equal(franchiseConsentReadiness('franchisee',
      [{ networkId: NETWORK, status: 'active' }],
      [{ networkId: NETWORK, status: 'pending' }]).ready, false);
    assert.equal(franchiseConsentReadiness('franchisee', [], []).ready, false);
  });

  it('does not combine active rows from different networks', () => {
    assert.equal(franchiseConsentReadiness(
      'franchisee',
      [{ networkId: NETWORK, status: 'active' }],
      [{ networkId: BRAND, status: 'active' }],
    ).ready, false);
  });

  it('surfaces terminal consent as failed and exempts non-franchisees', () => {
    assert.equal(franchiseConsentReadiness('franchisee',
      [{ networkId: NETWORK, status: 'rejected' }],
      [{ networkId: NETWORK, status: 'rejected' }]).status, 'failed');
    assert.deepEqual(franchiseConsentReadiness('operator', [], []), {
      required: false,
      ready: true,
      status: 'not-required',
      evidence: 'Not required',
    });
  });
});

describe('pending enrollment review data', () => {
  it('scopes pending agreements to the owner brand and preserves review terms', async () => {
    const filters: [string, string][] = [];
    const query = {
      select: () => query,
      eq: (column: string, value: string) => { filters.push([column, value]); return query; },
      order: () => query,
      returns: async () => ({ data: [{
        id: 'agreement-1', network_id: NETWORK, created_at: '2026-09-04T00:00:00Z',
        inheritance_policy: { mode: 'network-defaults' }, inheritance_revision: 2,
        territory: { region: 'Denver' },
      }], error: null }),
    };
    const client = { from: () => query } as unknown as SupabaseClient;
    const result = await loadPendingEnrollments(BRAND, client);

    assert.equal(result.unavailable, false);
    assert.equal(result.enrollments[0]?.networkId, NETWORK);
    assert.deepEqual(filters, [
      ['franchisee_brand_id', BRAND],
      ['status', 'pending'],
    ]);
    assert.match(agreementTerms(result.enrollments[0]?.territory, 'None'), /Denver/);
  });

  it('fails closed with a user-safe unavailable state', async () => {
    const query = {
      select: () => query, eq: () => query, order: () => query,
      returns: async () => ({ data: null, error: { code: '42501' } }),
    };
    const client = { from: () => query } as unknown as SupabaseClient;
    assert.deepEqual(await loadPendingEnrollments(BRAND, client), {
      enrollments: [], unavailable: true,
    });
  });
});
