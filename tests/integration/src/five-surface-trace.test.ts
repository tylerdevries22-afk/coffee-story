import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, describe, it } from 'node:test';

import { POST as ordersPost } from '../../../apps/hq/app/api/orders/route.ts';

import { fetchBoardTickets } from '@platform/data';
// Deep import, not the package root: this suite is `"type": "module"` while
// @platform/domain is not, and Node's CJS named-export detection cannot see
// through the `export *` in its index. (@platform/data's index re-exports by
// name, which is why the import above works.)
import {
  DEFAULT_BOARD_CONFIG, boardQueue, queuePositions,
} from '@platform/domain/src/board-display.ts';

import {
  anonClient, asPrincipal, createSignedInUser, seedBrand, serviceClient, skipUnlessConfigured, sql, stack, userClient,
} from './stack.ts';

/**
 * One order, seen from all five surfaces.
 *
 * The other suites prove each piece in isolation: the API prices an order, the
 * trigger validates a transition, a policy denies the wrong reader. None of
 * them proves the pieces are *connected* -- that the row a kiosk creates is
 * the row a display shows and a prep batch belongs to.
 *
 * So every assertion here goes through the query the surface actually runs,
 * not a hand-written SQL approximation of it. If a surface stops seeing the
 * order, this fails; that is the whole point of it existing.
 */
process.env.SUPABASE_URL = stack.url;
process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;

const SLUG = 'five-surface-trace';

