import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, describe, it } from 'node:test';

import { asPrincipal } from './principal.ts';
import { createSignedInUser, seedBrand, skipUnlessConfigured, sql } from './stack.ts';

/**
 * Only a platform administrator may provision an organization, and the
 * database enforces that on its own, not just the HQ console.
 *
 * The console's wizard page and server action check the role as well, but they
 * are not the boundary. Both provisioning RPCs are granted to `authenticated`,
 * so any signed-in user can call them straight through PostgREST. The boundary
 * is the base RPC's first statement (20260915120000): it raises 42501
 * platform_actor_required unless auth.uid() has a live platform_admin row in
 * brand_users. The connector wrapper reaches it before writing anything itself,
 * in the same transaction.
 *
 * A token that merely claims platform_admin is refused as well. The check reads
 * the membership row, so neither a forged claim nor an offboarded admin's
 * still-valid token is enough. If a later migration ever relaxes that first
 * statement, this file is what notices.
 */
describe('organization provisioning requires a platform administrator', { skip: skipUnlessConfigured }, () => {
  let brandId = '';
  let brandOwner = '';
  let stranger = '';

  before(async () => {
    brandId = (await seedBrand(`provision-deny-${randomUUID().slice(0, 8)}`)).brandId;
    brandOwner = (await createSignedInUser({
      before: async (userId) => {
        await sql(
          `insert into public.brand_users (user_id, brand_id, role, location_ids)
           values ($1, $2, 'brand_owner', '{}')`,
          [userId, brandId],
        );
      },
    })).userId;
    stranger = (await createSignedInUser({})).userId;
  });

  /** Well-typed arguments; the refusal must come before any of them is judged. */
  function base(owner: string): unknown[] {
    return [
      randomUUID(), 'Refused organization', `refused-${randomUUID().slice(0, 8)}`, owner,
      'owner@integration.local', 'brand', 'coffee-shop', 'coffee-shop', '{}', null, '[]',
    ];
  }

  const CALLS = [
    ['provision_platform_organization', (owner: string) => ({
      text: `select public.provision_platform_organization(
               $1::uuid, $2, $3, $4::uuid, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb)`,
      params: base(owner),
    })],
    ['provision_platform_organization_with_connectors', (owner: string) => ({
      text: `select public.provision_platform_organization_with_connectors(
               $1::uuid, $2, $3, $4::uuid, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb,
               $12, $13::jsonb, $14::jsonb, $15::jsonb)`,
      params: [...base(owner), null, '{}', '{}', '[]'],
    })],
  ] as const;

  function principals(): readonly (readonly [string, Record<string, unknown>])[] {
    return [
      ['a signed-in user with no membership', { sub: stranger }],
      ['a brand owner', {
        sub: brandOwner, app_metadata: { brand_id: brandId, role: 'brand_owner', location_ids: [] },
      }],
      ['a token that claims platform_admin without the membership row', {
        sub: stranger, app_metadata: { brand_id: brandId, role: 'platform_admin', location_ids: [] },
      }],
    ];
  }

  for (const [rpc, call] of CALLS) {
    it(`refuses ${rpc} to anyone who is not a live platform administrator`, async () => {
      for (const [who, claims] of principals()) {
        const { text, params } = call(stranger);
        await assert.rejects(asPrincipal(claims, text, params), (error) => {
          const failure = error as { code?: string; message?: string };
          assert.equal(failure.code, '42501', `${who}: ${failure.message}`);
          assert.match(failure.message ?? '', /platform_actor_required/, who);
          return true;
        }, `${who} provisioned an organization through ${rpc}`);
      }
    });
  }
});
