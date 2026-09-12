import { createSignedInUser, sql } from './stack.ts';

export async function staffFor(brandId: string, locationId: string) {
  let brandUserId = '';
  const session = await createSignedInUser({
    before: async (userId) => {
      const member = await sql<{ id: string }>(
        `insert into public.brand_users (user_id, brand_id, role, location_ids)
         values ($1, $2, 'staff', array[$3::uuid]) returning id`,
        [userId, brandId, locationId],
      );
      brandUserId = member.rows[0]!.id;
    },
  });
  return { ...session, brandUserId };
}
