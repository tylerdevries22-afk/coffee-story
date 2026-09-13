import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { staffFor } from './calendar-training-fixtures.ts';
import { createSignedInUser, seedBrand, skipUnlessConfigured, sql, userClient } from './stack.ts';

describe('training-media-history', { skip: skipUnlessConfigured }, () => {

  it('keeps tenant-isolated menu and training media history in dedicated buckets', async () => {
    const tenant = await seedBrand('content-media-history');
    const foreign = await seedBrand('content-media-foreign');
    let ownerMemberId = '';
    const owner = await createSignedInUser({
      before: async (userId) => {
        const member = await sql<{ id: string }>(
          `insert into public.brand_users (user_id, brand_id, role, location_ids)
           values ($1, $2, 'brand_owner', '{}') returning id`,
          [userId, tenant.brandId],
        );
        ownerMemberId = member.rows[0]!.id;
      },
    });
    const outsider = await staffFor(foreign.brandId, foreign.locationId);
    const menu = await sql<{ id: string }>(
      `insert into public.menus (brand_id, name, is_published)
       values ($1, 'Menu', true) returning id`,
      [tenant.brandId],
    );
    const category = await sql<{ id: string }>(
      `insert into public.menu_categories (brand_id, menu_id, slug, title)
       values ($1, $2, 'coffee', 'Coffee') returning id`,
      [tenant.brandId, menu.rows[0]!.id],
    );
    const item = await sql<{ id: string }>(
      `insert into public.menu_items
         (brand_id, menu_id, category_id, slug, name, base_price_cents, image_url)
       values ($1, $2, $3, 'latte', 'Latte', 500, 'https://assets.example/latte-v1.webp')
       returning id`,
      [tenant.brandId, menu.rows[0]!.id, category.rows[0]!.id],
    );
    await sql(
      `update public.menu_items set image_url = 'https://assets.example/latte-v2.webp'
       where id = $1`,
      [item.rows[0]!.id],
    );
    await sql(
      `insert into public.training_releases
         (brand_id, version, status, manifest, answer_key, created_by, updated_by)
       values ($1, 1, 'draft', $2, '{}', $3, $3)`,
      [tenant.brandId, JSON.stringify({
        // Deliberately the pre-3 spelling: the media-history trigger still has
        // to record a release that was drafted before the rename.
        modules: [{
          slug: 'knowledge', icon: { url: 'https://assets.example/knowledge.webp' },
          lessons: [{ slug: 'coffee', media: [{ kind: 'video', title: 'Coffee', url: 'https://assets.example/coffee.mp4' }] }],
        }],
      }), ownerMemberId],
    );

    const history = await userClient(owner.accessToken).from('content_media_versions')
      .select('entity_type,entity_key,slot,public_url').order('created_at');
    assert.equal(history.error, null);
    assert.deepEqual(history.data?.map((entry) => entry.public_url).sort(), [
      'https://assets.example/coffee.mp4',
      'https://assets.example/knowledge.webp',
      'https://assets.example/latte-v1.webp',
      'https://assets.example/latte-v2.webp',
    ]);
    const leaked = await userClient(outsider.accessToken).from('content_media_versions').select('id');
    assert.deepEqual(leaked.data, []);
    const bucket = await sql<{ public: boolean; file_size_limit: number; allowed_mime_types: string[] }>(
      `select public, file_size_limit, allowed_mime_types
       from storage.buckets where id = 'training-media'`,
    );
    assert.equal(bucket.rows[0]!.public, false);
    assert.equal(Number(bucket.rows[0]!.file_size_limit), 10485760);
    assert.ok(bucket.rows[0]!.allowed_mime_types.includes('image/webp'));
    const mutationPolicies = await sql<{ policyname: string; using_expression: string | null }>(
      `select policyname, qual as using_expression
       from pg_policies
       where schemaname = 'storage' and tablename = 'objects'
         and policyname in ('storage_brand_update', 'storage_brand_delete')
       order by policyname`,
    );
    assert.equal(mutationPolicies.rows.length, 2);
    for (const policy of mutationPolicies.rows) {
      assert.match(policy.using_expression ?? '', /bucket_id = 'brand-assets'/);
      assert.doesNotMatch(policy.using_expression ?? '', /training-media|menu-images/);
    }
  });
});