describe('one order across five surfaces', { skip: skipUnlessConfigured }, () => {
  let brandId = '';
  let locationId = '';
  let guestToken = '';
  let menuItemId = '';
  let recipeId = '';
  /** The wall tablet, and a shift lead. Both may read the board; nothing else may. */
  let displayDeviceId = '';
  let staffToken = '';

  before(async () => {
    if (skipUnlessConfigured) return;
    ({ brandId, locationId } = await seedBrand(SLUG));
    await sql(
      `update public.brands set brand_config = $2 where id = $1`,
      [brandId, JSON.stringify({
        tax: { jurisdictions: [{ id: 'state', label: 'State Sales Tax', rate: 0.029 }] },
      })],
    );

    const menu = await sql<{ id: string }>(
      `insert into public.menus (brand_id, name, is_published) values ($1, 'Menu', true) returning id`,
      [brandId],
    );
    const category = await sql<{ id: string }>(
      `insert into public.menu_categories (brand_id, menu_id, title, sort_order)
       values ($1, $2, 'Bakery', 1) returning id`,
      [brandId, menu.rows[0]!.id],
    );
    const item = await sql<{ id: string }>(
      `insert into public.menu_items (brand_id, menu_id, category_id, slug, name, base_price_cents, sort_order)
       values ($1, $2, $3, 'milk-cake', 'Pistachio Milk Cake', 700, 1) returning id`,
      [brandId, menu.rows[0]!.id, category.rows[0]!.id],
    );
    menuItemId = item.rows[0]!.id;

    // Surface 4's half of the link: a recipe for the thing being sold.
    const recipe = await sql<{ id: string }>(
      `insert into public.recipes (brand_id, menu_item_id, version, steps, yield_qty, yield_unit, allergens)
       values ($1, $2, 1, '[]'::jsonb, 12, 'slices', array['nuts','dairy']) returning id`,
      [brandId, menuItemId],
    );
    recipeId = recipe.rows[0]!.id;

    // The wall tablet the display runs on, and the shift lead who works the
    // board. `can_read_board` (0033) admits exactly these two and the owner.
    const display = await sql<{ id: string }>(
      `insert into public.devices (brand_id, location_id, role, label, paired_at)
       values ($1, $2, 'display', 'Trace wall display', now()) returning id`,
      [brandId, locationId],
    );
    displayDeviceId = display.rows[0]!.id;
    const staff = await createSignedInUser({
      before: async (userId) => {
        await sql(
          `insert into public.brand_users (user_id, brand_id, role, location_ids)
           values ($1, $2, 'staff', array[$3::uuid])`,
          [userId, brandId, locationId],
        );
      },
    });
    staffToken = staff.accessToken;

    const guest = await createSignedInUser({ userMetadata: { brand_slug: SLUG } });
    guestToken = guest.accessToken;
  });

  it('travels from the till to the crew summary, seen by each surface in turn', async () => {
    // 1. THE KIOSK places it, through the same route the guest app posts to.
    //    channel is what tells the board where the order came from.
    const placed = await ordersPost(new Request('http://hq.test/api/orders', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${guestToken}`,
        'idempotency-key': randomUUID(),
      },
      body: JSON.stringify({
        locationId,
        fulfillmentType: 'curbside',
        lines: [{ itemSlug: 'milk-cake', quantity: 2 }],
        tipCents: 0,
        maximumTotalCents: 1_441,
        tenderType: 'pay_at_pickup',
      }),
    }));
    // Read once: a Response body is a stream, and using it for the failure
    // message then again for the value leaves nothing to parse.
    const placedBody = await placed.json() as { orderId?: string; error?: unknown };
    assert.equal(placed.status, 201, JSON.stringify(placedBody));
    const orderId = placedBody.orderId!;

    // The ticket number is assigned by the database, not guessed by a client.
    const numbered = await sql<{ daily_number: number; service_date: string; status: string }>(
      `select daily_number, service_date, status from public.orders where id = $1`,
      [orderId],
    );
    const ticket = numbered.rows[0]!;
    assert.ok(ticket.daily_number >= 1, 'the order must carry a human-readable ticket');
    assert.ok(ticket.service_date, 'and the service date its numbering resets on');
    assert.equal(ticket.status, 'created', 'pay-at-pickup stays unpaid until operator collection');

    // Staff collects at the counter before the public board announces the
    // ticket. Creation alone is not settlement and must not mint a paid state.
    await sql(
      `insert into public.order_events (brand_id, order_id, type, source, snapshot)
       values ($1, $2, 'paid', 'operator', '{}'::jsonb)`,
      [brandId, orderId],
    );

    // A display can only show a name it is given, so give it one.
    await sql(`update public.orders set guest_label = 'Sara D.' where id = $1`, [orderId]);

    // 2. THE DISPLAY sees the collected payment, through its own read -- the
    //    view, not the table.
    const service = serviceClient();

    /**
     * The board is read by someone the gate actually admits.
     *
     * Migration 0033 made `board_tickets` security definer behind
     * `app.can_read_board`, which wants a paired display device, a brand owner,
     * or staff at the location -- and dropped the policy that let a display
     * touch `orders` directly. The service role holds none of those claims, so
     * this used to read the board with a principal the surface never uses and
     * only passed because the view was security_invoker. It returns nothing
     * now, which is the migration working.
     */
    const board_ = () => fetchBoardTickets(userClient(staffToken), locationId);
    let board = await board_();
    let mine = board.find((t) => t.id === orderId);
    assert.ok(mine, 'the display must see the order the kiosk just took');
    assert.equal(mine!.daily_number, ticket.daily_number);
    assert.equal(mine!.guest_label, 'Sara D.');
    assert.ok(!('customer_id' in mine!), 'and must not be handed the guest record with it');
    assert.ok(!('total_cents' in mine!), 'nor what they paid');

    // And the wall tablet itself, not just the shift lead standing next to it.
    // This is the principal 0033 exists for: a device claim carries no `role`,
    // so it can satisfy `can_read_board` and nothing else.
    const onTheWall = await asPrincipal<{ id: string; daily_number: number }>(
      {
        app_metadata: {
          brand_id: brandId,
          device_id: displayDeviceId,
          device_role: 'display',
          device_location_id: locationId,
        },
      },
      `select id, daily_number from public.board_tickets where location_id = $1`,
      [locationId],
    );
    assert.ok(
      onTheWall.rows.some((row) => row.id === orderId),
      'a paired display device must see the ticket on its own claims',
    );
    // The board is one queue now, not two columns: a paid order takes a place
    // in line, and only a ready one gets the check that replaces the number.
    const queued = boardQueue(board, DEFAULT_BOARD_CONFIG)
      .entries.find((entry) => entry.id === orderId);
    assert.ok(queued, 'a paid order belongs in the line');
    assert.equal(queued.ready, false, 'and is not yet the one being called up');
    assert.ok(
      (queuePositions(board).get(orderId) ?? 0) >= 1,
      'a guest still waiting has a place in line, counted from one',
    );

    // 3. THE OPERATOR starts it. State moves only by appending an event.
    await sql(
      `insert into public.order_events (brand_id, order_id, type, source, snapshot)
       values ($1, $2, 'in_progress', 'operator', '{}'::jsonb)`,
      [brandId, orderId],
    );
    const started = await sql<{ status: string }>(
      `select status from public.orders where id = $1`, [orderId],
    );
    assert.equal(started.rows[0]!.status, 'in_progress', 'the trigger projects the event onto the row');

    // 4. THE GUEST arrives, curbside. Arrival is not a transition: the order
    //    must stay exactly where it was.
    const arrived = await anonClient().rpc('mark_order_arrived', { target_order: orderId });
    // Called anonymously it must fail -- the function checks ownership.
    assert.ok(arrived.error, 'a stranger cannot mark someone else arrived');

    await sql(`update public.orders set arrived_at = now() where id = $1`, [orderId]);
    const afterArrival = await sql<{ status: string }>(
      `select status from public.orders where id = $1`, [orderId],
    );
    assert.equal(afterArrival.rows[0]!.status, 'in_progress', 'arriving must not move the state machine');

    board = await board_();
    mine = board.find((t) => t.id === orderId);
    assert.ok(mine!.arrived_at, 'and the display badges the arrival');

    // 5. THE PREP STATION finishes the batch, which returns the item to the
    //    menu -- the one place the bench reaches the guest.
    await sql(`update public.menu_items set is_86d = true where id = $1`, [menuItemId]);
    const batch = await sql<{ id: string }>(
      `insert into public.prep_batches (brand_id, location_id, recipe_id, service_date, target_qty)
       values ($1, $2, $3, current_date, 24) returning id`,
      [brandId, locationId, recipeId],
    );
    await sql(
      `update public.prep_batches set status = 'done', produced_qty = 24 where id = $1`,
      [batch.rows[0]!.id],
    );
    const cleared = await sql<{ is_86d: boolean }>(
      `select is_86d from public.menu_items where id = $1`, [menuItemId],
    );
    assert.equal(cleared.rows[0]!.is_86d, false, 'a finished tray puts the item back on the menu');

    // 6. READY, then collected.
    for (const next of ['ready', 'picked_up'] as const) {
      await sql(
        `insert into public.order_events (brand_id, order_id, type, source, snapshot)
         values ($1, $2, $3::app.order_status, 'operator', '{}'::jsonb)`,
        [brandId, orderId, next],
      );
    }
    const collected = await sql<{ status: string }>(
      `select status from public.orders where id = $1`, [orderId],
    );
    assert.equal(collected.rows[0]!.status, 'picked_up');

    // 7. THE DISPLAY drops it. A collected order is not a queue any more.
    board = await board_();
    assert.equal(
      board.find((t) => t.id === orderId), undefined,
      'a collected order must leave the board on its own',
    );

    // 8. THE CREW still counts it. The shift's own record is the whole history,
    //    not what happens to be on a screen.
    //    "Today" is the shop's day, not the server's. `current_date` is the
    //    database's UTC date and the 0023 trigger stamps service_date in the
    //    location's timezone, so from 18:00 Denver until midnight UTC the two
    //    disagree and the shift's own takings read empty. This assertion used
    //    `current_date`, passed locally in the afternoon, and failed in CI at
    //    01:22 UTC -- which was still the previous evening in the shop. The
    //    expression below is the trigger's own, so the test now also proves
    //    service_date is assigned in location time rather than server time.
    const counted = await sql<{ n: string }>(
      `select count(*) as n from public.orders o
        where o.location_id = $1
          and o.status = 'picked_up'
          and o.service_date = (now() at time zone coalesce(
                (select l.timezone from public.locations l where l.id = $1), 'UTC'))::date`,
      [locationId],
    );
    assert.ok(Number(counted.rows[0]!.n) >= 1, 'the day’s takings include the order that just left');

    // And every step of it is on the record, in order.
    const events = await sql<{ type: string }>(
      `select type from public.order_events where order_id = $1 order by created_at`,
      [orderId],
    );
    // 'created' first, then 'paid': even a pay-at-pickup order is written
    // before it is paid for, and rule 2's machine records both rather than
    // starting the history halfway through.
    assert.deepEqual(
      events.rows.map((e) => e.type),
      ['created', 'paid', 'in_progress', 'ready', 'picked_up'],
      'order_events is the append-only truth the surfaces all read from',
    );
  });
});
